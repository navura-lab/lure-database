// scripts/_spro-image-fix.ts
// SPRO 画像修正スクリプト
//
// 問題:
// 1. shimmy-semi-long の UNRIG カラーに画像がない（null）
//    → 同じカラーのリグド版（180g-unrigged slug内の非UNRIG版）から画像をコピー
// 2. Shopify側に画像が存在しない商品（wacky-snack, surface-swimmer）は
//    Shopify APIから取得不可 → スキップ（ログに記録）
// 3. default.webp パスの画像は実際にR2に存在し正常 → 修正不要

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

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[spro-image-fix] ${msg}`);
}

function logError(msg: string) {
  console.error(`[spro-image-fix] ERROR: ${msg}`);
}

async function downloadAndUploadToR2(sourceUrl: string, r2Key: string): Promise<string> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${sourceUrl}`);
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

async function r2KeyExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

interface ShopifyImage {
  id: number;
  src: string;
  variant_ids: number[];
}

interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  image_id: number | null;
}

interface ShopifyProduct {
  title: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
  options: { name: string; values: string[] }[];
}

async function fetchShopifyProduct(handle: string): Promise<ShopifyProduct | null> {
  const url = `https://www.spro.com/products/${handle}.json`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`Shopify API error: ${resp.status} for ${handle}`);
  }
  const { product } = await resp.json() as { product: ShopifyProduct };
  return product;
}

// ---------------------------------------------------------------------------
// Phase 1: shimmy-semi-long UNRIG画像修正
// ---------------------------------------------------------------------------

async function fixShimmySemiLongUnrig() {
  log('=== Phase 1: shimmy-semi-long UNRIG画像修正 ===');

  // 全 shimmy-semi-long レコードを取得
  const slugs = [
    'shimmy-semi-long-180g-unrigged',
    'shimmy-semi-long-230g-unrigged',
    'shimmy-semi-long-280g-unrig',
  ];

  // まず、画像があるレコードからカラー→画像URLのマップを作成
  // base color name（UNRIG除去）→ R2画像URL
  const colorImageMap = new Map<string, string>();

  for (const slug of slugs) {
    const { data, error } = await sb.from('lures')
      .select('color_name, images')
      .eq('manufacturer_slug', 'spro')
      .eq('slug', slug)
      .not('images', 'is', null);

    if (error) { logError(`Query error: ${error.message}`); continue; }

    for (const r of data || []) {
      if (!r.images?.[0]) continue;
      const baseColor = r.color_name.replace(/\s+UNRIG(GED)?$/i, '').trim();
      if (!colorImageMap.has(baseColor)) {
        colorImageMap.set(baseColor, r.images[0]);
      }
    }
  }

  log(`既存画像マップ: ${colorImageMap.size}色`);
  for (const [color, url] of colorImageMap) {
    log(`  ${color} -> ${url.split('/').slice(-2).join('/')}`);
  }

  // null画像レコードを修正
  let fixed = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const { data, error } = await sb.from('lures')
      .select('id, slug, color_name, images, weight')
      .eq('manufacturer_slug', 'spro')
      .eq('slug', slug)
      .is('images', null);

    if (error) { logError(`Query error: ${error.message}`); continue; }
    if (!data || data.length === 0) {
      log(`${slug}: null画像レコードなし`);
      continue;
    }

    log(`${slug}: ${data.length}件のnull画像レコード`);

    for (const r of data) {
      let baseColor = r.color_name.replace(/\s+UNRIG(GED)?$/i, '').trim();
      // タイポ修正: "TEUILA" → "TEQUILA"
      baseColor = baseColor.replace(/^TEUILA\b/, 'TEQUILA');
      const imageUrl = colorImageMap.get(baseColor);

      if (!imageUrl) {
        log(`  ${r.color_name}: 対応する画像なし（base: ${baseColor}）→ Shopifyから取得を試行`);
        // Shopify の rigged 版から画像を取得
        const handle = `shimmy-semi-long-${slugify(baseColor).substring(0, 40)}`;
        const shopifyImage = await tryFetchShopifyImage(handle, slug, r.color_name);
        if (shopifyImage) {
          if (!DRY_RUN) {
            const { error: updateErr } = await sb.from('lures')
              .update({ images: [shopifyImage] })
              .eq('id', r.id);
            if (updateErr) logError(`  Update failed: ${updateErr.message}`);
            else { log(`  ✓ ${r.color_name} -> ${shopifyImage.split('/').pop()}`); fixed++; }
          } else {
            log(`  [DRY RUN] ${r.color_name} -> ${shopifyImage}`);
            fixed++;
          }
        } else {
          log(`  ✗ ${r.color_name}: Shopifyにも画像なし`);
          skipped++;
        }
        continue;
      }

      if (DRY_RUN) {
        log(`  [DRY RUN] ${r.color_name} -> ${imageUrl.split('/').slice(-2).join('/')}`);
        fixed++;
        continue;
      }

      const { error: updateErr } = await sb.from('lures')
        .update({ images: [imageUrl] })
        .eq('id', r.id);

      if (updateErr) {
        logError(`  Update failed for ${r.color_name}: ${updateErr.message}`);
      } else {
        log(`  ✓ ${r.color_name} -> ${imageUrl.split('/').slice(-2).join('/')}`);
        fixed++;
      }
    }
  }

  log(`Phase 1完了: ${fixed}件修正, ${skipped}件スキップ`);
  return { fixed, skipped };
}

async function tryFetchShopifyImage(
  handle: string,
  targetSlug: string,
  colorName: string,
): Promise<string | null> {
  try {
    const product = await fetchShopifyProduct(handle);
    if (!product || product.images.length === 0) return null;

    const shopifySrc = product.images[0].src;
    const colorSlug = slugify(colorName).substring(0, 40) || 'default';
    const r2Key = `spro/${targetSlug}/${colorSlug}.webp`;

    if (DRY_RUN) return `${R2_PUBLIC_URL}/${r2Key}`;

    const publicUrl = await downloadAndUploadToR2(shopifySrc, r2Key);
    return publicUrl;
  } catch (e: any) {
    logError(`  Shopify fetch failed for ${handle}: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: default.webpパスの実在チェック（サンプリング）
// ---------------------------------------------------------------------------

async function verifyDefaultWebpImages() {
  log('=== Phase 2: default.webp画像の実在確認 ===');

  // default.webp を含む画像のサンプルをチェック
  const { data, error } = await sb.from('lures')
    .select('slug, color_name, images')
    .eq('manufacturer_slug', 'spro')
    .not('images', 'is', null)
    .limit(1000);

  if (error) { logError(`Query error: ${error.message}`); return { ok: 0, broken: 0 }; }

  const defaultWebpRecords = data!.filter(
    r => r.images?.[0]?.includes('default.webp')
  );

  log(`default.webpレコード: ${defaultWebpRecords.length}件`);

  // ユニークなURLをサンプリング（最大20件）
  const uniqueUrls = [...new Set(defaultWebpRecords.map(r => r.images![0]))];
  const sample = uniqueUrls.slice(0, 20);

  let ok = 0;
  let broken = 0;

  for (const url of sample) {
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (resp.ok) {
        ok++;
      } else {
        log(`  BROKEN: ${url} -> HTTP ${resp.status}`);
        broken++;
      }
    } catch (e: any) {
      log(`  BROKEN: ${url} -> ${e.message}`);
      broken++;
    }
  }

  log(`サンプル ${sample.length}件中: OK ${ok}, BROKEN ${broken}`);

  if (broken > 0) {
    log('壊れた画像がある場合、Shopify APIから再取得が必要');
  }

  return { ok, broken };
}

// ---------------------------------------------------------------------------
// Phase 3: Shopify画像が存在しない商品への対応
// ---------------------------------------------------------------------------

async function reportNoImageProducts() {
  log('=== Phase 3: Shopify画像なし商品レポート ===');

  const noImageSlugs = ['wacky-snack-5-25', 'surface-swimmer-4-75'];

  for (const slug of noImageSlugs) {
    const { data } = await sb.from('lures')
      .select('id, color_name, images')
      .eq('manufacturer_slug', 'spro')
      .eq('slug', slug)
      .is('images', null);

    log(`${slug}: ${data?.length || 0}件（Shopify側に画像なし → 修正不可）`);
    if (data) {
      for (const r of data) {
        log(`  - ${r.color_name}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 4: default.webp の壊れたURLを Shopify から再取得
// ---------------------------------------------------------------------------

async function fixBrokenDefaultWebp() {
  log('=== Phase 4: 壊れたdefault.webp画像をShopifyから再取得 ===');

  // 全 default.webp レコードをチェック
  const allSpro: { id: string; slug: string; color_name: string; images: string[] | null; source_url: string }[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('lures')
      .select('id, slug, color_name, images, source_url')
      .eq('manufacturer_slug', 'spro')
      .not('images', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) { logError(`Query error: ${error.message}`); break; }
    allSpro.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  const defaultWebp = allSpro.filter(r => r.images?.[0]?.includes('default.webp'));
  log(`default.webpレコード: ${defaultWebp.length}件`);

  // ユニークURL → 実在確認
  const urlToRecords = new Map<string, typeof defaultWebp>();
  for (const r of defaultWebp) {
    const url = r.images![0];
    if (!urlToRecords.has(url)) urlToRecords.set(url, []);
    urlToRecords.get(url)!.push(r);
  }

  log(`ユニークURL: ${urlToRecords.size}件 → 実在確認中...`);

  let ok = 0;
  let brokenFixed = 0;
  let brokenFailed = 0;

  for (const [url, records] of urlToRecords) {
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (resp.ok) {
        ok++;
        continue;
      }
    } catch {
      // 壊れた画像
    }

    // 壊れた → source_url からShopify画像を再取得
    const record = records[0];
    const sourceUrl = record.source_url;
    if (!sourceUrl) {
      logError(`  ${record.slug}/${record.color_name}: source_urlなし`);
      brokenFailed++;
      continue;
    }

    const handle = sourceUrl.split('/products/')[1]?.replace(/\/$/, '');
    if (!handle) {
      logError(`  ${record.slug}/${record.color_name}: handleパース失敗 (${sourceUrl})`);
      brokenFailed++;
      continue;
    }

    log(`  壊れた画像修復中: ${record.slug}/${record.color_name} (handle: ${handle})`);

    try {
      const product = await fetchShopifyProduct(handle);
      if (!product || product.images.length === 0) {
        log(`  → Shopifyに画像なし`);
        brokenFailed++;
        continue;
      }

      const shopifySrc = product.images[0].src;
      // R2キーを元のURLから逆算
      const r2Key = url.replace(`${R2_PUBLIC_URL}/`, '');

      if (DRY_RUN) {
        log(`  [DRY RUN] → ${shopifySrc} -> ${r2Key}`);
        brokenFixed++;
        continue;
      }

      await downloadAndUploadToR2(shopifySrc, r2Key);
      log(`  ✓ R2に再アップロード完了: ${r2Key}`);
      brokenFixed++;
    } catch (e: any) {
      logError(`  修復失敗: ${e.message}`);
      brokenFailed++;
    }
  }

  log(`Phase 4完了: OK ${ok}, 修復 ${brokenFixed}, 失敗 ${brokenFailed}`);
  return { ok, brokenFixed, brokenFailed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`開始 ${DRY_RUN ? '(DRY RUN)' : ''}`);

  // Phase 1: UNRIG画像をリグド版からコピー
  const phase1 = await fixShimmySemiLongUnrig();

  // Phase 2: default.webpサンプル確認
  const phase2 = await verifyDefaultWebpImages();

  // Phase 3: Shopify画像なし商品レポート
  await reportNoImageProducts();

  // Phase 4: 壊れたdefault.webpをShopifyから再取得（Phase 2で壊れが見つかった場合）
  if (phase2.broken > 0) {
    await fixBrokenDefaultWebp();
  } else {
    log('=== Phase 4: スキップ（壊れた画像なし） ===');
  }

  log('');
  log('=== サマリ ===');
  log(`Phase 1 (UNRIG修正): ${phase1.fixed}件修正, ${phase1.skipped}件スキップ`);
  log(`Phase 2 (default.webp確認): OK ${phase2.ok}, BROKEN ${phase2.broken}`);
  log('Phase 3 (画像なし商品): wacky-snack-5-25, surface-swimmer-4-75 → Shopify側に画像なし');
  log(`完了 ${DRY_RUN ? '(DRY RUN - DBに変更なし)' : ''}`);
}

main().catch(e => {
  logError(e.message);
  process.exit(1);
});
