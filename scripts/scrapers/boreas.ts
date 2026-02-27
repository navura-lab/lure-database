// scripts/scrapers/boreas.ts
// BOREAS scraper — Shopify JSON API (flashpointonlineshop.com)
// fetch-only, no Playwright needed

import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_REGION,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  AIRTABLE_PAT, AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID, AIRTABLE_MAKER_TABLE_ID,
  IMAGE_WIDTH,
} from '../config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'BOREAS';
const MANUFACTURER_SLUG = 'boreas';
const SHOP_BASE = 'https://flashpointonlineshop.com';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Products to EXCLUDE (non-lure: sinkers, tubes, apparel, stickers)
const EXCLUDE_HANDLES = new Set([
  'anostsinker', 'anostsinkertg', 'anostsinkerftb', 'anosttube',
]);
const EXCLUDE_TYPES_LOWER = ['cap', 'hat', 't-shirt', 'tee', 'apparel', 'sticker', 'wear', 'sinker'];
const EXCLUDE_TITLE_LOWER = ['キャップ', 'tシャツ', 'ステッカー', 'sinker', 'シンカー', 'tube', 'チューブ', 'デニム'];

// Type detection from product type / title
function detectLureType(productType: string, title: string): string {
  const t = (productType + ' ' + title).toLowerCase();
  if (t.includes('soft bait') || t.includes('worm') || t.includes('straight') || t.includes('slider') || t.includes('devil')) return 'ワーム';
  if (t.includes('chatter')) return 'チャターベイト';
  if (t.includes('jig') && !t.includes('chatter')) return 'ラバージグ';
  if (t.includes('flacker') || t.includes('blade')) return 'ブレードベイト';
  return 'ルアー';
}

// Parse length from title (e.g., "ANOSTRAIGHT 7"" → 7 inches → ~178mm)
function parseLengthFromTitle(title: string): number | null {
  // Match patterns like: 2.5", 3.8", 7", 10", 13"
  const m = title.match(/(\d+(?:\.\d+)?)[""＂]/);
  if (m) {
    const inches = parseFloat(m[1]);
    return Math.round(inches * 25.4); // convert to mm
  }
  return null;
}

// Parse weight from title/body (e.g., "1/4oz", "38g")
function parseWeightFromText(text: string): number | null {
  // Match "XXg"
  const gMatch = text.match(/(\d+(?:\.\d+)?)\s*g(?:\s|$|[,)])/i);
  if (gMatch) return parseFloat(gMatch[1]);
  // Match "X/Yoz" fractions
  const ozMatch = text.match(/(\d+)\/(\d+)\s*oz/i);
  if (ozMatch) {
    const oz = parseInt(ozMatch[1]) / parseInt(ozMatch[2]);
    return Math.round(oz * 28.3495 * 10) / 10;
  }
  // Match "X.Yoz"
  const ozDecMatch = text.match(/(\d+(?:\.\d+)?)\s*oz/i);
  if (ozDecMatch) return Math.round(parseFloat(ozDecMatch[1]) * 28.3495 * 10) / 10;
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
}

interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  price: string;
  compare_at_price: string | null;
  image_id: number | null;
  available: boolean;
}

interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  position: number;
  variant_ids: number[];
}

interface ScrapedColor {
  name: string;
  imageUrl: string | null;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  type: string;
  price: number;
  description: string;
  length: number | null;
  weight: number | null;
  weights: number[];
  colors: ScrapedColor[];
  mainImage: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}
function log(msg: string): void {
  console.log(`[${timestamp()}] [boreas] ${msg}`);
}
function logError(msg: string): void {
  console.error(`[${timestamp()}] [boreas] ERROR: ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Clean up Shopify color name: "#1グリーンパンプキン" → "グリーンパンプキン"
// But keep the number prefix for uniqueness: "#1 グリーンパンプキン"
function cleanColorName(raw: string): string {
  // Remove leading # and number, keeping the color name text
  const cleaned = raw.replace(/^#\d+\s*/, '').trim();
  if (!cleaned) return raw.replace(/^#/, '').trim(); // fallback
  return cleaned;
}

// ---------------------------------------------------------------------------
// R2 client
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
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image download failed: ${res.status} ${imageUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const webp = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: webp,
    ContentType: 'image/webp',
  }));
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function lureExists(slug: string, colorName: string, weight: number | null): Promise<boolean> {
  let q = `slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
  q += weight !== null ? `&weight=eq.${weight}` : '&weight=is.null';
  q += '&select=id&limit=1';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures?${q}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase query error: ${res.status}`);
  return ((await res.json()) as unknown[]).length > 0;
}

async function insertLure(row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert error ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch<T>(tableId: string, path: string = '', options: RequestInit = {}): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function findMakerRecordId(): Promise<string> {
  const filter = encodeURIComponent(`{Slug}='${MANUFACTURER_SLUG}'`);
  const data = await airtableFetch<{ records: { id: string }[] }>(
    AIRTABLE_MAKER_TABLE_ID,
    `?filterByFormula=${filter}&maxRecords=1`,
  );
  if (data.records.length === 0) throw new Error(`Maker record not found for slug: ${MANUFACTURER_SLUG}`);
  return data.records[0].id;
}

async function createAirtableLureRecord(
  lureName: string, url: string, makerRecordId: string, status: string, note: string,
): Promise<void> {
  await airtableFetch(
    AIRTABLE_LURE_URL_TABLE_ID,
    '',
    {
      method: 'POST',
      body: JSON.stringify({
        records: [{
          fields: {
            'ルアー名': lureName,
            'URL': url,
            'メーカー': [makerRecordId],
            'ステータス': status,
            '備考': note,
          },
        }],
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Scrape Shopify
// ---------------------------------------------------------------------------

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  log('Fetching products from Shopify JSON API...');
  const products: ShopifyProduct[] = [];
  let page = 1;

  while (true) {
    const url = `${SHOP_BASE}/products.json?limit=250&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
    const data = (await res.json()) as { products: ShopifyProduct[] };
    if (data.products.length === 0) break;
    products.push(...data.products);
    log(`  Page ${page}: ${data.products.length} products`);
    if (data.products.length < 250) break;
    page++;
    await sleep(500);
  }

  log(`Total products from store: ${products.length}`);
  return products;
}

function filterBoreasLures(products: ShopifyProduct[]): ShopifyProduct[] {
  return products.filter(p => {
    // Must be BOREAS vendor
    if (p.vendor.toUpperCase() !== 'BOREAS') return false;
    // Exclude known non-lure handles
    if (EXCLUDE_HANDLES.has(p.handle.toLowerCase())) return false;
    // Exclude apparel/accessories by product_type
    const ptLower = p.product_type.toLowerCase();
    if (EXCLUDE_TYPES_LOWER.some(t => ptLower.includes(t))) return false;
    // Exclude by tags
    const tags = p.tags.map(t => t.toLowerCase());
    if (tags.some(t => t.includes('sinker') || t.includes('tube') || t.includes('cap') || t.includes('sticker') || t.includes('wear') || t.includes('shirt'))) return false;
    // Exclude by title keywords
    const titleLower = p.title.toLowerCase();
    if (EXCLUDE_TITLE_LOWER.some(t => titleLower.includes(t))) return false;
    return true;
  });
}

function scrapeProduct(p: ShopifyProduct): ScrapedProduct {
  const title = p.title.replace(/^BOREAS\s*\/\s*/, '').trim();
  const slug = p.handle;
  const type = detectLureType(p.product_type, title);
  const length = parseLengthFromTitle(title);
  const weightFromTitle = parseWeightFromText(title);
  const weightFromBody = parseWeightFromText(p.body_html || '');
  const weight = weightFromTitle ?? weightFromBody;

  // Build image map: imageId -> src
  const imageMap = new Map<number, string>();
  for (const img of p.images) {
    imageMap.set(img.id, img.src);
  }

  // Extract colors from variants
  const seenColors = new Set<string>();
  const colors: ScrapedColor[] = [];
  for (const v of p.variants) {
    const rawName = v.option1 || v.title || 'Default';
    if (rawName === 'Default Title') continue;
    const colorName = cleanColorName(rawName);
    if (seenColors.has(colorName)) continue;
    seenColors.add(colorName);

    // Find image for this variant
    let imageUrl: string | null = null;
    if (v.image_id && imageMap.has(v.image_id)) {
      imageUrl = imageMap.get(v.image_id)!;
    }
    colors.push({ name: colorName, imageUrl });
  }

  // If no variant→image mapping, try to assign images sequentially
  // (skip first image as it's usually a product shot, not a color)
  if (colors.length > 0 && colors.every(c => !c.imageUrl) && p.images.length > 1) {
    const colorImages = p.images.slice(1); // skip hero
    for (let i = 0; i < Math.min(colors.length, colorImages.length); i++) {
      colors[i].imageUrl = colorImages[i].src;
    }
  }

  // Price: use the first variant's price
  const price = p.variants.length > 0 ? Math.round(parseFloat(p.variants[0].price)) : 0;

  // Main image
  const mainImage = p.images.length > 0 ? p.images[0].src : null;

  // Description: strip HTML tags
  const description = (p.body_html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1000);

  // Weights: for jigs with multiple weight variants
  const weights: number[] = [];
  if (type === 'ラバージグ' || type === 'チャターベイト' || type === 'ブレードベイト') {
    if (weight) weights.push(weight);
  }

  return {
    name: title,
    slug,
    type,
    price,
    description,
    length,
    weight,
    weights,
    colors,
    mainImage,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log(`BOREAS Scraper Pipeline - Starting`);
  log('========================================');

  const startTime = Date.now();
  let totalProducts = 0;
  let totalRows = 0;
  let totalColors = 0;
  let totalImages = 0;
  let errorCount = 0;

  try {
    // 1. Get maker record ID from Airtable
    const makerRecordId = await findMakerRecordId();
    log(`Maker record ID: ${makerRecordId}`);

    // 2. Fetch and filter products
    const allProducts = await fetchAllProducts();
    const lureProducts = filterBoreasLures(allProducts);
    log(`Filtered to ${lureProducts.length} BOREAS lure products`);

    totalProducts = lureProducts.length;

    // 3. Process each product
    for (let i = 0; i < lureProducts.length; i++) {
      const p = lureProducts[i];
      const scraped = scrapeProduct(p);
      log(`\n--- [${i + 1}/${lureProducts.length}] ${scraped.name} ---`);
      log(`  Type: ${scraped.type}, Colors: ${scraped.colors.length}, Price: ¥${scraped.price}, Length: ${scraped.length ?? 'N/A'}mm, Weight: ${scraped.weight ?? 'N/A'}g`);

      const productUrl = `${SHOP_BASE}/products/${scraped.slug}`;

      // 3a. Upload color images to R2
      const colorImageMap = new Map<string, string>();
      for (let ci = 0; ci < scraped.colors.length; ci++) {
        const color = scraped.colors[ci];
        if (!color.imageUrl) continue;
        try {
          const padded = String(ci + 1).padStart(2, '0');
          const r2Key = `${MANUFACTURER_SLUG}/${scraped.slug}/${padded}.webp`;
          const pubUrl = await processAndUploadImage(color.imageUrl, r2Key);
          colorImageMap.set(color.name, pubUrl);
          totalImages++;
        } catch (err) {
          logError(`  Image failed for ${color.name}: ${err instanceof Error ? err.message : err}`);
        }
      }

      // 3b. Insert into Supabase
      const weights: (number | null)[] = scraped.weights.length > 0 ? scraped.weights : [scraped.weight];
      let rowsForProduct = 0;

      for (const color of scraped.colors) {
        for (const w of weights) {
          try {
            const exists = await lureExists(scraped.slug, color.name, w);
            if (exists) {
              log(`  Skip existing: ${color.name} / ${w ?? 'N/A'}g`);
              continue;
            }

            const imgUrl = colorImageMap.get(color.name) || null;
            await insertLure({
              name: scraped.name,
              slug: scraped.slug,
              manufacturer: MANUFACTURER,
              manufacturer_slug: MANUFACTURER_SLUG,
              type: scraped.type,
              price: scraped.price,
              description: scraped.description || null,
              images: imgUrl ? [imgUrl] : null,
              color_name: color.name,
              weight: w,
              length: scraped.length,
              is_limited: false,
              is_discontinued: false,
              target_fish: ['ブラックバス'],
            });
            rowsForProduct++;
          } catch (err) {
            logError(`  Insert failed: ${color.name}: ${err instanceof Error ? err.message : err}`);
            errorCount++;
          }
        }
      }

      totalRows += rowsForProduct;
      totalColors += scraped.colors.length;
      log(`  Inserted ${rowsForProduct} rows, ${colorImageMap.size}/${scraped.colors.length} images`);

      // 3c. Create Airtable lure URL record
      try {
        await createAirtableLureRecord(
          scraped.name,
          productUrl,
          makerRecordId,
          '登録完了',
          `${scraped.colors.length}色 x ${weights.length}ウェイト = ${rowsForProduct}行挿入`,
        );
      } catch (err) {
        logError(`  Airtable record failed: ${err instanceof Error ? err.message : err}`);
      }

      // Rate limit
      await sleep(500);
    }

    // 4. Update maker status
    log('\nUpdating maker status to 登録済み...');
    await airtableFetch(
      AIRTABLE_MAKER_TABLE_ID,
      `/${makerRecordId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fields: { 'ステータス': '登録済み' } }),
      },
    );

  } catch (err) {
    logError(`Pipeline failed: ${err instanceof Error ? err.message : err}`);
    errorCount++;
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('\n========================================');
  log('BOREAS Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}`);
  log(`Images uploaded: ${totalImages} (${totalColors > 0 ? Math.round(totalImages / totalColors * 100) : 0}%)`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

main().catch(err => {
  logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
