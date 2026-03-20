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

/** source_urlからメーカー公式画像を再取得してR2にアップロード */
async function redownloadAndUpload(
  sourceUrl: string,
  manufacturerSlug: string,
  lureSlug: string,
  colorName: string,
): Promise<string | null> {
  const colorSlug = slugify(colorName).substring(0, 40) || 'default';
  const r2Key = `${manufacturerSlug}/${lureSlug}/${colorSlug}.webp`;

  // まずsource_urlのページから画像を取得する必要があるが、
  // R2のキーが分かっているので、source_urlの画像を直接フェッチするのではなく
  // 元のスクレイパーを通す必要がある。
  // ただし、多くの場合source_urlはShopify等の商品ページで、画像URLパターンは推測可能。
  //
  // 代わりの戦略: source_urlをfetchしてog:imageやmainImageを抽出
  try {
    log(`  ページ取得: ${sourceUrl}`);
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    if (sourceUrl.includes('shimano.com')) {
      headers['Referer'] = 'https://fish.shimano.com/';
    }

    const pageRes = await fetch(sourceUrl, { headers, redirect: 'follow' });
    if (!pageRes.ok) {
      logError(`  ページ取得失敗: HTTP ${pageRes.status}`);
      return null;
    }

    const html = await pageRes.text();

    // 画像URLを探す（優先順位: og:image → メイン画像 → JSON-LD → 最初の大きな画像）
    let imageUrl: string | null = null;

    // 1. og:image
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch) {
      imageUrl = ogMatch[1];
    }

    // 2. Shopify featured image
    if (!imageUrl) {
      const shopifyMatch = html.match(/"featured_image":\s*"([^"]+)"/);
      if (shopifyMatch) {
        imageUrl = shopifyMatch[1].replace(/\\\//g, '/');
      }
    }

    // 3. JSON-LD image
    if (!imageUrl) {
      const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatch) {
        for (const block of jsonLdMatch) {
          try {
            const jsonStr = block.replace(/<\/?script[^>]*>/gi, '');
            const jsonData = JSON.parse(jsonStr);
            if (jsonData.image) {
              imageUrl = Array.isArray(jsonData.image) ? jsonData.image[0] : jsonData.image;
              if (typeof imageUrl === 'object' && imageUrl !== null) {
                imageUrl = (imageUrl as any).url || null;
              }
              break;
            }
          } catch { /* skip invalid JSON-LD */ }
        }
      }
    }

    if (!imageUrl) {
      logError(`  画像URL抽出失敗: ${sourceUrl}`);
      return null;
    }

    // 相対URLを絶対URLに変換
    if (imageUrl.startsWith('//')) {
      imageUrl = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
      const base = new URL(sourceUrl);
      imageUrl = `${base.origin}${imageUrl}`;
    }

    log(`  画像URL: ${imageUrl}`);

    // ダウンロード
    const imgRes = await fetch(imageUrl, { headers, redirect: 'follow' });
    if (!imgRes.ok) {
      logError(`  画像ダウンロード失敗: HTTP ${imgRes.status}`);
      return null;
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // WebP変換
    const webpBuffer = await sharp(buffer)
      .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // 小さすぎる画像をスキップ
    if (webpBuffer.length < 5000) {
      logError(`  画像が小さすぎます (${webpBuffer.length} bytes): プレースホルダーの可能性`);
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

    // アップロード後の検証（HEADリクエスト）
    const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;
    await sleep(500); // R2の反映待ち
    const verifyStatus = await checkImageExists(publicUrl);
    if (verifyStatus !== 'ok') {
      logError(`  アップロード検証失敗: ${publicUrl} → ${verifyStatus}`);
      // リトライ1回
      log(`  リトライ中...`);
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
        logError(`  リトライ後も検証失敗: ${publicUrl}`);
        return null;
      }
    }

    return publicUrl;
  } catch (err) {
    logError(`  再取得失敗: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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
// Phase 3: 修復
// ---------------------------------------------------------------------------

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

  // source_url単位でグルーピング（同じページから複数カラーを取得するため）
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

  // source_urlがあるものを修復
  // 注意: 同じsource_urlでも各カラーの画像は異なる可能性がある
  // 現在のR2キー構造: {manufacturer_slug}/{lure_slug}/{color_slug}.webp
  // source_urlからはメイン画像しか取れないので、全カラー同じ画像になる
  // → それでもNULL（画像なし）より遥かにマシ

  for (const item of items) {
    if (!item.source_url) {
      skipped++;
      continue;
    }

    log(`\n修復: ${item.manufacturer_slug}/${item.slug}/${item.color_name}`);
    log(`  元URL: ${item.image_url}`);
    log(`  ソース: ${item.source_url}`);

    if (DRY_RUN) {
      log(`  [DRY RUN] スキップ`);
      continue;
    }

    const newUrl = await redownloadAndUpload(
      item.source_url,
      item.manufacturer_slug,
      item.slug,
      item.color_name,
    );

    if (newUrl) {
      // Supabase更新
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
      // source_urlから画像取得失敗 → imagesをnullに設定（壊れたURLよりマシ）
      log(`  画像取得失敗 → imagesをnullに設定`);
      const { error } = await sb
        .from('lures')
        .update({ images: null })
        .eq('id', item.id);

      if (error) {
        logError(`  Supabase更新失敗: ${error.message}`);
      }
      failed++;
    }

    // レート制限（ページフェッチするので長めに）
    await sleep(1000);
  }

  log(`\n=== 修復完了 ===`);
  log(`修復成功: ${fixed}件`);
  log(`修復失敗: ${failed}件`);
  log(`スキップ（source_urlなし）: ${skipped}件`);
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
