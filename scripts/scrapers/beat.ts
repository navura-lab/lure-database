// scripts/scrapers/beat.ts
// beat (&beat) scraper — WordPress 6.5 (Total theme), UTF-8, fetch-only
// WP REST API: /wp-json/wp/v2/product-item?per_page=100&_embed
// ~25 metal jigs + rods/accessories to skip
// Spec table: サイズ(weight g) | ボディー寸法(mm) | 価格(税別) | 備考
// Color images: single grid image per product in content HTML
// Featured image via _embedded.wp:featuredmedia

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

const MANUFACTURER = 'beat';
const MANUFACTURER_SLUG = 'beat';
const SITE_BASE = 'https://beat-jig.com';
const API_URL = `${SITE_BASE}/wp-json/wp/v2/product-item?per_page=100&_embed`;
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Slugs to skip (rods, accessories, non-lure products)
const SKIP_SLUGS = new Set([
  'propagateblx',
  'propagateblxboth58',
  'propagatetypes',
  'silversword',
  'goose',
]);

// Title keywords that indicate non-lure products
const SKIP_TITLE_KEYWORDS = [
  'プロパゲート',
  'シルバーソード',
  'グース',
  'サテル',
];

// Target fish for jigging lures
const TARGET_FISH = ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WPProduct {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url: string }>;
  };
}

interface SpecRow {
  weight: number;
  length: number | null;
  price: number; // tax-excluded
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  description: string;
  specRows: SpecRow[];
  colorGridImageUrl: string | null;
  featuredImageUrl: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [beat] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [beat] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '–')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/[ \t]+/g, ' ')
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
  if (!res.ok) logError(`Airtable update failed: ${await res.text().catch(() => res.statusText)}`);
}

// ---------------------------------------------------------------------------
// Product discovery via WP REST API
// ---------------------------------------------------------------------------

async function fetchAllProducts(): Promise<WPProduct[]> {
  log(`Fetching products from REST API: ${API_URL}`);
  const res = await fetch(API_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`REST API failed: ${res.status}`);
  return await res.json() as WPProduct[];
}

function isLureProduct(product: WPProduct): boolean {
  const slug = product.slug;
  const title = product.title.rendered;

  // Skip by slug
  if (SKIP_SLUGS.has(slug)) return false;

  // Skip URL-encoded slugs (these are Japanese-named rods and accessories)
  if (slug.startsWith('%') || slug.startsWith('new-')) return false;

  // Skip by title keywords
  for (const keyword of SKIP_TITLE_KEYWORDS) {
    if (title.includes(keyword)) return false;
  }

  // Skip if content mentions ロッド heavily (rod products)
  const content = product.content.rendered;
  const rodMentions = (content.match(/ロッド/g) || []).length;
  if (rodMentions >= 3) return false;

  // Must have a spec table with サイズ (weight) to be a lure
  if (!/<table/.test(content)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// HTML content parsing
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Extract first <p> block after the opening <h2> heading
  const match = html.match(/<h2[^>]*>[\s\S]*?<\/h2>\s*(?:<[^p][^>]*>[\s\S]*?<\/[^p][^>]*>\s*)*<p>([\s\S]*?)<\/p>/i);
  if (match) {
    const text = stripTags(match[1]);
    // Clean up and limit length
    const cleaned = text.replace(/\n+/g, ' ').trim();
    return cleaned.length > 500 ? cleaned.substring(0, 500) : cleaned;
  }
  return '';
}

function parseSpecTable(html: string): SpecRow[] {
  const rows: SpecRow[] = [];

  // Find spec table
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return rows;

  const tableHtml = tableMatch[1];

  // Parse header to find column indices
  const headerMatch = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (!headerMatch) return rows;

  // Some products use a mix of <td> and <th> in the header row (e.g., kai-sl)
  // Extract all cell tags from the header row regardless of type
  const headerCells = [...headerMatch[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map(c => stripTags(c[1]));

  const sizeIdx = headerCells.findIndex(h => /サイズ/.test(h));
  const bodyIdx = headerCells.findIndex(h => /ボディー寸法|寸法/.test(h));
  const priceIdx = headerCells.findIndex(h => /価格/.test(h));

  if (sizeIdx < 0 || priceIdx < 0) return rows;

  // Parse body rows
  const bodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!bodyMatch) return rows;

  const trs = [...bodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];

  for (const tr of trs) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => stripTags(c[1]));

    if (cells.length < 2) continue;

    // Parse weight from サイズ column (e.g., "130g" or "45g")
    const sizeText = cells[sizeIdx] || '';
    const weightMatch = sizeText.match(/([\d.]+)\s*g/i);
    if (!weightMatch) continue;
    const weight = parseFloat(weightMatch[1]);
    if (isNaN(weight) || weight <= 0) continue;

    // Parse body length from ボディー寸法 column (if exists)
    let length: number | null = null;
    if (bodyIdx >= 0 && cells[bodyIdx]) {
      const lengthText = cells[bodyIdx].replace(/–/g, '').trim();
      if (lengthText) {
        const lengthMatch = lengthText.match(/([\d.]+)/);
        if (lengthMatch) {
          length = parseFloat(lengthMatch[1]);
          if (isNaN(length)) length = null;
        }
      }
    }

    // Parse price from 価格 column (e.g., "¥2,000" or "¥1,250")
    const priceText = cells[priceIdx] || '';
    const priceMatch = priceText.replace(/[,，\s]/g, '').match(/(\d+)/);
    const price = priceMatch ? parseInt(priceMatch[1], 10) : 0;

    rows.push({ weight, length, price });
  }

  return rows;
}

function parseColorGridImage(html: string): string | null {
  // Look for color grid image — typically a figure/image before or after "店頭在庫カラー" text
  // Pattern: <figure class="wp-block-image ..."><img ... src="URL" ...></figure>
  // These are grid images showing all colors in one image

  // First try: find image right after "店頭在庫カラー"
  const colorSectionMatch = html.match(/店頭在庫カラー[\s\S]*?<figure[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  if (colorSectionMatch) return colorSectionMatch[1];

  // Second try: find any wp-block-image figure between description and spec table
  // that isn't the featured image
  const betweenMatch = html.match(/<\/p>\s*(?:<p[^>]*>[\s\S]*?<\/p>\s*)*<figure class="wp-block-image[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  if (betweenMatch) return betweenMatch[1];

  return null;
}

function parseFeaturedImage(product: WPProduct): string | null {
  if (product._embedded?.['wp:featuredmedia']?.[0]?.source_url) {
    return product._embedded['wp:featuredmedia'][0].source_url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scrape a single product from WP REST API response
// ---------------------------------------------------------------------------

function scrapeProduct(product: WPProduct): ScrapedProduct {
  const html = product.content.rendered;
  const name = stripTags(product.title.rendered);
  const slug = product.slug;
  const url = product.link;

  const description = parseDescription(html);
  const specRows = parseSpecTable(html);
  const colorGridImageUrl = parseColorGridImage(html);
  const featuredImageUrl = parseFeaturedImage(product);

  return {
    name,
    slug,
    url,
    description,
    specRows,
    colorGridImageUrl,
    featuredImageUrl,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  let totalProducts = 0;
  let totalScraped = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  let totalImages = 0;
  let totalErrors = 0;

  // 1) Fetch all products from REST API
  const allProducts = await fetchAllProducts();
  log(`REST API returned ${allProducts.length} total items`);

  // 2) Filter to lure products only
  const lureProducts = allProducts.filter(isLureProduct);
  totalProducts = lureProducts.length;
  log(`Filtered to ${totalProducts} lure products (skipped ${allProducts.length - totalProducts} non-lure items)`);
  for (const p of lureProducts) {
    log(`  ${p.slug} — ${stripTags(p.title.rendered)}`);
  }

  // 3) Register maker in Airtable
  let makerRecordId = '';
  try {
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

  // 4) Process each lure product
  for (let i = 0; i < lureProducts.length; i++) {
    const wp = lureProducts[i];
    log(`\n--- [${i + 1}/${lureProducts.length}] ${stripTags(wp.title.rendered)} (${wp.slug}) ---`);

    let product: ScrapedProduct;
    try {
      product = scrapeProduct(wp);
    } catch (e) {
      logError(`Product parse failed: ${e}`);
      totalErrors++;
      continue;
    }

    if (product.specRows.length === 0) {
      log(`  No spec rows found — skipping`);
      totalSkipped++;
      continue;
    }

    totalScraped++;

    log(`  Description: ${product.description.substring(0, 80)}...`);
    log(`  Spec rows: ${product.specRows.length} weight variants`);
    log(`  Featured image: ${product.featuredImageUrl ? 'yes' : 'no'}`);
    log(`  Color grid image: ${product.colorGridImageUrl ? 'yes' : 'no'}`);

    // Upload featured image (main product image)
    let mainR2Url: string | null = null;
    const mainImageUrl = product.featuredImageUrl || product.colorGridImageUrl;
    if (mainImageUrl) {
      try {
        const key = `${MANUFACTURER_SLUG}/${product.slug}/main.webp`;
        mainR2Url = await processAndUploadImage(mainImageUrl, key);
        log(`  Main image uploaded: ${key}`);
        totalImages++;
      } catch (e) {
        logError(`  Main image failed: ${e instanceof Error ? e.message : e}`);
        totalErrors++;
      }
    }

    // Upload color grid image (if different from featured image)
    let colorGridR2Url: string | null = null;
    if (product.colorGridImageUrl && product.colorGridImageUrl !== product.featuredImageUrl) {
      try {
        const key = `${MANUFACTURER_SLUG}/${product.slug}/colors.webp`;
        colorGridR2Url = await processAndUploadImage(product.colorGridImageUrl, key);
        log(`  Color grid image uploaded: ${key}`);
        totalImages++;
      } catch (e) {
        logError(`  Color grid image failed: ${e instanceof Error ? e.message : e}`);
        totalErrors++;
      }
    }

    // Insert rows into Supabase — 1 row per weight variant
    // beat products don't have per-color data from API, so we use "スタンダード" as color name
    let insertedForProduct = 0;
    for (const spec of product.specRows) {
      const colorName = 'スタンダード';
      try {
        const exists = await lureExists(product.slug, colorName, spec.weight);
        if (exists) {
          log(`  Skip existing: ${colorName} / ${spec.weight}g`);
          continue;
        }

        // Tax-inclusive price (x1.1, round)
        const taxIncPrice = spec.price > 0 ? Math.round(spec.price * 1.1) : null;

        // Use main image (featured image preferred, then color grid)
        const imageUrl = mainR2Url || colorGridR2Url;

        await insertLure({
          manufacturer: MANUFACTURER,
          manufacturer_slug: MANUFACTURER_SLUG,
          name: product.name,
          slug: product.slug,
          type: 'メタルジグ',
          color_name: colorName,
          weight: spec.weight,
          length: spec.length,
          price: taxIncPrice,
          images: imageUrl ? [imageUrl] : null,
          description: product.description || null,
          target_fish: TARGET_FISH,
          source_url: product.url,
          is_limited: false,
          is_discontinued: false,
        });
        insertedForProduct++;
      } catch (e) {
        logError(`  Insert failed (${spec.weight}g): ${e instanceof Error ? e.message : e}`);
        totalErrors++;
      }
    }

    totalInserted += insertedForProduct;
    log(`  Inserted ${insertedForProduct} rows (${product.specRows.length} weight variants)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.url,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `${product.specRows.length}ウェイト = ${insertedForProduct}行`,
        });
      } catch (e) {
        logError(`  Airtable record failed: ${(e as Error).message}`);
      }
    }

    await sleep(300); // Polite delay (we already have all data from API, just uploading images)
  }

  // 5) Update maker status
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

  // 6) Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`
========================================`);
  log(`${MANUFACTURER} Pipeline Summary`);
  log(`========================================`);
  log(`Products discovered: ${totalProducts}`);
  log(`Products scraped: ${totalScraped}`);
  log(`Products skipped (no data): ${totalSkipped}`);
  log(`Rows inserted: ${totalInserted}`);
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${totalErrors}`);
  log(`Elapsed: ${elapsed}s`);
  log(`========================================`);
}

main().catch(e => {
  logError(`Fatal: ${e}`);
  process.exit(1);
});
