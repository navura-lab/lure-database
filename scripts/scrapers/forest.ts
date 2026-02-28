// scripts/scrapers/forest.ts
// Forest scraper — WordPress (MH Magazine theme), fetch-only
// Category pages at /products/area-lure/ and /products/native-lure/
// Product pages use plain text for colors/specs (no structured data)
// Colors: "カラー　全N色：1.色名、2.色名..." (numbered text list)
// Weights: "ウエイト：1.4g" or "ウエイト：1.6g・2.5ｇ・3.8g"
// Single product image per page (no per-color images)

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

const MANUFACTURER = 'Forest';
const MANUFACTURER_SLUG = 'forest';
const SITE_BASE = 'https://forestjp.com';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Category listing pages to scrape
const CATEGORY_PAGES: { path: string; defaultType: string; category: string }[] = [
  { path: '/products/area-lure/', defaultType: 'スプーン', category: 'area-lure' },
  { path: '/products/native-lure/', defaultType: 'スプーン', category: 'native-lure' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  name: string;
  url: string;
  slug: string;
  defaultType: string;
  category: string;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  lureType: string;
  description: string;
  weights: number[];
  colors: string[];
  imageUrl: string | null;
  price: number;
  length: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [forest] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [forest] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractAll(html: string, regex: RegExp): RegExpMatchArray[] {
  const results: RegExpMatchArray[] = [];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m: RegExpMatchArray | null;
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8220;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decode URL-encoded path to readable slug */
function decodeSlug(urlPath: string): string {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return urlPath;
  }
}

/** Normalize full-width numbers/letters to half-width */
function normalizeFullWidth(s: string): string {
  return s.replace(/[\uff10-\uff19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\uff21-\uff3a]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\uff41-\uff5a]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\uff47/g, 'g')  // fullwidth 'g'
    .replace(/・/g, '・');
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

async function airtableFetch<T>(tableId: string, path: string = '', options: RequestInit = {}): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function findMakerRecordId(): Promise<string> {
  const filter = encodeURIComponent(`{Slug}='${MANUFACTURER_SLUG}'`);
  const data = await airtableFetch<{ records: { id: string }[] }>(
    AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&maxRecords=1`,
  );
  if (data.records.length === 0) throw new Error(`Maker not found: ${MANUFACTURER_SLUG}`);
  return data.records[0].id;
}

async function airtableLureExists(url: string): Promise<boolean> {
  const filter = encodeURIComponent(`{URL}='${url}'`);
  const data = await airtableFetch<{ records: unknown[] }>(
    AIRTABLE_LURE_URL_TABLE_ID, `?filterByFormula=${filter}&maxRecords=1`,
  );
  return data.records.length > 0;
}

async function createAirtableLureRecord(
  lureName: string, url: string, makerRecordId: string, status: string, note: string,
): Promise<void> {
  await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: {
      'ルアー名': lureName, 'URL': url, 'メーカー': [makerRecordId], 'ステータス': status, '備考': note,
    }}] }),
  });
}

// ---------------------------------------------------------------------------
// Step 1: Discover product links from category listing pages
// ---------------------------------------------------------------------------

async function discoverProducts(): Promise<ProductLink[]> {
  const allProducts: ProductLink[] = [];
  const seen = new Set<string>();

  for (const cat of CATEGORY_PAGES) {
    const url = `${SITE_BASE}${cat.path}`;
    log(`Fetching category page: ${url}`);
    const html = await fetchPage(url);

    // Product links are inside <li class="mh-custom-posts-item ...">
    //   <a href="URL" title="PRODUCT_NAME">
    // Extract all <a> tags with href containing the category path and a title attribute
    const linkPattern = /<a\s+href="(https?:\/\/forestjp\.com\/products\/(?:area-lure|native-lure)\/[^"]+)"\s+title="([^"]+)"/gi;
    const matches = extractAll(html, linkPattern);

    for (const m of matches) {
      let href = m[1];
      const rawTitle = stripTags(m[2]);

      // Ensure trailing slash
      if (!href.endsWith('/')) href += '/';

      // Extract slug from URL: /products/area-lure/miu-1-4g/ → miu-1-4g
      const slugMatch = href.match(/\/products\/(?:area-lure|native-lure)\/([^/]+)\/?$/);
      if (!slugMatch) continue;
      const rawSlug = slugMatch[1];
      const slug = decodeSlug(rawSlug);

      // Deduplicate by URL
      if (seen.has(href)) continue;
      seen.add(href);

      allProducts.push({
        name: rawTitle,
        url: href,
        slug,
        defaultType: cat.defaultType,
        category: cat.category,
      });
    }

    log(`  Found ${matches.length} link(s), ${allProducts.length} unique product(s) so far`);
    await sleep(500);
  }

  log(`\nTotal discovered: ${allProducts.length} product(s):`);
  for (const p of allProducts) {
    log(`  [${p.category}] ${p.slug} → ${p.name}`);
  }
  return allProducts;
}

// ---------------------------------------------------------------------------
// Step 2: Parse product page
// ---------------------------------------------------------------------------

/**
 * Parse the color list from page text.
 * Formats:
 *   "カラー　全20色：1.赤金、2.青銀、..."
 *   "カラー　全7色\n1.アカキン、2.ミドキン、..."
 *   "カラー全5色（期間限定色）：LT66.ＧＧシャイニー、LT67.インサートシルバー、..."
 */
function parseColors(text: string): string[] {
  // Normalize full-width digits FIRST so regex \d+ works for 全１０色 etc.
  const normalized = normalizeFullWidth(text);

  // Find the color section: starts with "カラー" followed by count
  // Colon after 色 is OPTIONAL (many native lure pages omit it)
  // Allow arbitrary text between 色 and the actual color list
  const colorSectionMatch = normalized.match(
    /カラー[　\s：:]*全\d+色[^：:\n]*[：:]?\s*([\s\S]*?)(?=ウエイト|HOOK|フック|価格|タイプ|サイズ|ウエイト／サイズ|$)/i
  );
  if (!colorSectionMatch) return [];

  let colorText = colorSectionMatch[1].trim();

  // Remove note lines (※...)
  colorText = colorText.replace(/※[^\n]*/g, '').trim();
  // Remove directional annotations like "（左から）" "（上段左から）" "（下段左から）"
  colorText = colorText.replace(/[（(][^）)]*左から[）)]\s*/g, '').trim();
  // Remove newlines — collapse into single line
  colorText = colorText.replace(/[\n\r]+/g, '');

  // Split by Japanese comma 、 or regular comma ,
  const parts = colorText.split(/[、,]+/).map(s => s.trim()).filter(s => s.length > 0);

  const colors: string[] = [];
  for (let part of parts) {
    // Strip bare number prefix: "1." "2." "10." or just "1" "2" "10" (no period)
    // Keep alphanumeric codes like "LT66." "No.1"
    part = part.replace(/^\d+[.．]\s*/, '').trim();
    // Also handle numbering without period: "1赤金" → "赤金"
    // But only when followed by a non-digit (to avoid stripping "3D" etc.)
    part = part.replace(/^\d+(?=[^\d.．])/, '').trim();

    if (part && part.length >= 1 && !/^※/.test(part)) {
      colors.push(part);
    }
  }

  return colors;
}

/**
 * Parse weights from page text.
 * Formats:
 *   "ウエイト：1.4g"
 *   "ウエイト：1.6g・2.5ｇ・3.8g"
 *   "ウエイト：21F 0.9g / 21SS 1.1g"
 *   "ウエイト：Impact　 2ｇ　2.5ｇ"
 *   "ウエイト：38g"
 */
function parseWeights(text: string): number[] {
  // Normalize full-width to half-width first
  const normalized = normalizeFullWidth(text);

  // Find weight section — handle "ウエイト：" or "ウエイト／サイズ：" formats
  const weightMatch = normalized.match(/ウエイト[／/サイズ]*[：:]\s*([\s\S]*?)(?=<br|HOOK|フック|価格|カラー|\n\n|$)/i);
  if (!weightMatch) return [];

  const weightText = weightMatch[1].trim();

  // Extract all weight values (Ng or N.Ng pattern)
  const weights: number[] = [];
  const seen = new Set<number>();
  const weightPattern = /(\d+(?:\.\d+)?)\s*g/gi;
  let wm: RegExpExecArray | null;
  while ((wm = weightPattern.exec(weightText)) !== null) {
    const w = parseFloat(wm[1]);
    if (!isNaN(w) && w > 0 && !seen.has(w)) {
      seen.add(w);
      weights.push(w);
    }
  }

  return weights;
}

/**
 * Detect lure type from description text.
 */
function detectLureType(text: string, defaultType: string): string {
  const lower = text.toLowerCase();
  if (/ミノー/.test(text)) return 'ミノー';
  if (/クランク/.test(text)) return 'クランクベイト';
  if (/バイブ/.test(text)) return 'バイブレーション';
  if (/スプーン/.test(text)) return 'スプーン';
  // "iFish" type products (AT = area trout) — check for specific descriptions
  if (/プラグ/.test(text)) return 'クランクベイト';
  return defaultType;
}

/**
 * Parse price from text (税込 price preferred).
 */
function parsePrice(text: string): number {
  // Look for 税込 price: ￥572, 税込￥1,408, etc.
  const taxIncMatch = text.match(/税込[￥¥]?([\d,]+)/);
  if (taxIncMatch) return parseInt(taxIncMatch[1].replace(/,/g, ''));

  // Fallback: first price
  const priceMatch = text.match(/[￥¥]([\d,]+)/);
  if (priceMatch) return parseInt(priceMatch[1].replace(/,/g, ''));

  return 0;
}

/**
 * Parse length from text.
 */
function parseLength(text: string): number | null {
  const normalized = normalizeFullWidth(text);
  const lengthMatch = normalized.match(/サイズ[：:]\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (lengthMatch) return Math.round(parseFloat(lengthMatch[1]));
  return null;
}

async function scrapeProductPage(link: ProductLink): Promise<ScrapedProduct | null> {
  log(`Fetching product page: ${link.url}`);
  const html = await fetchPage(link.url);

  // --- Product name ---
  // <h1 class="entry-title page-title">MIU 1.4g</h1>
  const titleMatch = html.match(/<h1\s+class="entry-title\s+page-title">([^<]+)<\/h1>/i);
  const name = titleMatch ? stripTags(titleMatch[1]) : link.name;

  // --- Product image ---
  // First <img> in entry-content with wp-image class
  // Specifically look inside the entry-content div
  const entryContentStart = html.indexOf('class="entry-content');
  let imageUrl: string | null = null;
  if (entryContentStart >= 0) {
    const contentHtml = html.substring(entryContentStart);
    // Match the first real product image (wp-image or attachment-full)
    // Also handle http://test.forestjp.com/ domain used on some older pages
    const imgMatch = contentHtml.match(/<img[^>]+src="(https?:\/\/(?:test\.)?forestjp\.com\/wp-content\/uploads\/[^"]+\.(?:jpg|jpeg|png|gif|webp))"[^>]*class="[^"]*wp-image/i)
      || contentHtml.match(/<img[^>]+class="[^"]*wp-image[^"]*"[^>]+src="(https?:\/\/(?:test\.)?forestjp\.com\/wp-content\/uploads\/[^"]+\.(?:jpg|jpeg|png|gif|webp))"/i);
    if (imgMatch) {
      imageUrl = imgMatch[1];
    }
  }

  // --- Extract text content from entry-content ---
  // Strip all HTML to get plain text for parsing
  const entryContentEnd = html.indexOf('</article>', entryContentStart);
  const rawContent = entryContentStart >= 0
    ? html.substring(entryContentStart, entryContentEnd > 0 ? entryContentEnd : undefined)
    : html;
  // Keep <br> as newlines for parsing
  const textContent = rawContent
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/td>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8221;/g, '"')
    .replace(/&#8220;/g, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)));

  // --- Description ---
  // First meaningful paragraph of text (skip title/meta)
  const descLines = textContent.split('\n').filter(l => l.trim().length > 20);
  const description = descLines.length > 0 ? descLines[0].trim().substring(0, 500) : '';

  // --- Colors ---
  const colors = parseColors(textContent);

  // --- Weights ---
  const weights = parseWeights(textContent);

  // --- Lure type ---
  const lureType = detectLureType(textContent, link.defaultType);

  // --- Price ---
  const price = parsePrice(textContent);

  // --- Length ---
  const length = parseLength(textContent);

  log(`  Name: ${name}`);
  log(`  Image: ${imageUrl ? '✓' : '✗'}`);
  log(`  Type: ${lureType}`);
  log(`  Colors: ${colors.length}`);
  log(`  Weights: [${weights.join(', ')}]`);
  log(`  Price: ¥${price}`);

  if (colors.length === 0) {
    log(`  ⚠ No colors found — skipping product`);
    return null;
  }

  if (weights.length === 0) {
    log(`  ⚠ No weights found — using null weight`);
  }

  return {
    name,
    slug: link.slug,
    url: link.url,
    lureType,
    description,
    weights,
    colors,
    imageUrl,
    price,
    length,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction for pipeline integration
// ---------------------------------------------------------------------------

export const scrapeForestPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Derive slug and category from URL
  // URL format: https://forestjp.com/products/{area-lure|native-lure}/{slug}/
  const slugMatch = url.match(/\/products\/(area-lure|native-lure)\/([^/]+)\/?$/);
  const category = slugMatch ? slugMatch[1] : 'area-lure';
  const rawSlug = slugMatch ? slugMatch[2] : 'unknown';
  const slug = decodeSlug(rawSlug);

  const link: ProductLink = {
    name: slug,
    url,
    slug,
    defaultType: 'スプーン',
    category,
  };

  const scraped = await scrapeProductPage(link);
  if (!scraped) {
    throw new Error(`Failed to scrape product at ${url}`);
  }

  // Forest colors are just string names with a shared product image
  // Convert to ScrapedColor format: all colors share the same imageUrl
  const colors = scraped.colors.map(name => ({
    name,
    imageUrl: scraped.imageUrl || '',
  }));

  const mainImage = scraped.imageUrl || '';

  return {
    name: scraped.name,
    name_kana: '',
    slug: scraped.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: scraped.lureType,
    target_fish: ['トラウト'],
    description: scraped.description,
    price: scraped.price,
    colors,
    weights: scraped.weights,
    length: scraped.length,
    mainImage,
    sourceUrl: url,
  };
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('Forest Scraper Pipeline - Starting');
  log('========================================');

  const startTime = Date.now();
  let totalProducts = 0;
  let totalRows = 0;
  let totalColors = 0;
  let totalImages = 0;
  let skippedProducts = 0;
  let errorCount = 0;

  try {
    const makerRecordId = await findMakerRecordId();
    log(`Maker record ID: ${makerRecordId}`);

    // 1. Discover product links
    const productLinks = await discoverProducts();
    totalProducts = productLinks.length;

    // 2. Process each product
    for (let i = 0; i < productLinks.length; i++) {
      const link = productLinks[i];
      try {
        const scraped = await scrapeProductPage(link);
        if (!scraped) {
          skippedProducts++;
          await sleep(500);
          continue;
        }

        log(`\n--- [${i + 1}/${productLinks.length}] ${scraped.name} ---`);

        // Check if already in Airtable
        const alreadyInAirtable = await airtableLureExists(link.url);

        // Upload product image to R2 (single image shared by all colors)
        let r2ImageUrl: string | null = null;
        if (scraped.imageUrl) {
          try {
            const r2Key = `${MANUFACTURER_SLUG}/${scraped.slug}/product.webp`;
            r2ImageUrl = await processAndUploadImage(scraped.imageUrl, r2Key);
            totalImages++;
            log(`  Image uploaded: ${r2Key}`);
          } catch (err) {
            logError(`  Image failed: ${err instanceof Error ? err.message : err}`);
          }
        }

        // Build weight list
        const weightList: (number | null)[] = scraped.weights.length > 0
          ? scraped.weights
          : [null];

        // Insert into Supabase: one row per color × weight
        let rowsForProduct = 0;

        for (const colorName of scraped.colors) {
          for (const w of weightList) {
            try {
              const exists = await lureExists(scraped.slug, colorName, w);
              if (exists) {
                log(`  Skip existing: ${colorName} / ${w ?? 'N/A'}g`);
                continue;
              }

              await insertLure({
                name: scraped.name,
                slug: scraped.slug,
                manufacturer: MANUFACTURER,
                manufacturer_slug: MANUFACTURER_SLUG,
                type: scraped.lureType,
                price: scraped.price || null,
                description: scraped.description || null,
                images: r2ImageUrl ? [r2ImageUrl] : null,
                color_name: colorName,
                weight: w,
                length: scraped.length,
                is_limited: false,
                is_discontinued: false,
                target_fish: ['トラウト'],
              });
              rowsForProduct++;
            } catch (err) {
              logError(`  Insert failed: ${colorName}: ${err instanceof Error ? err.message : err}`);
              errorCount++;
            }
          }
        }

        totalRows += rowsForProduct;
        totalColors += scraped.colors.length;
        log(`  Inserted ${rowsForProduct} rows (${scraped.colors.length} colors × ${weightList.length} weights)`);

        // Create Airtable record if new
        if (!alreadyInAirtable) {
          try {
            await createAirtableLureRecord(
              scraped.name, link.url, makerRecordId, '登録完了',
              `${scraped.colors.length}色 x ${weightList.length}ウェイト = ${rowsForProduct}行`,
            );
          } catch (err) {
            logError(`  Airtable record failed: ${err instanceof Error ? err.message : err}`);
          }
        }

        await sleep(1000); // Polite delay
      } catch (err) {
        logError(`  Product failed: ${err instanceof Error ? err.message : err}`);
        errorCount++;
      }
    }

    // Update maker status
    log('\nUpdating maker status...');
    await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `/${makerRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { 'ステータス': '登録済み' } }),
    });

  } catch (err) {
    logError(`Pipeline failed: ${err instanceof Error ? err.message : err}`);
    errorCount++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('\n========================================');
  log('Forest Pipeline Summary');
  log('========================================');
  log(`Products discovered: ${totalProducts}`);
  log(`Products scraped: ${totalProducts - skippedProducts}`);
  log(`Products skipped (no colors): ${skippedProducts}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/forest');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
