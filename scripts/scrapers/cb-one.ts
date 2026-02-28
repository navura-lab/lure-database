// scripts/scrapers/cb-one.ts
// CB ONE scraper — WordPress site (Snow Monkey theme), UTF-8, fetch-only
// Products at /products/, individual pages at /products/{slug}/
// Two spec table formats: casting plugs (6-col) and metal jigs (3-col)
// Color images in spider sliders: named (BAZOO_maiwashi.png) or numbered (MB1-1.png)

import type { ScraperFunction, ScrapedLure } from './types.js';
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

const MANUFACTURER = 'CB ONE';
const MANUFACTURER_SLUG = 'cb-one';
const SITE_BASE = 'https://cb-one.co.jp';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Product slugs that are NOT lures (rods + goods) — skip
const SKIP_SLUGS = new Set([
  'standuptuna', 'progress', 'enfinity',  // rods
  'ssr', 'diverdown', 'braver', 'hrm',     // rods
  'hook', 'metal-parts', 'gear',            // goods
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  slug: string;
  url: string;
  category: 'casting-plug' | 'metal-jig';
}

interface SpecVariant {
  model: string | null;  // null for jigs (weight IS the model)
  weight: number | null;
  length: number | null;
  price: number;
}

interface ColorVariant {
  name: string;
  imageUrl: string;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  lureType: string;
  description: string;
  specs: SpecVariant[];
  colors: ColorVariant[];
  mainImageUrl: string | null;
  targetFish: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [cb-one] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [cb-one] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.text();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// R2 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Image download failed: ${res.status} ${imageUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const webp = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: r2Key, Body: webp, ContentType: 'image/webp',
  }));
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function lureExists(slug: string, colorName: string, weight: number | null): Promise<boolean> {
  let q = `manufacturer_slug=eq.${encodeURIComponent(MANUFACTURER_SLUG)}&slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
  q += weight !== null ? `&weight=eq.${weight}` : '&weight=is.null';
  q += '&select=id&limit=1';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures?${q}`, {
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase query error: ${res.status}`);
  return ((await res.json()) as unknown[]).length > 0;
}

async function insertLure(row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert error ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

const AIRTABLE_MAKER_RECORD_ID = ''; // Will be set after registration

async function airtableCreateRecord(tableId: string, fields: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

async function airtableUpdateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) logError(`Airtable record failed: ${await res.text().catch(() => res.statusText)}`);
}

// ---------------------------------------------------------------------------
// Product discovery
// ---------------------------------------------------------------------------

const CASTING_PLUG_CAT_ID = 23;
const METAL_JIG_CAT_ID = 24;

async function discoverProducts(): Promise<ProductLink[]> {
  // Use WordPress REST API to get products with their categories
  const apiUrl = `${SITE_BASE}/wp-json/wp/v2/products?per_page=100`;
  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`REST API failed: ${res.status}`);
  const data = await res.json() as { slug: string; link: string; 'products-category': number[] }[];

  const products: ProductLink[] = [];
  for (const p of data) {
    if (SKIP_SLUGS.has(p.slug)) continue;
    const cats = p['products-category'] || [];
    // Only include lures: casting plugs or metal jigs
    const isCastingPlug = cats.includes(CASTING_PLUG_CAT_ID);
    const isMetalJig = cats.includes(METAL_JIG_CAT_ID);
    if (!isCastingPlug && !isMetalJig) continue;
    products.push({
      slug: p.slug,
      url: p.link || `${SITE_BASE}/products/${p.slug}/`,
      category: isMetalJig ? 'metal-jig' : 'casting-plug',
    });
  }
  return products;
}

// ---------------------------------------------------------------------------
// Spec table parsing
// ---------------------------------------------------------------------------

function parseSpecTable(html: string): SpecVariant[] {
  const variants: SpecVariant[] = [];
  // Find spec table — must contain 重量 or 全長
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  let specHtml: string | null = null;
  for (const t of tables) {
    if (/重量/.test(t[1]) || /全長/.test(t[1])) { specHtml = t[1]; break; }
  }
  if (!specHtml) return variants;

  const rows = [...specHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  if (rows.length < 2) return variants;

  // Parse header
  const headerCells = [...rows[0][1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(c => stripTags(c[1]));

  const weightIdx = headerCells.findIndex(h => /重量/.test(h));
  const lengthIdx = headerCells.findIndex(h => /全長/.test(h));
  const priceIdx = headerCells.findIndex(h => /価格/.test(h));
  const modelIdx = headerCells.findIndex(h => /モデル/.test(h));

  // Parse data rows
  for (let i = 1; i < rows.length; i++) {
    const cells = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => stripTags(c[1]));
    if (cells.length < 2) continue;

    const weight = weightIdx >= 0 ? parseFloat(cells[weightIdx]?.replace(/[^\d.]/g, '') || '') || null : null;
    const length = lengthIdx >= 0 ? parseFloat(cells[lengthIdx]?.replace(/[^\d.]/g, '') || '') || null : null;
    const priceStr = priceIdx >= 0 ? cells[priceIdx] || '' : '';
    const price = parseInt(priceStr.replace(/[^\d]/g, '') || '0', 10);
    const model = modelIdx >= 0 ? cells[modelIdx] || null : null;

    variants.push({ model, weight, length, price });
  }
  return variants;
}

// ---------------------------------------------------------------------------
// Color image extraction
// ---------------------------------------------------------------------------

function parseColors(html: string, productSlug: string): ColorVariant[] {
  const colors: ColorVariant[] = [];
  const productUpper = productSlug.toUpperCase().replace(/-/g, '');
  const productVariants = [
    productSlug.toUpperCase().replace(/-/g, ''),
    productSlug.toUpperCase().replace(/-/g, ' '),
    productSlug.toUpperCase(),
  ];

  // Extract all images from the page
  const allImgs = [...html.matchAll(/src="(https:\/\/cb-one\.co\.jp\/wp-content\/uploads\/[^"]+\.(png|jpg|webp))"/gi)];

  // Classify images
  const colorImages: { url: string; name: string }[] = [];
  const mainImages: string[] = [];

  for (const [, url] of allImgs) {
    const fname = url.split('/').pop() || '';
    const fnameNoExt = fname.replace(/\.(png|jpg|webp)$/i, '');
    const fnameLower = fname.toLowerCase();

    // Skip known non-color images
    if (/^TOP_/i.test(fname)) continue;
    if (/_main/i.test(fname)) { mainImages.push(url); continue; }
    if (/_top\./i.test(fname) || /_bottom\./i.test(fname) || /_side\./i.test(fname)) continue;
    if (/_action/i.test(fname) || /action-/i.test(fname)) continue;
    if (/1920x640/i.test(fname)) continue;
    if (/spec/i.test(fname) || /flair/i.test(fname)) continue;
    if (/-scaled\./i.test(fname)) continue;

    // Check if this is a color image for the current product
    // Pattern 1: PRODUCT_colorname.ext (e.g., BAZOO_maiwashi.png)
    const namedMatch = fnameNoExt.match(new RegExp(`^${escapeRegex(productUpper)}_([a-zA-Z]+)$`, 'i'));
    if (namedMatch) {
      const colorName = namedMatch[1].toLowerCase();
      // Skip non-color parts (top, bottom, side, action, main)
      if (['top', 'bottom', 'side', 'action', 'main'].includes(colorName)) continue;
      colorImages.push({ url, name: colorName });
      continue;
    }

    // Pattern 2: PRODUCT-N.ext (e.g., MB1-1.png, ZERO1-1.png)
    // Build a regex for the product name variants
    const slugParts = productSlug.toUpperCase().replace(/-/g, '[- ]?');
    const numberedMatch = fnameNoExt.match(new RegExp(`^${slugParts}-?(\\d+)$`, 'i'))
      || fnameNoExt.match(new RegExp(`^${slugParts}-(\\d+)$`, 'i'));
    if (numberedMatch) {
      colorImages.push({ url, name: `カラー${numberedMatch[1]}` });
      continue;
    }

    // Pattern 3: PRODUCT-N-N.ext (e.g., ZERO1-1-1.png, C1-1-1.png)
    const dualNumberedMatch = fnameNoExt.match(new RegExp(`^${slugParts}-?\\d+-?(\\d+)$`, 'i'));
    if (dualNumberedMatch) {
      colorImages.push({ url, name: `カラー${dualNumberedMatch[1]}` });
      continue;
    }

    // Pattern 4: Frame-N.png (DIXON specific)
    if (/^Frame-?\d+\.png$/i.test(fname)) {
      const frameNum = fname.match(/(\d+)/)?.[1] || '0';
      colorImages.push({ url, name: `カラー${colorImages.length + 1}` });
      continue;
    }
  }

  // Deduplicate by name
  const seen = new Set<string>();
  for (const ci of colorImages) {
    if (seen.has(ci.name)) continue;
    seen.add(ci.name);
    colors.push({ name: ci.name, imageUrl: ci.url });
  }

  return colors;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Product type detection
// ---------------------------------------------------------------------------

function categoryToLureType(category: 'casting-plug' | 'metal-jig'): string {
  return category === 'metal-jig' ? 'メタルジグ' : 'キャスティングプラグ';
}

// ---------------------------------------------------------------------------
// Extract product title from <h1>
// ---------------------------------------------------------------------------

function parseProductName(html: string): string {
  // Prefer og:title (clean product name)
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i);
  if (ogTitle) return ogTitle[1].trim();
  // Fallback: <title> (format: "PRODUCT – CB ONE")
  const title = html.match(/<title>(.*?)<\/title>/i);
  if (title) {
    const name = title[1].replace(/\s*[–—-]\s*CB ONE$/i, '').replace(/&#\d+;/g, '').trim();
    if (name) return name;
  }
  // Last resort: first <h1>
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  return '';
}

// ---------------------------------------------------------------------------
// Extract main product image
// ---------------------------------------------------------------------------

function findMainImage(html: string, productSlug: string): string | null {
  // Prefer _main images
  const mainMatch = html.match(/src="(https:\/\/cb-one\.co\.jp\/wp-content\/uploads\/[^"]*_main[^"]*\.(jpg|png|webp))"/i);
  if (mainMatch) return mainMatch[1];
  // Fallback: hero banner
  const heroMatch = html.match(/src="(https:\/\/cb-one\.co\.jp\/wp-content\/uploads\/[^"]*TOP_[^"]*\.(jpg|png|webp))"/i);
  if (heroMatch) return heroMatch[1];
  return null;
}

// ---------------------------------------------------------------------------
// Product page scraping
// ---------------------------------------------------------------------------

async function scrapeProduct(link: ProductLink): Promise<ScrapedProduct | null> {
  const html = await fetchPage(link.url);
  const name = parseProductName(html);
  if (!name) {
    log(`  Could not extract product name from ${link.url}`);
    return null;
  }

  const lureType = categoryToLureType(link.category);
  const specs = parseSpecTable(html);
  const colors = parseColors(html, link.slug);
  const mainImageUrl = findMainImage(html, link.slug);

  // Extract description from first <p> in article
  const descMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  let description = '';
  if (descMatch) {
    const pMatch = descMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (pMatch) description = stripTags(pMatch[1]).substring(0, 200);
  }

  log(`  Name: ${name}`);
  log(`  Type: ${lureType}`);
  log(`  Specs: ${specs.length} variants`);
  if (specs.length > 0) {
    const s = specs[0];
    log(`    First: ${s.model ? `Model ${s.model}, ` : ''}${s.weight}g, ${s.length}mm, ¥${s.price}`);
  }
  log(`  Colors: ${colors.length}`);
  log(`  Main image: ${mainImageUrl ? 'yes' : 'no'}`);

  return {
    name,
    slug: link.slug,
    url: link.url,
    lureType,
    description,
    specs,
    colors,
    mainImageUrl,
    targetFish: ['オフショア'],
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction for pipeline integration
// ---------------------------------------------------------------------------

export const scrapeCbOnePage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Derive slug from URL: https://cb-one.co.jp/products/{slug}/
  const slugMatch = url.match(/\/products\/([^/]+)\/?$/);
  const slug = slugMatch ? slugMatch[1] : 'unknown';

  // Default to casting-plug; pipeline only sends lure URLs
  const link: ProductLink = {
    slug,
    url,
    category: 'casting-plug',
  };

  const product = await scrapeProduct(link);
  if (!product) {
    throw new Error(`Failed to scrape product at ${url}`);
  }

  // Collect unique weights from specs
  const weights = product.specs
    .map(s => s.weight)
    .filter((w): w is number => w !== null);

  // Use first spec's length, or null
  const length = product.specs.length > 0 ? product.specs[0].length : null;

  // Use max price from specs
  const price = product.specs.length > 0
    ? Math.max(...product.specs.map(s => s.price).filter(p => p > 0), 0)
    : 0;

  // Convert colors
  const colors = product.colors.map(c => ({
    name: c.name,
    imageUrl: c.imageUrl,
  }));

  // Main image
  const mainImage = product.mainImageUrl || (colors.length > 0 ? colors[0].imageUrl : '');

  return {
    name: product.name,
    name_kana: '',
    slug: product.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: product.lureType,
    target_fish: product.targetFish,
    description: product.description,
    price,
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  let totalProducts = 0;
  let totalScraped = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  let totalColors = 0;
  let totalImages = 0;
  let totalErrors = 0;

  // 1) Discover products
  log('Discovering products...');
  const products = await discoverProducts();
  totalProducts = products.length;
  log(`Found ${totalProducts} lure products`);
  for (const p of products) log(`  ${p.slug}`);

  // 2) Register maker in Airtable (find existing or create)
  let makerRecordId = '';
  try {
    // Search for existing maker record
    const searchUrl = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_MAKER_TABLE_ID}?filterByFormula={Slug}="${MANUFACTURER_SLUG}"&maxRecords=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` },
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { records: { id: string }[] };
      if (searchData.records.length > 0) {
        makerRecordId = searchData.records[0].id;
        log(`Found existing Airtable maker record: ${makerRecordId}`);
      }
    }
    if (!makerRecordId) {
      makerRecordId = await airtableCreateRecord(AIRTABLE_MAKER_TABLE_ID, {
        'メーカー名': MANUFACTURER,
        'Slug': MANUFACTURER_SLUG,
        'URL': SITE_BASE,
        'ステータス': 'スクレイピング中',
      });
      log(`Created Airtable maker record: ${makerRecordId}`);
    }
  } catch (e) {
    logError(`Airtable maker registration: ${e}`);
  }

  // 3) Scrape each product
  for (let i = 0; i < products.length; i++) {
    const link = products[i];
    log(`\nFetching product page: ${link.url}`);

    let product: ScrapedProduct | null = null;
    try {
      product = await scrapeProduct(link);
    } catch (e) {
      logError(`Product fetch failed: ${e}`);
      totalErrors++;
      await sleep(1000);
      continue;
    }

    if (!product || (product.specs.length === 0 && product.colors.length === 0)) {
      log(`  No specs or colors found -- skipping product`);
      totalSkipped++;
      await sleep(500);
      continue;
    }

    // If no colors found, use main image as a single "default" color
    const effectiveColors: ColorVariant[] = product.colors.length > 0
      ? product.colors
      : product.mainImageUrl
        ? [{ name: 'スタンダード', imageUrl: product.mainImageUrl }]
        : [];

    if (effectiveColors.length === 0) {
      log(`  No colors and no main image -- skipping product`);
      totalSkipped++;
      await sleep(500);
      continue;
    }

    // If no specs found, create a single entry with null weight/length
    const effectiveSpecs: SpecVariant[] = product.specs.length > 0
      ? product.specs
      : [{ model: null, weight: null, length: null, price: 0 }];

    const totalCombinations = effectiveColors.length * effectiveSpecs.length;
    log(`\n--- [${i + 1}/${products.length}] ${product.name} ---`);

    // Upload color images
    const imageUrls: string[] = [];
    for (let c = 0; c < effectiveColors.length; c++) {
      const color = effectiveColors[c];
      try {
        const r2Key = `${MANUFACTURER_SLUG}/${product.slug}/${c}.webp`;
        const publicUrl = await processAndUploadImage(color.imageUrl, r2Key);
        imageUrls.push(publicUrl);
        log(`  Image uploaded: ${r2Key}`);
        totalImages++;
      } catch (e) {
        logError(`  Image failed: ${e}`);
        imageUrls.push('');
        totalErrors++;
      }
    }

    // Insert rows: color × spec
    let insertedForProduct = 0;
    for (let c = 0; c < effectiveColors.length; c++) {
      const color = effectiveColors[c];
      totalColors++;
      for (const spec of effectiveSpecs) {
        try {
          const exists = await lureExists(product.slug, color.name, spec.weight);
          if (exists) {
            log(`  Skip existing: ${color.name} / ${spec.weight}g`);
            continue;
          }

          await insertLure({
            manufacturer: MANUFACTURER,
            manufacturer_slug: MANUFACTURER_SLUG,
            name: spec.model
              ? `${product.name} ${spec.model}`
              : product.name,
            slug: product.slug,
            type: product.lureType,
            color_name: color.name,
            weight: spec.weight,
            length: spec.length,
            price: spec.price || null,
            images: imageUrls[c] ? [imageUrls[c]] : null,
            description: product.description || null,
            target_fish: product.targetFish,
            is_limited: false,
            is_discontinued: false,
          });
          insertedForProduct++;
        } catch (e) {
          logError(`  Insert failed: ${e}`);
          totalErrors++;
        }
      }
    }

    totalInserted += insertedForProduct;
    totalScraped++;
    log(`  Inserted ${insertedForProduct} rows (${effectiveColors.length} colors x ${effectiveSpecs.length} specs)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.url,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `${effectiveColors.length}色 x ${effectiveSpecs.length}ウェイト = ${insertedForProduct}行`,
        });
      } catch (e) {
        logError(`  Airtable record failed: ${(e as Error).message}`);
      }
    }

    await sleep(1000);
  }

  // 4) Update maker status
  log('\nUpdating maker status...');
  if (makerRecordId) {
    try {
      await airtableUpdateRecord(AIRTABLE_MAKER_TABLE_ID, makerRecordId, {
        'ステータス': '登録済み',
      });
    } catch (e) {
      logError(`Airtable maker update: ${e}`);
    }
  }

  // 5) Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`
========================================`);
  log(`${MANUFACTURER} Pipeline Summary`);
  log(`========================================`);
  log(`Products discovered: ${totalProducts}`);
  log(`Products scraped: ${totalScraped}`);
  log(`Products skipped (no data): ${totalSkipped}`);
  log(`Rows inserted: ${totalInserted}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${totalErrors}`);
  log(`Elapsed: ${elapsed}s`);
  log(`========================================`);
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/cb-one');
if (isDirectRun) {
  main().catch(e => {
    logError(`Fatal: ${e}`);
    process.exit(1);
  });
}
