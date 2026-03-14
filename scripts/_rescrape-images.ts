/**
 * 画像欠損レコード再スクレイプスクリプト
 *
 * Supabaseから画像がnull/空のレコードを取得し、
 * source_urlを使ってスクレイパーで画像を再取得、R2にアップロード、Supabaseを更新する。
 *
 * 使い方:
 *   npx tsx scripts/_rescrape-images.ts --manufacturer 6th-sense --dry-run
 *   npx tsx scripts/_rescrape-images.ts --manufacturer zoom --limit 10
 *   npx tsx scripts/_rescrape-images.ts --manufacturer mukai
 *   npx tsx scripts/_rescrape-images.ts --all              # 全メーカー対象
 *
 * オプション:
 *   --manufacturer <slug>  対象メーカーslug（複数指定可: --manufacturer 6th-sense --manufacturer zoom）
 *   --all                  全メーカー対象（画像欠損のあるもの）
 *   --limit <n>            処理するシリーズ数の上限
 *   --dry-run              DB更新なし（スクレイプのみ実行してログ出力）
 *   --delay <ms>           リクエスト間の遅延ミリ秒（デフォルト: 2000）
 */

import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_REGION,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  IMAGE_WIDTH,
} from './config.js';
import { getScraper, getRegisteredManufacturers } from './scrapers/index.js';
import { slugify } from '../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// CLI引数パース
// ---------------------------------------------------------------------------

interface CliArgs {
  manufacturers: string[];
  all: boolean;
  limit: number;
  dryRun: boolean;
  delayMs: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const manufacturers: string[] = [];
  let all = false;
  let limit = 0;
  let dryRun = false;
  let delayMs = 2000;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--manufacturer':
        if (args[i + 1]) {
          manufacturers.push(args[i + 1]);
          i++;
        }
        break;
      case '--all':
        all = true;
        break;
      case '--limit':
        if (args[i + 1]) {
          limit = parseInt(args[i + 1], 10);
          i++;
        }
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--delay':
        if (args[i + 1]) {
          delayMs = parseInt(args[i + 1], 10);
          i++;
        }
        break;
    }
  }

  if (!all && manufacturers.length === 0) {
    console.error('エラー: --manufacturer <slug> または --all を指定してください');
    console.error('');
    console.error('使い方:');
    console.error('  npx tsx scripts/_rescrape-images.ts --manufacturer 6th-sense --dry-run');
    console.error('  npx tsx scripts/_rescrape-images.ts --manufacturer zoom --limit 10');
    console.error('  npx tsx scripts/_rescrape-images.ts --all');
    console.error('');
    console.error('登録済みメーカー:');
    console.error('  ' + getRegisteredManufacturers().join(', '));
    process.exit(1);
  }

  return { manufacturers, all, limit, dryRun, delayMs };
}

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [rescrape] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[${timestamp()}] [rescrape] ERROR: ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// R2クライアント
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function processAndUploadImage(
  imageUrl: string,
  r2Key: string,
): Promise<string> {
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  if (imageUrl.includes('shimano.com')) {
    fetchHeaders['Referer'] = 'https://fish.shimano.com/';
  }

  const response = await fetch(imageUrl, { headers: fetchHeaders });
  if (!response.ok) {
    throw new Error(`画像ダウンロード失敗: ${response.status} ${response.statusText} (${imageUrl})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const webpBuffer = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: webpBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Supabaseヘルパー
// ---------------------------------------------------------------------------

interface LureRecord {
  id: number;
  slug: string;
  name: string;
  color_name: string;
  manufacturer_slug: string;
  source_url: string | null;
  images: string[] | null;
  weight: number | null;
}

/**
 * 画像が欠損しているレコードをSupabaseから取得
 * manufacturer_slug別、slug(シリーズ)でグルーピングして返す
 */
async function fetchMissingImageRecords(manufacturerSlug: string): Promise<LureRecord[]> {
  const allRecords: LureRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    // images が null のレコードを取得
    const url = `${SUPABASE_URL}/rest/v1/lures?manufacturer_slug=eq.${encodeURIComponent(manufacturerSlug)}&images=is.null&select=id,slug,name,color_name,manufacturer_slug,source_url,images,weight&order=slug,color_name&offset=${offset}&limit=${pageSize}`;
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Supabase query error ${res.status}: ${await res.text()}`);
    }
    const rows = await res.json() as LureRecord[];
    allRecords.push(...rows);

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return allRecords;
}

/**
 * 画像欠損のあるメーカーslug一覧を取得
 */
async function fetchManufacturersWithMissingImages(): Promise<Array<{ manufacturer_slug: string; count: number }>> {
  // Supabase REST APIでは直接GROUP BYができないので、全画像欠損レコードからメーカーを集計
  // まずは各メーカーごとのカウントを取得
  const url = `${SUPABASE_URL}/rest/v1/lures?images=is.null&select=manufacturer_slug&limit=50000`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase query error ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json() as Array<{ manufacturer_slug: string }>;

  // 集計
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.manufacturer_slug, (counts.get(row.manufacturer_slug) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([manufacturer_slug, count]) => ({ manufacturer_slug, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Supabaseのレコードを更新（imagesカラム）
 */
async function updateLureImages(
  recordId: number,
  images: string[],
): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/lures?id=eq.${recordId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ images }),
  });
  if (!res.ok) {
    throw new Error(`Supabase update error ${res.status}: ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// シリーズ単位でのグルーピング
// ---------------------------------------------------------------------------

interface SeriesGroup {
  slug: string;
  name: string;
  manufacturerSlug: string;
  sourceUrl: string | null;
  records: LureRecord[];
}

function groupBySeries(records: LureRecord[]): SeriesGroup[] {
  const map = new Map<string, SeriesGroup>();
  for (const r of records) {
    if (!map.has(r.slug)) {
      map.set(r.slug, {
        slug: r.slug,
        name: r.name,
        manufacturerSlug: r.manufacturer_slug,
        sourceUrl: r.source_url,
        records: [],
      });
    }
    map.get(r.slug)!.records.push(r);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// メイン処理: シリーズ単位でスクレイプ → 画像更新
// ---------------------------------------------------------------------------

interface RescrapeResult {
  series: string;
  manufacturer: string;
  status: 'success' | 'skipped' | 'error';
  message: string;
  updatedRecords: number;
  imagesUploaded: number;
}

async function processSeriesGroup(
  group: SeriesGroup,
  dryRun: boolean,
): Promise<RescrapeResult> {
  const { slug, name, manufacturerSlug, sourceUrl, records } = group;
  const resultBase = {
    series: `${manufacturerSlug}/${slug}`,
    manufacturer: manufacturerSlug,
  };

  // source_urlがないシリーズはスキップ
  if (!sourceUrl) {
    return {
      ...resultBase,
      status: 'skipped',
      message: 'source_urlなし',
      updatedRecords: 0,
      imagesUploaded: 0,
    };
  }

  // スクレイパーの存在確認
  const scraper = getScraper(manufacturerSlug);
  if (!scraper) {
    return {
      ...resultBase,
      status: 'skipped',
      message: `スクレイパー未登録: ${manufacturerSlug}`,
      updatedRecords: 0,
      imagesUploaded: 0,
    };
  }

  try {
    // スクレイプ実行
    log(`  スクレイプ中: ${name} (${sourceUrl})`);
    const scraped = await scraper(sourceUrl);

    // スクレイプ結果からカラー名→画像URLのマップを構築
    const colorImageMap = new Map<string, string>();
    for (const color of scraped.colors) {
      if (color.imageUrl) {
        colorImageMap.set(color.name, color.imageUrl);
      }
    }

    // mainImageをフォールバックとして保持
    const fallbackImageUrl = scraped.mainImage || '';

    log(`  スクレイプ結果: ${scraped.colors.length}色, mainImage=${fallbackImageUrl ? 'あり' : 'なし'}`);
    log(`  画像付きカラー: ${[...colorImageMap.values()].filter(v => v).length}/${scraped.colors.length}`);

    if (colorImageMap.size === 0 && !fallbackImageUrl) {
      return {
        ...resultBase,
        status: 'error',
        message: 'スクレイプ結果に画像なし',
        updatedRecords: 0,
        imagesUploaded: 0,
      };
    }

    // 各レコードに対して画像を割り当て・アップロード・更新
    let updatedRecords = 0;
    let imagesUploaded = 0;

    for (const record of records) {
      // カラー名で完全一致を試みる
      let imageSourceUrl = colorImageMap.get(record.color_name);

      // 完全一致しない場合、部分一致を試みる
      if (!imageSourceUrl) {
        for (const [colorName, imgUrl] of colorImageMap) {
          if (
            colorName.toLowerCase().includes(record.color_name.toLowerCase()) ||
            record.color_name.toLowerCase().includes(colorName.toLowerCase())
          ) {
            imageSourceUrl = imgUrl;
            break;
          }
        }
      }

      // それでもなければfallbackを使用
      if (!imageSourceUrl && fallbackImageUrl) {
        imageSourceUrl = fallbackImageUrl;
      }

      if (!imageSourceUrl) {
        log(`    スキップ: ${record.color_name} (画像URLなし)`);
        continue;
      }

      if (dryRun) {
        log(`    [DRY-RUN] 更新予定: id=${record.id}, color=${record.color_name}, image=${imageSourceUrl.substring(0, 80)}...`);
        updatedRecords++;
        continue;
      }

      try {
        // R2にアップロード
        const colorSlug = slugify(record.color_name).substring(0, 40)
          || String(records.indexOf(record) + 1).padStart(2, '0');
        const r2Key = `${manufacturerSlug}/${slug}/${colorSlug}.webp`;
        const publicUrl = await processAndUploadImage(imageSourceUrl, r2Key);
        imagesUploaded++;

        // Supabase更新
        await updateLureImages(record.id, [publicUrl]);
        updatedRecords++;
        log(`    更新完了: id=${record.id}, color=${record.color_name} -> ${publicUrl}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`    画像処理失敗: id=${record.id}, color=${record.color_name}: ${errMsg}`);
      }
    }

    return {
      ...resultBase,
      status: updatedRecords > 0 ? 'success' : 'error',
      message: `${updatedRecords}/${records.length}レコード更新, ${imagesUploaded}画像アップロード`,
      updatedRecords,
      imagesUploaded,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ...resultBase,
      status: 'error',
      message: errMsg,
      updatedRecords: 0,
      imagesUploaded: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const startTime = Date.now();

  log('========================================');
  log('画像欠損レコード再スクレイプ');
  log('========================================');
  if (args.dryRun) {
    log('*** DRY-RUN モード: DB更新なし ***');
  }
  log(`遅延: ${args.delayMs}ms`);

  // 対象メーカーの決定
  let targetManufacturers: string[];

  if (args.all) {
    log('全メーカーの画像欠損を検索中...');
    const mfgList = await fetchManufacturersWithMissingImages();
    targetManufacturers = mfgList
      .filter(m => getScraper(m.manufacturer_slug)) // スクレイパーがあるもののみ
      .map(m => m.manufacturer_slug);
    log(`画像欠損メーカー: ${mfgList.length}件`);
    for (const m of mfgList) {
      const hasScraper = getScraper(m.manufacturer_slug) ? 'OK' : 'N/A';
      log(`  ${m.manufacturer_slug}: ${m.count}件 (scraper: ${hasScraper})`);
    }
  } else {
    // 指定メーカーの検証
    for (const slug of args.manufacturers) {
      if (!getScraper(slug)) {
        logError(`スクレイパー未登録: ${slug}`);
        logError(`登録済み: ${getRegisteredManufacturers().join(', ')}`);
        process.exit(1);
      }
    }
    targetManufacturers = args.manufacturers;
  }

  log(`対象メーカー: ${targetManufacturers.join(', ')}`);
  log('');

  // 全結果を収集
  const allResults: RescrapeResult[] = [];

  for (const mfgSlug of targetManufacturers) {
    log(`=== メーカー: ${mfgSlug} ===`);

    // 画像欠損レコードを取得
    const records = await fetchMissingImageRecords(mfgSlug);
    if (records.length === 0) {
      log(`  画像欠損レコードなし`);
      continue;
    }

    log(`  画像欠損レコード: ${records.length}件`);

    // シリーズにグルーピング
    let seriesGroups = groupBySeries(records);
    log(`  シリーズ数: ${seriesGroups.length}`);

    // limit適用
    if (args.limit > 0) {
      seriesGroups = seriesGroups.slice(0, args.limit);
      log(`  --limit ${args.limit} により ${seriesGroups.length}シリーズに制限`);
    }

    // 各シリーズを処理
    for (let i = 0; i < seriesGroups.length; i++) {
      const group = seriesGroups[i];
      log(`--- [${i + 1}/${seriesGroups.length}] ${group.name} (${group.records.length}レコード) ---`);

      const result = await processSeriesGroup(group, args.dryRun);
      allResults.push(result);

      const icon = result.status === 'success' ? 'OK' : result.status === 'skipped' ? 'SKIP' : 'FAIL';
      log(`  [${icon}] ${result.message}`);

      // レート制限
      if (i < seriesGroups.length - 1) {
        await sleep(args.delayMs);
      }
    }

    log('');
  }

  // サマリー出力
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = allResults.filter(r => r.status === 'success');
  const skipped = allResults.filter(r => r.status === 'skipped');
  const errors = allResults.filter(r => r.status === 'error');

  log('========================================');
  log('再スクレイプ結果サマリー');
  log('========================================');
  log(`シリーズ合計: ${allResults.length}`);
  log(`成功: ${success.length}`);
  log(`スキップ: ${skipped.length}`);
  log(`エラー: ${errors.length}`);
  log(`更新レコード合計: ${allResults.reduce((s, r) => s + r.updatedRecords, 0)}`);
  log(`アップロード画像合計: ${allResults.reduce((s, r) => s + r.imagesUploaded, 0)}`);
  log(`所要時間: ${elapsed}s`);
  if (args.dryRun) {
    log('*** DRY-RUN: 実際のDB更新は行われていません ***');
  }
  log('========================================');

  // エラー詳細
  if (errors.length > 0) {
    log('');
    log('--- エラー詳細 ---');
    for (const r of errors) {
      log(`  ${r.series}: ${r.message}`);
    }
  }

  // スキップ詳細
  if (skipped.length > 0) {
    log('');
    log('--- スキップ詳細 ---');
    for (const r of skipped) {
      log(`  ${r.series}: ${r.message}`);
    }
  }
}

main().catch((err) => {
  logError(`致命的エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
