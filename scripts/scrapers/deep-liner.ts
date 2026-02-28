// scripts/scrapers/deep-liner.ts
// Deep Liner scraper — static HTML site (Kaeru CMS), UTF-8, fetch-only
// Products listed at /item.html, detail pages at /jig/{slug}.html
// All products are metal jigs (slow-pitch jigging specialist)
// No color data in HTML (only in non-parseable PDF) → main image as "スタンダード"
// No prices, no length data on the site

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
import type { ScraperFunction, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'Deep Liner';
const MANUFACTURER_SLUG = 'deepliner';
const SITE_BASE = 'https://www.deepliner.com';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Slugs that are known broken (redirect to homepage)
const BROKEN_SLUGS = new Set([
  'mega_spindle',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  slug: string;
  url: string;
  thumbDesc: string;  // description from listing page
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  description: string;
  weights: number[];
  mainImageUrl: string | null;
  diagramImageUrl: string | null;
  actionTypes: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [deep-liner] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [deep-liner] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.text();
}

// Common HTML named entities → characters
const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>',
  beta: 'β', alpha: 'α', gamma: 'γ', delta: 'δ',
  ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  yen: '¥', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
  times: '\u00D7', divide: '\u00F7',
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (_m, name) => HTML_ENTITIES[name.toLowerCase()] ?? _m);
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
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
// Product discovery from item.html
// ---------------------------------------------------------------------------

async function discoverProducts(): Promise<ProductLink[]> {
  const html = await fetchPage(`${SITE_BASE}/item.html`);
  const products: ProductLink[] = [];

  // Find all jigbox entries: <div class="jigbox ..."> ... <a href="jig/{slug}.html"> ...
  const jigBoxes = [...html.matchAll(/<div\s+class="jigbox[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)];

  // Alternative: find all links in jig/ pattern
  const jigLinks = [...html.matchAll(/<a\s+href="(jig\/([^"]+)\.html)"[^>]*>/gi)];

  for (const m of jigLinks) {
    const relPath = m[1];           // e.g. "jig/slowskip_vb.html"
    const slug = m[2];              // e.g. "slowskip_vb"

    if (BROKEN_SLUGS.has(slug)) {
      log(`  Skipping broken page: ${slug}`);
      continue;
    }

    // Avoid duplicates
    if (products.some(p => p.slug === slug)) continue;

    products.push({
      slug,
      url: `${SITE_BASE}/${relPath}`,
      thumbDesc: '',
    });
  }

  return products;
}

// ---------------------------------------------------------------------------
// Parse product name from <h3>
// ---------------------------------------------------------------------------

function parseProductName(html: string): string {
  // Look for <h3> inside #subpage or body
  const h3 = html.match(/<h3>([\s\S]*?)<\/h3>/i);
  if (h3) {
    const name = stripTags(h3[1]).trim();
    if (name) return name;
  }
  // Fallback: <title>
  const title = html.match(/<title>(.*?)<\/title>/i);
  if (title) return stripTags(title[1]).trim();
  return '';
}

// ---------------------------------------------------------------------------
// Parse description (catchphrase)
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Pattern 1: <h4 class="mid">...</h4>
  const h4Mid = html.match(/<h4\s+class="mid">([\s\S]*?)<\/h4>/i);
  if (h4Mid) return stripTags(h4Mid[1]).trim();

  // Pattern 2: <div class="catch"><div>...</div></div>
  const catchDiv = html.match(/<div\s+class="catch">\s*<div>([\s\S]*?)<\/div>/i);
  if (catchDiv) return stripTags(catchDiv[1]).trim();

  return '';
}

// ---------------------------------------------------------------------------
// Parse 特性 (characteristics) for longer description
// ---------------------------------------------------------------------------

function parseCharacteristics(html: string): string {
  const tokuseiMatch = html.match(/<h4>特性<\/h4>\s*<div>\s*<div>([\s\S]*?)<\/div>/i);
  if (tokuseiMatch) {
    return stripTags(tokuseiMatch[1]).substring(0, 300).trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// Parse action types
// ---------------------------------------------------------------------------

function parseActionTypes(html: string): string {
  const actionMatch = html.match(/<h4>アクション<\/h4>\s*<div>\s*<div>([\s\S]*?)<\/div>/i);
  if (actionMatch) return stripTags(actionMatch[1]).trim();
  return '';
}

// ---------------------------------------------------------------------------
// Parse weight variants from バリエーション section
// ---------------------------------------------------------------------------

function parseWeights(html: string): number[] {
  // Find the バリエーション section content
  const varMatch = html.match(/<h4>バリエーション<\/h4>\s*<div>\s*<div>([\s\S]*?)<\/div>/i);
  if (!varMatch) return [];

  const text = varMatch[1];
  // Extract all weights: ● 30g, ●1000g, ● 1500g etc.
  const weights: number[] = [];
  const weightMatches = [...text.matchAll(/●\s*(\d+)\s*g/g)];
  for (const m of weightMatches) {
    const w = parseInt(m[1], 10);
    if (w > 0 && !weights.includes(w)) weights.push(w);
  }
  return weights.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Extract main product image
// ---------------------------------------------------------------------------

function parseMainImage(html: string): string | null {
  // <div class="photo_jig"><img src="./file/{id}/{filename}_l.jpg" ...>
  const match = html.match(/<div\s+class="photo_jig">\s*<img\s+src="([^"]+)"/i);
  if (match) {
    const src = match[1];
    // Convert relative path to absolute
    if (src.startsWith('./')) return `${SITE_BASE}/jig/${src.substring(2)}`;
    if (src.startsWith('/')) return `${SITE_BASE}${src}`;
    if (src.startsWith('http')) return src;
    return `${SITE_BASE}/jig/${src}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scrape a single product page
// ---------------------------------------------------------------------------

async function scrapeProduct(link: ProductLink): Promise<ScrapedProduct | null> {
  const html = await fetchPage(link.url);
  const name = parseProductName(html);
  if (!name) {
    log(`  Could not extract product name from ${link.url}`);
    return null;
  }

  const description = parseDescription(html) || parseCharacteristics(html);
  const actionTypes = parseActionTypes(html);
  const weights = parseWeights(html);
  const mainImageUrl = parseMainImage(html);

  // Diagram image (for reference, not used in DB)
  const diagramMatch = html.match(/<div[^>]*style="text-align:center"[^>]*>\s*<img\s+src="([^"]+)"/i);
  const diagramImageUrl = diagramMatch
    ? (diagramMatch[1].startsWith('./') ? `${SITE_BASE}/jig/${diagramMatch[1].substring(2)}` : diagramMatch[1])
    : null;

  log(`  Name: ${name}`);
  log(`  Description: ${description.substring(0, 60)}...`);
  log(`  Action: ${actionTypes}`);
  log(`  Weights: ${weights.length} variants (${weights[0]}g - ${weights[weights.length - 1]}g)`);
  log(`  Main image: ${mainImageUrl ? 'yes' : 'no'}`);

  return {
    name,
    slug: link.slug,
    url: link.url,
    description,
    weights,
    mainImageUrl,
    diagramImageUrl,
    actionTypes,
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

  // 1) Discover products
  log('Discovering products from item.html...');
  const products = await discoverProducts();
  totalProducts = products.length;
  log(`Found ${totalProducts} jig products`);
  for (const p of products) log(`  ${p.slug}`);

  // 2) Register maker in Airtable (find existing or create)
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

  // 3) Scrape each product
  for (let i = 0; i < products.length; i++) {
    const link = products[i];
    log(`\n--- [${i + 1}/${products.length}] Fetching: ${link.url} ---`);

    let product: ScrapedProduct | null = null;
    try {
      product = await scrapeProduct(link);
    } catch (e) {
      logError(`Product fetch failed: ${e}`);
      totalErrors++;
      await sleep(1000);
      continue;
    }

    if (!product || product.weights.length === 0) {
      log(`  No weights found -- skipping product`);
      totalSkipped++;
      await sleep(500);
      continue;
    }

    // Upload main product image (1 image per product, used as "スタンダード" color)
    let r2ImageUrl = '';
    if (product.mainImageUrl) {
      try {
        const r2Key = `${MANUFACTURER_SLUG}/${product.slug}/0.webp`;
        r2ImageUrl = await processAndUploadImage(product.mainImageUrl, r2Key);
        log(`  Image uploaded: ${r2Key}`);
        totalImages++;
      } catch (e) {
        logError(`  Image failed: ${e}`);
        totalErrors++;
      }
    }

    // Insert rows: 1 color ("スタンダード") × N weights
    let insertedForProduct = 0;
    const colorName = 'スタンダード';

    for (const weight of product.weights) {
      try {
        const exists = await lureExists(product.slug, colorName, weight);
        if (exists) {
          log(`  Skip existing: ${colorName} / ${weight}g`);
          continue;
        }

        await insertLure({
          manufacturer: MANUFACTURER,
          manufacturer_slug: MANUFACTURER_SLUG,
          name: product.name,
          slug: product.slug,
          type: 'メタルジグ',
          color_name: colorName,
          weight,
          length: null,
          price: null,
          images: r2ImageUrl ? [r2ImageUrl] : null,
          description: product.description || null,
          target_fish: ['オフショア'],
          is_limited: false,
          is_discontinued: false,
        });
        insertedForProduct++;
      } catch (e) {
        logError(`  Insert failed (${weight}g): ${e}`);
        totalErrors++;
      }
    }

    totalInserted += insertedForProduct;
    totalScraped++;
    log(`  Inserted ${insertedForProduct} rows (1色 x ${product.weights.length}ウェイト)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.url,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `1色 x ${product.weights.length}ウェイト = ${insertedForProduct}行`,
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
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${totalErrors}`);
  log(`Elapsed: ${elapsed}s`);
  log(`========================================`);
}

// ---------------------------------------------------------------------------
// Modular ScraperFunction export
// ---------------------------------------------------------------------------

export const scrapeDeepLinerPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const html = await fetchPage(url);

  const name = parseProductName(html);
  if (!name) throw new Error(`[deep-liner] Could not extract product name from ${url}`);

  const description = parseDescription(html) || parseCharacteristics(html);
  const weights = parseWeights(html);
  const mainImageUrl = parseMainImage(html);
  const actionTypes = parseActionTypes(html);

  // Extract slug from URL path: /jig/{slug}.html
  const slugMatch = url.match(/\/jig\/([^/.]+)\.html/);
  const slug = slugMatch ? slugMatch[1] : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return {
    name,
    name_kana: '',
    slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: 'メタルジグ',
    target_fish: ['オフショア'],
    description: actionTypes ? `${description} ${actionTypes}`.trim() : description,
    price: 0,
    colors: [], // Deep Liner has no color data in HTML
    weights,
    length: null,
    mainImage: mainImageUrl || '',
    sourceUrl: url,
  };
};

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/deep-liner');
if (isDirectRun) {
  main().catch(e => {
    logError(`Fatal: ${e}`);
    process.exit(1);
  });
}
