// scripts/_spro-image-quality-fix.ts
// SPRO画像品質問題の根本修正
//
// 1. R2上のSPRO全画像のContent-Lengthを確認
// 2. 5KB未満のプレースホルダー画像を検出
// 3. Shopify APIから正しい商品画像を再取得→R2再アップロード→Supabase更新
// 4. Shopify側に画像がない場合はimagesをnullに

import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import {
  R2_ENDPOINT,
  R2_BUCKET,
  R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_REGION,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  IMAGE_WIDTH,
} from './config.js';
import { slugify } from '../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

const MIN_IMAGE_SIZE_BYTES = 5000; // 5KB未満はプレースホルダー疑い
const SHOPIFY_BASE = 'https://www.spro.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BATCH_SIZE = 10; // 並列処理バッチサイズ
const MANUFACTURER_SLUG = 'spro';

// ---------------------------------------------------------------------------
// クライアント
// ---------------------------------------------------------------------------

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ---------------------------------------------------------------------------
// Shopify API: 全商品をキャッシュ
// ---------------------------------------------------------------------------

interface ShopifyImage {
  id: number;
  src: string;
  variant_ids: number[];
}

interface ShopifyProduct {
  id: number;
  handle: string;
  title: string;
  images: ShopifyImage[];
  variants: Array<{
    id: number;
    title: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    image_id: number | null;
  }>;
  options: Array<{
    name: string;
    position: number;
    values: string[];
  }>;
}

async function fetchAllShopifyProducts(): Promise<Map<string, ShopifyProduct>> {
  const map = new Map<string, ShopifyProduct>();
  let page = 1;
  let hasMore = true;

  console.log('Shopify全商品を取得中...');
  while (hasMore) {
    const resp = await fetch(`${SHOPIFY_BASE}/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!resp.ok) {
      console.error(`Shopify API error: ${resp.status}`);
      break;
    }
    const json = (await resp.json()) as { products: ShopifyProduct[] };
    if (json.products.length === 0) break;

    for (const p of json.products) {
      map.set(p.handle, p);
    }
    page++;
    if (json.products.length < 250) hasMore = false;
  }
  console.log(`  → ${map.size}件の商品を取得`);
  return map;
}

// ---------------------------------------------------------------------------
// R2画像処理
// ---------------------------------------------------------------------------

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`画像DL失敗: ${response.status} ${imageUrl}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const webpBuffer = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // 5KB未満チェック（変換後も小さすぎる場合はスキップ）
  if (webpBuffer.length < MIN_IMAGE_SIZE_BYTES) {
    throw new Error(`変換後も小さすぎる (${webpBuffer.length} bytes): ${imageUrl}`);
  }

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
// Shopify商品からカラー名→画像URLのマッピングを構築
// ---------------------------------------------------------------------------

function buildColorImageMap(product: ShopifyProduct): Map<string, string> {
  const map = new Map<string, string>();

  // option のどのpositionがcolorか検出
  let colorOptionKey: 'option1' | 'option2' | 'option3' | null = null;
  for (const opt of product.options) {
    if (/color|colour/i.test(opt.name.toLowerCase())) {
      colorOptionKey = `option${opt.position}` as any;
      break;
    }
  }

  if (colorOptionKey) {
    for (const v of product.variants) {
      const colorName = v[colorOptionKey]?.trim();
      if (!colorName || map.has(colorName)) continue;

      // バリアント→画像の紐付け
      let imgSrc = '';
      if (v.image_id) {
        const img = product.images.find(i => i.id === v.image_id);
        if (img) imgSrc = img.src;
      }
      if (!imgSrc) {
        const img = product.images.find(i => i.variant_ids.includes(v.id));
        if (img) imgSrc = img.src;
      }
      if (imgSrc) {
        map.set(colorName, imgSrc);
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

interface LureRow {
  id: number;
  slug: string;
  color_name: string | null;
  images: string[] | null;
  name: string;
}

async function main() {
  console.log('=== SPRO画像品質修正 ===\n');

  // 1. Supabase上のSPRO全ルアーを取得
  console.log('Step 1: Supabase上のSPRO全ルアーを取得...');
  const allRows: LureRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('id, slug, color_name, images, name')
      .eq('manufacturer_slug', MANUFACTURER_SLUG)
      .range(offset, offset + 999);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allRows.push(...(data as LureRow[]));
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  → ${allRows.length}件のSPROルアー`);

  // 2. R2上の画像サイズを確認（プレースホルダー検出）
  console.log('\nStep 2: R2画像サイズを確認...');
  const withImages = allRows.filter(r => r.images && r.images.length > 0);
  const withoutImages = allRows.filter(r => !r.images || r.images.length === 0);
  console.log(`  画像あり: ${withImages.length}件`);
  console.log(`  画像なし: ${withoutImages.length}件`);

  const placeholders: LureRow[] = [];
  const okRows: LureRow[] = [];

  for (let i = 0; i < withImages.length; i += BATCH_SIZE * 2) {
    const batch = withImages.slice(i, i + BATCH_SIZE * 2);
    const results = await Promise.all(
      batch.map(async (row) => {
        const url = row.images![0];
        try {
          const resp = await fetch(url, { method: 'HEAD' });
          const cl = parseInt(resp.headers.get('content-length') || '0', 10);
          return { row, size: cl };
        } catch {
          return { row, size: 0 };
        }
      }),
    );
    for (const { row, size } of results) {
      if (size < MIN_IMAGE_SIZE_BYTES) {
        placeholders.push(row);
      } else {
        okRows.push(row);
      }
    }
    if ((i + BATCH_SIZE * 2) % 200 === 0) {
      console.log(`  ... ${Math.min(i + BATCH_SIZE * 2, withImages.length)}/${withImages.length} チェック済み`);
    }
  }

  console.log(`\n=== 画像品質統計 ===`);
  console.log(`OK (>=5KB): ${okRows.length}`);
  console.log(`プレースホルダー (<5KB): ${placeholders.length}`);
  console.log(`画像なし: ${withoutImages.length}`);

  if (placeholders.length === 0) {
    console.log('\nプレースホルダー画像なし。終了。');
    return;
  }

  // 3. Shopify全商品を取得
  console.log('\nStep 3: Shopify APIから全商品を取得...');
  const shopifyProducts = await fetchAllShopifyProducts();

  // 4. プレースホルダー画像の修正
  console.log('\nStep 4: プレースホルダー画像を修正...');

  // slugごとにグループ化
  const slugGroups = new Map<string, LureRow[]>();
  for (const row of placeholders) {
    const existing = slugGroups.get(row.slug) || [];
    existing.push(row);
    slugGroups.set(row.slug, existing);
  }
  console.log(`  対象slug: ${slugGroups.size}件`);

  let fixed = 0;
  let nulled = 0;
  let failed = 0;

  for (const [slug, rows] of slugGroups) {
    // slugからShopify handleを探す
    // DB slug = ベース名（例: "shimmy-flat"）
    // Shopify handle = カラー別（例: "shimmy-flat-tequila-sunrise-glow-unrigged"）
    // まずはR2キーからShopify handleを推測

    // 方法1: DB slugと一致するhandleを探す
    let product = shopifyProducts.get(slug);

    // 方法2: handleにslugが含まれるものを探す
    if (!product) {
      for (const [handle, p] of shopifyProducts) {
        if (handle.startsWith(slug + '-') || handle === slug) {
          product = p;
          break;
        }
      }
    }

    // 方法3: R2 URLからhandle部分を抽出して探す
    if (!product && rows[0].images?.[0]) {
      const r2Key = rows[0].images[0].replace(`${R2_PUBLIC_URL}/spro/`, '');
      // spro/XXX/YYY.webp → XXX がhandleの可能性
      const handleCandidate = r2Key.split('/')[0];
      product = shopifyProducts.get(handleCandidate);
    }

    if (!product || product.images.length === 0) {
      // Shopify側にも画像がない→imagesをnullに
      for (const row of rows) {
        const { error } = await sb
          .from('lures')
          .update({ images: null })
          .eq('id', row.id);
        if (error) {
          console.error(`  ✗ ${slug}/${row.color_name}: Supabase更新失敗`, error.message);
          failed++;
        } else {
          nulled++;
        }
      }
      console.log(`  ✗ ${slug}: Shopify画像なし → ${rows.length}件をnullに`);
      continue;
    }

    // カラー→画像マッピング
    const colorImageMap = buildColorImageMap(product);
    const fallbackImage = product.images[0]?.src || '';

    for (const row of rows) {
      const colorName = row.color_name || '(default)';

      // Shopifyから画像URLを取得
      let sourceUrl = colorImageMap.get(colorName) || '';

      // カラー名がマッチしない場合、部分一致で探す
      if (!sourceUrl) {
        const colorLower = colorName.toLowerCase();
        for (const [cn, url] of colorImageMap) {
          if (cn.toLowerCase().includes(colorLower) || colorLower.includes(cn.toLowerCase())) {
            sourceUrl = url;
            break;
          }
        }
      }

      // それでもない場合、フォールバック画像を使う
      if (!sourceUrl) {
        sourceUrl = fallbackImage;
      }

      if (!sourceUrl) {
        // 画像が一切ない
        const { error } = await sb
          .from('lures')
          .update({ images: null })
          .eq('id', row.id);
        if (!error) nulled++;
        else failed++;
        continue;
      }

      try {
        const colorSlug = slugify(colorName).substring(0, 40) || 'default';
        const r2Key = `${MANUFACTURER_SLUG}/${slug}/${colorSlug}.webp`;
        const publicUrl = await processAndUploadImage(sourceUrl, r2Key);

        // Supabase更新
        const { error } = await sb
          .from('lures')
          .update({ images: [publicUrl] })
          .eq('id', row.id);
        if (error) {
          console.error(`  ✗ ${slug}/${colorName}: Supabase更新失敗`, error.message);
          failed++;
        } else {
          fixed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 変換後も小さい場合はnullに
        if (msg.includes('小さすぎる')) {
          const { error } = await sb
            .from('lures')
            .update({ images: null })
            .eq('id', row.id);
          if (!error) nulled++;
          else failed++;
          console.log(`  ⚠ ${slug}/${colorName}: Shopify画像も小さい → null`);
        } else {
          console.error(`  ✗ ${slug}/${colorName}: ${msg}`);
          failed++;
        }
      }
    }

    if (fixed > 0 || nulled > 0) {
      process.stdout.write(`  ✓ ${slug}: fixed=${fixed > 0 ? '+' : ''}${rows.length}件処理完了\r`);
    }
  }

  console.log(`\n\n=== 完了 ===`);
  console.log(`修正済み: ${fixed}`);
  console.log(`null化: ${nulled}`);
  console.log(`失敗: ${failed}`);
  console.log(`合計処理: ${fixed + nulled + failed}/${placeholders.length}`);
}

main().catch(console.error);
