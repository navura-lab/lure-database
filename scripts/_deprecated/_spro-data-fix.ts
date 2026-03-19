// scripts/_spro-data-fix.ts
// SPRO データ品質修復スクリプト
//
// 問題: detectOptionMapping バグにより color_name に Size/Weight 値が入っている (2,527件)
//       同一 slug+color_name の重複レコード (90組+)
//       color x weight クロス積でレコード爆発 (7,373件)
//
// 修正手順:
//   1. 既存 SPRO 全レコード削除（Supabase）
//   2. SPRO 商品を Shopify API から再ディスカバリー
//   3. 修正済みスクレイパーで各商品をスクレイプ
//   4. 画像を R2 にアップロード
//   5. クリーンなレコードを Supabase に挿入
//
// 使い方: npx tsx scripts/_spro-data-fix.ts [--dry-run]

import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_REGION,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  IMAGE_WIDTH,
} from './config.js';
import { scrapeSproPage } from './scrapers/shopify-brands.js';
import { normalizeType } from './lib/normalize-type.js';
import { slugify } from '../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MANUFACTURER_SLUG = 'spro';
const MANUFACTURER_NAME = 'SPRO';
const SCRAPE_DELAY_MS = 1500; // Shopifyレート制限対策

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

function ts(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${ts()}] ${msg}`); }
function logError(msg: string): void { console.error(`[${ts()}] ERROR: ${msg}`); }

// ---------------------------------------------------------------------------
// R2 クライアント
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const resp = await fetch(imageUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!resp.ok) throw new Error(`Image download failed: ${resp.status} ${imageUrl}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const webpBuffer = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: webpBuffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Supabase ヘルパー
// ---------------------------------------------------------------------------

async function supabaseRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${options.method || 'GET'} ${path}: ${res.status} ${body}`);
  }
  return res;
}

async function deleteAllSproRecords(): Promise<number> {
  // まず件数を取得
  const countRes = await supabaseRequest(
    `/lures?manufacturer_slug=eq.${MANUFACTURER_SLUG}&select=id`,
    { headers: { 'Prefer': 'count=exact' } as any },
  );
  const rows = await countRes.json() as Array<{ id: number }>;
  const count = rows.length;

  if (count === 0) {
    log('SPRO レコードなし、削除スキップ');
    return 0;
  }

  log(`SPRO レコード ${count} 件を削除中...`);

  if (DRY_RUN) {
    log('[DRY RUN] 削除スキップ');
    return count;
  }

  // Supabase REST APIは DELETE でフィルタ条件を渡す
  // ただし大量削除はバッチ必要（Supabase制限）
  // 1000件ずつ削除
  let deleted = 0;
  while (deleted < count) {
    const res = await supabaseRequest(
      `/lures?manufacturer_slug=eq.${MANUFACTURER_SLUG}&limit=1000`,
      {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' } as any,
      },
    );
    const deletedRows = await res.json() as unknown[];
    if (deletedRows.length === 0) break;
    deleted += deletedRows.length;
    log(`  削除済み: ${deleted} / ${count}`);
  }

  log(`✅ ${deleted} 件削除完了`);
  return deleted;
}

async function insertLure(row: Record<string, unknown>): Promise<void> {
  await supabaseRequest('/lures', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' } as any,
    body: JSON.stringify(row),
  });
}

async function lureExists(slug: string, colorName: string, weight: number | null): Promise<boolean> {
  let q = `slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
  q += weight !== null ? `&weight=eq.${weight}` : '&weight=is.null';
  q += '&select=id&limit=1';
  const res = await supabaseRequest(`/lures?${q}`);
  const rows = await res.json() as unknown[];
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// SPRO ディスカバリー（Shopify products.json API）
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  title: string;
  handle: string;
}

async function discoverSproProducts(): Promise<DiscoveredProduct[]> {
  log('SPRO 商品をディスカバリー中...');
  const results: DiscoveredProduct[] = [];
  const seen = new Set<string>();
  let page = 1;

  while (true) {
    const apiUrl = `https://www.spro.com/products.json?limit=250&page=${page}`;
    const resp = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) {
      if (page === 1) throw new Error(`SPRO products.json 取得失敗: ${resp.status}`);
      break;
    }
    const json = await resp.json() as {
      products: Array<{ handle: string; title: string; vendor: string; product_type: string }>
    };
    if (!json.products || json.products.length === 0) break;

    for (const p of json.products) {
      // SPRO ブランドのみ
      if (!/spro/i.test(p.vendor)) continue;
      const url = `https://www.spro.com/products/${p.handle}`;
      if (seen.has(url)) continue;
      seen.add(url);

      // 非ルアー除外
      const combined = `${p.handle} ${p.title} ${p.product_type}`.toLowerCase();
      if (/hook|sinker|weight(?!.*bait)|tool|plier|net(?!.*bait)|bag|hat|shirt|apparel|gift|rod|reel|line(?!.*bait)|leader|promo|trucker|cap\b/i.test(combined)) {
        log(`  除外（非ルアー）: ${p.title}`);
        continue;
      }

      results.push({ url, title: p.title || p.handle.replace(/-/g, ' '), handle: p.handle });
    }

    page++;
    if (page > 10) break;
  }

  log(`✅ ${results.length} 商品をディスカバリー`);
  return results;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

async function main() {
  log('=== SPRO データ修復開始 ===');
  if (DRY_RUN) log('⚠️ DRY RUN モード（DB変更なし）');

  // Step 1: 既存レコード削除
  log('\n--- Step 1: 既存 SPRO レコード削除 ---');
  const deletedCount = await deleteAllSproRecords();

  // Step 2: 商品ディスカバリー
  log('\n--- Step 2: SPRO 商品ディスカバリー ---');
  const products = await discoverSproProducts();

  // Step 3: 各商品をスクレイプ + 画像アップロード + Supabase 挿入
  log('\n--- Step 3: スクレイプ + R2 + Supabase ---');

  let totalInserted = 0;
  let totalErrors = 0;
  const slugColorCounts = new Map<string, number>(); // slug → 色数

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    log(`\n[${i + 1}/${products.length}] ${product.title} (${product.url})`);

    try {
      // スクレイプ
      const scraped = await scrapeSproPage(product.url);

      // 非ルアー商品スキップ
      if (scraped.type === '__non_lure__') {
        log(`  ⏭️ 非ルアー商品スキップ: ${scraped.name}`);
        continue;
      }

      // タイプ正規化
      scraped.type = normalizeType(scraped.type);

      // USメーカーの「その他」はスキップ
      if (scraped.type === 'その他') {
        log(`  ⏭️ 未分類商品スキップ: ${scraped.name} (type=その他)`);
        continue;
      }

      // カラーが空の場合、デフォルトエントリ作成
      if (scraped.colors.length === 0) {
        log(`  カラーなし → デフォルトエントリ作成`);
        scraped.colors = [{ name: '(default)', imageUrl: scraped.mainImage || '' }];
      }

      log(`  スクレイプ成功: ${scraped.name}, ${scraped.colors.length}色, ${scraped.weights.length}ウェイト`);

      if (DRY_RUN) {
        log(`  [DRY RUN] 挿入スキップ`);
        continue;
      }

      // 画像アップロード
      const colorImageMap = new Map<string, string>();
      for (let ci = 0; ci < scraped.colors.length; ci++) {
        const color = scraped.colors[ci];
        if (!color.imageUrl) continue;
        try {
          const colorSlug = slugify(color.name).substring(0, 40)
            || String(ci + 1).padStart(2, '0');
          const r2Key = `${MANUFACTURER_SLUG}/${scraped.slug}/${colorSlug}.webp`;
          const publicUrl = await processAndUploadImage(color.imageUrl, r2Key);
          colorImageMap.set(color.name, publicUrl);
        } catch (err) {
          logError(`  画像処理失敗 (${color.name}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      log(`  画像アップロード: ${colorImageMap.size}/${scraped.colors.length}色`);

      // Supabase 挿入（color x weight）
      const weights: (number | null)[] = scraped.weights.length > 0 ? scraped.weights : [null];
      let inserted = 0;

      for (const color of scraped.colors) {
        for (const weight of weights) {
          // 重複チェック
          const exists = await lureExists(scraped.slug, color.name, weight);
          if (exists) {
            log(`  スキップ（既存）: ${scraped.slug} / ${color.name} / ${weight}g`);
            continue;
          }

          const imageUrl = colorImageMap.get(color.name) || null;
          const row: Record<string, unknown> = {
            name: scraped.name,
            name_kana: scraped.name_kana || scraped.name,
            slug: scraped.slug,
            manufacturer: MANUFACTURER_NAME,
            manufacturer_slug: MANUFACTURER_SLUG,
            type: scraped.type,
            target_fish: scraped.target_fish?.length ? scraped.target_fish : null,
            price: scraped.price,
            description: scraped.description || null,
            images: imageUrl ? [imageUrl] : null,
            color_name: color.name,
            weight: weight,
            length: scraped.length,
            source_url: scraped.sourceUrl || product.url,
            is_limited: false,
            is_discontinued: false,
          };

          try {
            await insertLure(row);
            inserted++;
          } catch (err) {
            logError(`  挿入失敗: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      totalInserted += inserted;
      slugColorCounts.set(scraped.slug, (slugColorCounts.get(scraped.slug) || 0) + scraped.colors.length);
      log(`  ✅ ${inserted} 行挿入 (${scraped.colors.length}色 x ${weights.length}ウェイト)`);

    } catch (err) {
      totalErrors++;
      logError(`  スクレイプ失敗: ${err instanceof Error ? err.message : String(err)}`);
    }

    // レート制限対策
    if (i < products.length - 1) {
      await new Promise(r => setTimeout(r, SCRAPE_DELAY_MS));
    }
  }

  // サマリー
  log('\n=== SPRO データ修復完了 ===');
  log(`  削除: ${deletedCount} 件`);
  log(`  ディスカバリー: ${products.length} 商品`);
  log(`  挿入: ${totalInserted} 件`);
  log(`  ユニーク slug: ${slugColorCounts.size} 件`);
  log(`  エラー: ${totalErrors} 件`);

  if (slugColorCounts.size > 0) {
    log('\n--- slug別カラー数 ---');
    for (const [slug, count] of [...slugColorCounts.entries()].sort((a, b) => b[1] - a[1])) {
      log(`  ${slug}: ${count}色`);
    }
  }
}

main().catch(err => {
  logError(`致命的エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
