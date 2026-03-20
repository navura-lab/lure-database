// scripts/_image-404-fix.ts
// R2画像404問題の検出・修復スクリプト
//
// Usage:
//   npx tsx scripts/_image-404-fix.ts --sample     # Phase1: メーカー別サンプリング調査（各10件）
//   npx tsx scripts/_image-404-fix.ts --full        # Phase2: 問題メーカーの全件チェック
//   npx tsx scripts/_image-404-fix.ts --fix         # Phase3: 404画像を再取得・R2アップロード・Supabase更新
//   npx tsx scripts/_image-404-fix.ts --fix --dry-run  # 修復内容を表示するが実行しない

import 'dotenv/config';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const IMAGE_WIDTH = 500;

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const MODE = process.argv.includes('--fix')
  ? 'fix'
  : process.argv.includes('--full')
    ? 'full'
    : 'sample';

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LureRow {
  id: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  slug: string;
  color_name: string;
  images: string[] | null;
  source_url: string | null;
}

interface MakerStats {
  total: number;
  withImages: number;
  checked: number;
  ok: number;
  notFound: number;  // 404
  error: number;
  notFoundIds: string[];  // 404のレコードID一覧
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[image-404] ${msg}`);
}

function logError(msg: string) {
  console.error(`[image-404] ERROR: ${msg}`);
}

/** HEADリクエストで画像の存在を確認（レート制限付き） */
async function checkImageExists(url: string): Promise<'ok' | '404' | 'error'> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 403) return '404';
    return 'error';
  } catch {
    return 'error';
  }
}

/** 指定ミリ秒待つ */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Supabaseからid昇順でページネーション取得 */
async function fetchAllLures(
  columns: string,
  filter?: { manufacturer_slug: string },
): Promise<LureRow[]> {
  const rows: LureRow[] = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  const PAGE = 1000;

  while (true) {
    let query = sb
      .from('lures')
      .select(columns)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE);

    if (filter) {
      query = query.eq('manufacturer_slug', filter.manufacturer_slug);
    }

    const { data, error } = await query;
    if (error) {
      logError(`Supabase error: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as LureRow[]));
    lastId = data[data.length - 1].id;
    log(`  取得: ${rows.length}件...`);
  }

  return rows;
}


// ---------------------------------------------------------------------------
// Phase 1: サンプリング調査
// ---------------------------------------------------------------------------

async function runSample() {
  log('=== Phase 1: メーカー別サンプリング調査 ===');
  log('Supabaseから画像ありレコードを取得中...');

  const rows = await fetchAllLures(
    'id, manufacturer, manufacturer_slug, slug, color_name, images',
  );

  log(`全レコード: ${rows.length}件`);

  // 画像ありレコードをメーカーごとにグループ化
  const byMaker = new Map<string, LureRow[]>();
  for (const row of rows) {
    if (!row.images || row.images.length === 0) continue;
    const key = row.manufacturer_slug;
    if (!byMaker.has(key)) byMaker.set(key, []);
    byMaker.get(key)!.push(row);
  }

  log(`画像ありメーカー: ${byMaker.size}社`);

  // 各メーカーから最大10件ランダムサンプリング
  const SAMPLE_SIZE = 10;
  const results = new Map<string, MakerStats>();

  for (const [makerSlug, makerRows] of byMaker) {
    const stats: MakerStats = {
      total: makerRows.length,
      withImages: makerRows.length,
      checked: 0,
      ok: 0,
      notFound: 0,
      error: 0,
      notFoundIds: [],
    };

    // ランダムサンプリング
    const shuffled = [...makerRows].sort(() => Math.random() - 0.5);
    const sample = shuffled.slice(0, SAMPLE_SIZE);

    for (const row of sample) {
      const url = row.images![0];
      const status = await checkImageExists(url);
      stats.checked++;
      if (status === 'ok') stats.ok++;
      else if (status === '404') {
        stats.notFound++;
        stats.notFoundIds.push(row.id);
      } else stats.error++;

      // レート制限
      await sleep(50);
    }

    results.set(makerSlug, stats);

    // 進捗表示
    const rate404 = stats.checked > 0 ? Math.round(stats.notFound / stats.checked * 100) : 0;
    if (stats.notFound > 0) {
      log(`❌ ${makerSlug}: ${stats.notFound}/${stats.checked} 404 (${rate404}%) [全${stats.total}件]`);
    }
  }

  // サマリー
  log('\n=== サマリー ===');
  let totalChecked = 0, total404 = 0;

  // 404率でソート
  const sorted = [...results.entries()]
    .sort((a, b) => {
      const rateA = a[1].checked > 0 ? a[1].notFound / a[1].checked : 0;
      const rateB = b[1].checked > 0 ? b[1].notFound / b[1].checked : 0;
      return rateB - rateA;
    });

  log('\n--- 404検出メーカー ---');
  const problemMakers: string[] = [];
  for (const [slug, stats] of sorted) {
    totalChecked += stats.checked;
    total404 += stats.notFound;
    if (stats.notFound > 0) {
      const rate = Math.round(stats.notFound / stats.checked * 100);
      log(`  ${slug}: ${stats.notFound}/${stats.checked} (${rate}%) → 全${stats.total}件要チェック`);
      problemMakers.push(slug);
    }
  }

  log(`\n全体: ${total404}/${totalChecked} 404 (${Math.round(total404 / totalChecked * 100)}%)`);
  log(`問題メーカー: ${problemMakers.length}社`);
  log(`次のステップ: npx tsx scripts/_image-404-fix.ts --full`);

  // 結果をJSONで保存
  const report = {
    timestamp: new Date().toISOString(),
    totalChecked,
    total404,
    problemMakers: problemMakers.map(slug => ({
      slug,
      stats: results.get(slug)!,
    })),
  };
  const fs = await import('fs');
  const reportPath = '/Users/user/ウェブサイト/lure-database/scripts/_image-404-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`レポート保存: ${reportPath}`);
}

// ---------------------------------------------------------------------------
// Phase 2: 問題メーカー全件チェック
// ---------------------------------------------------------------------------

async function runFull() {
  log('=== Phase 2: 問題メーカー全件チェック ===');

  // Phase 1のレポートを読み込み
  const fs = await import('fs');
  const reportPath = '/Users/user/ウェブサイト/lure-database/scripts/_image-404-report.json';

  let problemSlugs: string[];
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    problemSlugs = report.problemMakers.map((m: any) => m.slug);
    log(`Phase 1レポートから${problemSlugs.length}社をロード`);
  } else {
    logError('Phase 1レポートが見つかりません。先に --sample を実行してください。');
    process.exit(1);
  }

  const allNotFound: { id: string; manufacturer_slug: string; slug: string; color_name: string; image_url: string; source_url: string | null }[] = [];

  for (const makerSlug of problemSlugs) {
    log(`\n--- ${makerSlug} 全件チェック ---`);

    const rows = await fetchAllLures(
      'id, name, manufacturer, manufacturer_slug, slug, color_name, images, source_url',
      { manufacturer_slug: makerSlug },
    );

    const withImages = rows.filter(r => r.images && r.images.length > 0);
    log(`  ${makerSlug}: 全${rows.length}件、画像あり${withImages.length}件`);

    let ok = 0, notFound = 0, error = 0;

    for (const row of withImages) {
      const url = row.images![0];
      const status = await checkImageExists(url);

      if (status === 'ok') {
        ok++;
      } else if (status === '404') {
        notFound++;
        allNotFound.push({
          id: row.id,
          manufacturer_slug: row.manufacturer_slug,
          slug: row.slug,
          color_name: row.color_name,
          image_url: url,
          source_url: row.source_url,
        });
      } else {
        error++;
      }

      // レート制限
      await sleep(30);
    }

    log(`  結果: OK=${ok}, 404=${notFound}, エラー=${error}`);
  }

  log(`\n=== 全件チェック完了 ===`);
  log(`合計404: ${allNotFound.length}件`);

  // slug単位でグルーピングして表示
  const byLure = new Map<string, typeof allNotFound>();
  for (const item of allNotFound) {
    const key = `${item.manufacturer_slug}/${item.slug}`;
    if (!byLure.has(key)) byLure.set(key, []);
    byLure.get(key)!.push(item);
  }

  log(`\n--- 404ルアー一覧 (${byLure.size}ルアー) ---`);
  for (const [lureKey, items] of byLure) {
    log(`  ${lureKey}: ${items.length}件`);
  }

  // 結果をJSONで保存
  const fullReportPath = '/Users/user/ウェブサイト/lure-database/scripts/_image-404-full-report.json';
  const fullReport = {
    timestamp: new Date().toISOString(),
    total404: allNotFound.length,
    totalLures: byLure.size,
    items: allNotFound,
  };
  fs.writeFileSync(fullReportPath, JSON.stringify(fullReport, null, 2));
  log(`詳細レポート保存: ${fullReportPath}`);
  log(`次のステップ: npx tsx scripts/_image-404-fix.ts --fix [--dry-run]`);
}

// ---------------------------------------------------------------------------
// Phase 3: 修復（スクレイパー再実行方式）
// ---------------------------------------------------------------------------

/** source_urlから画像をダウンロードしてR2にアップロード */
async function downloadImageToR2(
  imageUrl: string,
  r2Key: string,
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };

    const res = await fetch(imageUrl, { headers, redirect: 'follow' });
    if (!res.ok) {
      logError(`  画像DL失敗: HTTP ${res.status} for ${imageUrl}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const webpBuffer = await sharp(buffer)
      .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    if (webpBuffer.length < 5000) {
      logError(`  画像小さすぎ (${webpBuffer.length} bytes): ${imageUrl}`);
      return null;
    }

    log(`  R2アップロード: ${r2Key} (${(webpBuffer.length / 1024).toFixed(1)} KB)`);
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: webpBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;

    // アップロード検証
    await sleep(500);
    const status = await checkImageExists(publicUrl);
    if (status !== 'ok') {
      logError(`  アップロード検証失敗、リトライ...`);
      await sleep(2000);
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: r2Key,
          Body: webpBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      await sleep(1000);
      const retry = await checkImageExists(publicUrl);
      if (retry !== 'ok') {
        logError(`  リトライ後も検証失敗`);
        return null;
      }
    }

    return publicUrl;
  } catch (err) {
    logError(`  DL/アップロードエラー: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Vivaの商品ページからカラー別画像URLマップを取得 */
async function scrapeVivaColorImages(sourceUrl: string): Promise<Map<string, string>> {
  const colorMap = new Map<string, string>();
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    if (!res.ok) {
      logError(`  ページ取得失敗: HTTP ${res.status} for ${sourceUrl}`);
      return colorMap;
    }
    const html = await res.text();

    const SITE_BASE = 'https://vivanet.co.jp';
    function makeAbsolute(href: string): string {
      if (!href) return '';
      if (href.startsWith('http://') || href.startsWith('https://')) return href;
      if (href.startsWith('//')) return 'https:' + href;
      if (href.startsWith('/')) return SITE_BASE + href;
      return SITE_BASE + '/' + href;
    }

    // color_list から各カラー画像を抽出（Vivaスクレイパーと同一ロジック）
    const colorListMatch = html.match(/<ul[^>]*class=["'][^"']*color_list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
    if (colorListMatch) {
      const liMatches = colorListMatch[1].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
      for (const li of liMatches) {
        const aHrefMatch = li.match(/<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*)["']/i);
        const imgMatch = li.match(/<img[^>]+src=["']([^"']+)["']/i);
        const pMatch = li.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const titleMatch = li.match(/<a[^>]+title=["']([^"']+)["']/i);

        const rawColorText = pMatch ? pMatch[1] : (titleMatch ? titleMatch[1] : '');
        if (!rawColorText) continue;

        const colorText = rawColorText.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
        if (!colorText || colorText.length === 0 || colorText.length > 80) continue;
        if (/Viva-net|ビバネット|AquaWave|コーモラン|CORMORAN|TOP|HOME/i.test(colorText)) continue;

        const imageUrl = makeAbsolute(aHrefMatch ? aHrefMatch[1] : (imgMatch ? imgMatch[1] : ''));
        if (imageUrl) {
          colorMap.set(colorText, imageUrl);
        }
      }
    }
  } catch (err) {
    logError(`  スクレイプエラー: ${err instanceof Error ? err.message : String(err)}`);
  }
  return colorMap;
}

async function runFix() {
  log(`=== Phase 3: 404画像修復 ${DRY_RUN ? '(DRY RUN)' : ''} ===`);

  const fs = await import('fs');
  const fullReportPath = '/Users/user/ウェブサイト/lure-database/scripts/_image-404-full-report.json';

  if (!fs.existsSync(fullReportPath)) {
    logError('Phase 2レポートが見つかりません。先に --full を実行してください。');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(fullReportPath, 'utf-8'));
  const items = report.items as {
    id: string;
    manufacturer_slug: string;
    slug: string;
    color_name: string;
    image_url: string;
    source_url: string | null;
  }[];

  log(`修復対象: ${items.length}件`);

  // source_url単位でグルーピング
  const bySource = new Map<string, typeof items>();
  const noSource: typeof items = [];
  for (const item of items) {
    if (item.source_url) {
      if (!bySource.has(item.source_url)) bySource.set(item.source_url, []);
      bySource.get(item.source_url)!.push(item);
    } else {
      noSource.push(item);
    }
  }

  log(`source_urlあり: ${items.length - noSource.length}件（${bySource.size}ページ）`);
  log(`source_urlなし: ${noSource.length}件（修復不可）`);

  let fixed = 0, failed = 0, skipped = 0;

  // source_url単位で処理（1ページ1回のフェッチで全カラー取得）
  for (const [sourceUrl, sourceItems] of bySource) {
    const lureSlug = sourceItems[0].slug;
    const makerSlug = sourceItems[0].manufacturer_slug;
    log(`\n--- ${makerSlug}/${lureSlug} (${sourceItems.length}件) ---`);
    log(`  source: ${sourceUrl}`);

    if (DRY_RUN) {
      log(`  [DRY RUN] スキップ`);
      skipped += sourceItems.length;
      continue;
    }

    // ページから全カラー画像URLを取得
    const colorImageMap = await scrapeVivaColorImages(sourceUrl);
    log(`  カラー画像取得: ${colorImageMap.size}件`);

    for (const item of sourceItems) {
      // カラー名でマッチ
      let originalImageUrl = colorImageMap.get(item.color_name);

      // 完全一致しない場合、部分一致を試みる
      if (!originalImageUrl) {
        for (const [colorName, imgUrl] of colorImageMap) {
          if (colorName.includes(item.color_name) || item.color_name.includes(colorName)) {
            originalImageUrl = imgUrl;
            break;
          }
        }
      }

      if (!originalImageUrl) {
        log(`  ⚠️ カラー画像見つからず: ${item.color_name}`);
        // imagesをnullに設定（壊れた404 URLよりマシ）
        const { error } = await sb
          .from('lures')
          .update({ images: null })
          .eq('id', item.id);
        if (error) logError(`  Supabase null更新失敗: ${error.message}`);
        failed++;
        continue;
      }

      const colorSlug = slugify(item.color_name).substring(0, 40) || 'default';
      const r2Key = `${makerSlug}/${lureSlug}/${colorSlug}.webp`;

      log(`  修復: ${item.color_name} → ${originalImageUrl}`);

      const newUrl = await downloadImageToR2(originalImageUrl, r2Key);
      if (newUrl) {
        const { error } = await sb
          .from('lures')
          .update({ images: [newUrl] })
          .eq('id', item.id);

        if (error) {
          logError(`  Supabase更新失敗: ${error.message}`);
          failed++;
        } else {
          log(`  ✅ 修復完了: ${newUrl}`);
          fixed++;
        }
      } else {
        const { error } = await sb
          .from('lures')
          .update({ images: null })
          .eq('id', item.id);
        if (error) logError(`  Supabase null更新失敗: ${error.message}`);
        failed++;
      }

      await sleep(200); // R2レート制限
    }

    await sleep(1000); // ページフェッチ間隔
  }

  // source_urlなし
  for (const item of noSource) {
    log(`  スキップ（source_urlなし）: ${item.manufacturer_slug}/${item.slug}/${item.color_name}`);
    skipped++;
  }

  log(`\n=== 修復完了 ===`);
  log(`修復成功: ${fixed}件`);
  log(`修復失敗: ${failed}件`);
  log(`スキップ: ${skipped}件`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`モード: ${MODE}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  switch (MODE) {
    case 'sample':
      await runSample();
      break;
    case 'full':
      await runFull();
      break;
    case 'fix':
      await runFix();
      break;
  }
}

main().catch(err => {
  logError(`Fatal: ${err}`);
  process.exit(1);
});
