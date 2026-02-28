// scripts/scrapers/flash-union.ts
// Flash Union scraper — custom PHP site, fetch-only
// Product pages at /product/[name].php with relative image paths
// ~20 lure products across hard lures, soft lures, swimbaits, jigs, wirebaits

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

const MANUFACTURER = 'Flash Union';
const MANUFACTURER_SLUG = 'flash-union';
const SITE_BASE = 'https://www.flash-union.jp';
const PRODUCT_LIST_URL = `${SITE_BASE}/product/`;
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Category header → lure type mapping (from listing page <h2> headers)
const CATEGORY_TYPE_MAP: Record<string, string> = {
  'hard lures': 'シャッド',
  'soft lures': 'ワーム',
  'wirebaits': 'スピナーベイト',
  'swimbaits': 'スイムベイト',
  'jigs': 'ラバージグ',
  'salt water': 'スイムベイト',
};

// Skip non-lure product slugs
const SKIP_SLUGS = new Set([
  'covercontacthook',
  'tg_finesse_rattler',
  'cutting_sticker',
  'flat_brim_cap',
  'mesh_cap_type_a',
  'long_t_01',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  name: string;
  url: string;
  phpSlug: string;     // e.g. "speed_killer" (original filename)
  slug: string;        // e.g. "speed-killer" (for DB/R2)
  defaultType: string;
}

interface ColorVariant {
  name: string;
  imageUrl: string;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  type: string;
  description: string;
  length: number | null;
  weight: number | null;
  weights: number[];
  price: number;
  colors: ColorVariant[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [flash-union] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [flash-union] ERROR: ${msg}`); }
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
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse length from text
function parseLength(text: string): number | null {
  const mmMatch = text.match(/(?:Length|全長|レングス)[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
  if (mmMatch) return Math.round(parseFloat(mmMatch[1]));
  // Try generic mm
  const genericMm = text.match(/(\d+)\s*mm/i);
  if (genericMm) return parseInt(genericMm[1]);
  // Try inch in product name: "2.2インチ", "95" (for swimmer products where name has size)
  const inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:inch|インチ)/i);
  if (inchMatch) return Math.round(parseFloat(inchMatch[1]) * 25.4);
  return null;
}

// Parse a single weight value from text
function parseSingleWeight(text: string): number | null {
  const gMatch = text.match(/(\d+(?:\.\d+)?)\s*g(?:\s|$|[,/)。])/i);
  if (gMatch) return parseFloat(gMatch[1]);
  return null;
}

// Parse multiple weights from spec table
function parseWeightsFromTable(html: string): { weights: number[]; prices: number[] } {
  const weights: number[] = [];
  const prices: number[] = [];

  // Match table rows: <tr><th>3.5g</th><td>1</td><td>780円</td></tr>
  // Use [^<]* for <th> content to prevent matching across tag boundaries
  // (avoids consuming the first data row when header row backtracks)
  const rows = extractAll(html, /<tr[^>]*>\s*<th[^>]*>([^<]*)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi);
  for (const row of rows) {
    const col1 = stripTags(row[1]).trim();
    const col3 = stripTags(row[3]).trim();

    // Parse weight from first column (e.g. "3.5g", "5g", "18g")
    const wMatch = col1.match(/^(\d+(?:\.\d+)?)\s*g$/i);
    if (wMatch) {
      weights.push(parseFloat(wMatch[1]));
    }

    // Parse price from third column (e.g. "780円", "1,080円")
    const pMatch = col3.match(/([\d,]+)\s*円/);
    if (pMatch) {
      prices.push(parseInt(pMatch[1].replace(/,/g, '')));
    }
  }

  return { weights: [...new Set(weights)].sort((a, b) => a - b), prices };
}

// Parse spec line like "Length: 60mm / Weight: 7.2g / Depth: Max1.5m / Hook Size: #8"
function parseSpecLine(text: string): { length: number | null; weight: number | null } {
  let length: number | null = null;
  let weight: number | null = null;

  const lenMatch = text.match(/Length[:\s]*(\d+(?:\.\d+)?)\s*mm/i);
  if (lenMatch) length = Math.round(parseFloat(lenMatch[1]));

  const wMatch = text.match(/Weight[:\s]*(\d+(?:\.\d+)?)\s*g/i);
  if (wMatch) weight = parseFloat(wMatch[1]);

  return { length, weight };
}

// Detect lure type from name (more specific overrides)
function detectType(name: string, defaultType: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('メタルソニック') || lower.includes('metal sonic')) return 'メタルバイブレーション';
  if (lower.includes('スピードキラー') || lower.includes('speed killer')) return 'シャッド';
  if (lower.includes('バイブス') || lower.includes("vibe's") || lower.includes('vibes')) return 'バイブレーション';
  return defaultType;
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
  let q = `slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
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
// Step 1: Discover product links from listing page
// ---------------------------------------------------------------------------

async function discoverProducts(): Promise<ProductLink[]> {
  log('Fetching product listing page...');
  const html = await fetchPage(PRODUCT_LIST_URL);
  const products: ProductLink[] = [];
  const seen = new Set<string>();

  // The main listing section (around lines 290-367) has:
  //   <h2 >Hard Lures</h2>
  //   <a href="speed_killer.php"><img src="speed_killer/title.png" alt="スピードキラー" class="img-fluid mb-4" /></a>
  //   ...
  //   <h2 >Soft Lures</h2>
  //   <a href="abacus_shad_22.php"><img src="abacus_shad_22/title.png" alt="アバカスシャッド 2.2インチ" ... /></a>

  // Find the main content section (after nav, before sidebar)
  // The main listing starts at the first <h2> that matches a category name
  const mainStart = html.search(/<h2[^>]*>\s*Hard Lures\s*<\/h2>/i);
  if (mainStart === -1) {
    logError('Could not find main listing section');
    return products;
  }

  // Find the sidebar section (starts with list-group-item links)
  const sidebarStart = html.indexOf('list-group-item', mainStart);
  const mainSection = sidebarStart > 0 ? html.substring(mainStart, sidebarStart) : html.substring(mainStart);

  // Split by <h2> category headers
  const parts = mainSection.split(/<h2[^>]*>/i);
  let currentType = 'その他';

  for (const part of parts) {
    // Check if this part starts with a category name
    const headingEnd = part.indexOf('</h2>');
    if (headingEnd > 0) {
      const heading = part.substring(0, headingEnd).toLowerCase().trim();
      for (const [key, type] of Object.entries(CATEGORY_TYPE_MAP)) {
        if (heading.includes(key)) {
          currentType = type;
          break;
        }
      }
      // Skip non-lure categories
      if (heading.includes('accessor') || heading.includes('apparel')) {
        currentType = '__SKIP__';
      }
    }

    if (currentType === '__SKIP__') continue;

    // Find product links with name from img alt attribute:
    // <a href="slug.php"><img src="slug/title.png" alt="Japanese Name" class="img-fluid mb-4" /></a>
    const linkPattern = /<a\s+href="([a-z0-9_]+)\.php"[^>]*>\s*<img[^>]*alt="([^"]*)"[^>]*>/gi;
    const linkMatches = extractAll(part, linkPattern);

    for (const m of linkMatches) {
      const phpSlug = m[1];
      if (seen.has(phpSlug)) continue;
      if (SKIP_SLUGS.has(phpSlug)) continue;
      seen.add(phpSlug);

      const name = m[2].trim() || phpSlug.replace(/_/g, ' ');
      const slug = phpSlug.replace(/_/g, '-');

      products.push({
        name,
        url: `${SITE_BASE}/product/${phpSlug}.php`,
        phpSlug,
        slug,
        defaultType: currentType,
      });
    }
  }

  log(`Discovered ${products.length} product(s):`);
  for (const p of products) {
    log(`  ${p.slug} → ${p.name} [${p.defaultType}]`);
  }
  return products;
}

// ---------------------------------------------------------------------------
// Step 2: Scrape a product page
// ---------------------------------------------------------------------------

async function scrapeProductPage(link: ProductLink): Promise<ScrapedProduct> {
  log(`Fetching product page: ${link.url}`);
  const html = await fetchPage(link.url);

  // --- Product name ---
  // Priority: og:title > h1 > listing name
  let name = link.name;
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  if (ogTitleMatch) {
    // og:title is like "スピードキラー Speed Killer  "
    name = ogTitleMatch[1].replace(/\s+$/, '').trim();
  } else {
    // h1: <h1>スピードキラー<small class="title_eng">Speed Killer</small></h1>
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      // Check if it's a product h1 (not nav h1 like "Home", "Product")
      const h1Text = stripTags(h1Match[1]);
      if (h1Text.length > 3 && !['Home', 'Product', 'Blog', 'Movie', 'Official Store'].includes(h1Text)) {
        name = h1Text;
      }
    }
  }

  // --- Description ---
  // og:description or first <p> after the h2 tagline
  let description = '';
  const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  if (ogDescMatch) {
    description = ogDescMatch[1].replace(/^製品情報\s*/, '').trim().substring(0, 500);
  }

  // --- Spec: length and weight from "Detail & Spec" section ---
  // Pattern: <h3>Detail & Spec</h3> followed by <p>Length: 60mm / Weight: 7.2g / ...</p>
  // Or just <h3>Detail</h3> (no specs inline, weights in table only)
  let specLength: number | null = null;
  let specWeight: number | null = null;

  const specSectionMatch = html.match(/<h3[^>]*>Detail[\s\S]*?<\/h3>\s*(?:<p[^>]*>([\s\S]*?)<\/p>)?/i);
  if (specSectionMatch && specSectionMatch[1]) {
    const specText = stripTags(specSectionMatch[1]);
    const parsed = parseSpecLine(specText);
    specLength = parsed.length;
    specWeight = parsed.weight;
  }

  // Try to get length from product name for sized products: "155", "120", "95"
  if (!specLength) {
    const nameSizeMatch = name.match(/(\d{2,3})(?:\s|$)/);
    if (nameSizeMatch) {
      const sizeNum = parseInt(nameSizeMatch[1]);
      if (sizeNum >= 50 && sizeNum <= 300) specLength = sizeNum; // mm
    }
  }

  // --- Weights and prices from Lineup table ---
  const { weights: tableWeights, prices } = parseWeightsFromTable(html);
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  // Consolidate weights
  const allWeights = tableWeights.length > 0 ? tableWeights : (specWeight ? [specWeight] : []);

  // If no price from table, try from page text
  let price = maxPrice;
  if (price === 0) {
    const pageText = stripTags(html);
    const priceMatch = pageText.match(/([\d,]+)\s*円/);
    if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
  }

  // Detect type (may override default based on product name)
  const type = detectType(name, link.defaultType);

  // --- Color variants ---
  // Pattern: <h5 class="color_name">#NNN colorname</h5>
  // Image: <img src="slug/NNN.png" alt="colorname" class="img-fluid pb-3" />
  const colors: ColorVariant[] = [];
  const seenColors = new Set<string>();

  // Find the Color chart section
  const colorChartStart = html.indexOf('Color chart');
  const colorSection = colorChartStart > 0 ? html.substring(colorChartStart) : html;

  // Find all color_chart_box divs or just pair images with h5.color_name
  // Pattern: <img src="slug/NNN.png" alt="alt_text" ...> ... <h5 class="color_name">#NNN colorname</h5>
  const colorBoxPattern = /<img[^>]*src="([^"]*\/[^"]+\.(?:png|jpg|jpeg|webp))"[^>]*alt="([^"]*)"[^>]*class="[^"]*img-fluid[^"]*pb-3[^"]*"[^>]*\/?>[\s\S]*?<h5\s+class="color_name"[^>]*>[\s\S]*?(#[A-Z0-9-]+\s+[^<]+)<\/h5>/gi;
  const colorMatches = extractAll(colorSection, colorBoxPattern);

  if (colorMatches.length > 0) {
    for (const m of colorMatches) {
      const relImgPath = m[1];
      const colorName = stripTags(m[3]).trim();

      if (!colorName || colorName.length < 2) continue;
      if (seenColors.has(colorName.toLowerCase())) continue;
      seenColors.add(colorName.toLowerCase());

      // Build absolute image URL
      const imageUrl = relImgPath.startsWith('http')
        ? relImgPath
        : `${SITE_BASE}/product/${relImgPath}`;

      colors.push({ name: colorName, imageUrl });
    }
  }

  // Fallback: try simpler pattern if the complex one didn't work
  if (colors.length === 0) {
    // Find all h5.color_name entries
    const h5Pattern = /<h5\s+class="color_name"[^>]*>[\s\S]*?(#[A-Z0-9-]+\s+[^<]+)<\/h5>/gi;
    const h5Matches = extractAll(colorSection, h5Pattern);

    // Find all product images
    const imgPattern = new RegExp(
      `<img[^>]*src="(${link.phpSlug}/[^"]+\\.(?:png|jpg|jpeg|webp))"[^>]*alt="([^"]*)"[^>]*>`,
      'gi',
    );
    const imgMatches = extractAll(colorSection, imgPattern);

    // Pair by index
    const imgUrls: string[] = [];
    const seenImgUrls = new Set<string>();
    for (const m of imgMatches) {
      const url = m[1];
      if (seenImgUrls.has(url)) continue;
      if (url.includes('title.') || url.includes('d1.') || url.includes('thumb')) continue;
      seenImgUrls.add(url);
      imgUrls.push(url);
    }

    for (let i = 0; i < Math.min(h5Matches.length, imgUrls.length); i++) {
      const colorName = stripTags(h5Matches[i][1]).trim();
      const relImgPath = imgUrls[i];

      if (!colorName || colorName.length < 2) continue;
      if (seenColors.has(colorName.toLowerCase())) continue;
      seenColors.add(colorName.toLowerCase());

      const imageUrl = `${SITE_BASE}/product/${relImgPath}`;
      colors.push({ name: colorName, imageUrl });
    }
  }

  // Also check for feco/eco sub-images
  const fecoPattern = new RegExp(
    `<img[^>]*src="(${link.phpSlug}/feco/[^"]+\\.(?:png|jpg|jpeg|webp))"[^>]*alt="([^"]*)"[^>]*>`,
    'gi',
  );
  const fecoImgMatches = extractAll(html, fecoPattern);
  const fecoH5Pattern = /<h5\s+class="color_name"[^>]*>[\s\S]*?(#[A-Z0-9-]+\s+[^<]+)<\/h5>/gi;

  // Find feco section (after "feco" heading or similar)
  const fecoStart = html.indexOf('feco/');
  if (fecoStart > 0 && fecoImgMatches.length > 0) {
    // Get feco h5 names from after the first feco image
    const fecoSection = html.substring(fecoStart - 500);
    const fecoH5Matches = extractAll(fecoSection, fecoH5Pattern);

    for (let i = 0; i < fecoImgMatches.length; i++) {
      const relPath = fecoImgMatches[i][1];
      const altText = fecoImgMatches[i][2];
      // Try to get name from h5 first, then alt
      let colorName = '';
      if (i < fecoH5Matches.length) {
        colorName = stripTags(fecoH5Matches[i][1]).trim();
      }
      if (!colorName) colorName = altText ? `feco ${altText}` : `feco #${i + 1}`;

      if (seenColors.has(colorName.toLowerCase())) continue;
      seenColors.add(colorName.toLowerCase());

      colors.push({ name: colorName, imageUrl: `${SITE_BASE}/product/${relPath}` });
    }
  }

  log(`  Name: ${name}`);
  log(`  Type: ${type}, Length: ${specLength ?? 'N/A'}mm, Weight: ${specWeight ?? 'N/A'}g`);
  log(`  Weights: [${allWeights.join(', ')}], Price: ¥${price}`);
  log(`  Colors: ${colors.length}`);

  return {
    name,
    slug: link.slug,
    url: link.url,
    type,
    description,
    length: specLength,
    weight: specWeight,
    weights: allWeights,
    price,
    colors,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction for pipeline integration
// ---------------------------------------------------------------------------

export const scrapeFlashUnionPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Construct a minimal ProductLink from the URL
  // URL format: https://www.flash-union.jp/product/{slug}.php
  const phpSlugMatch = url.match(/\/product\/([a-z0-9_]+)\.php$/i);
  const phpSlug = phpSlugMatch ? phpSlugMatch[1] : 'unknown';
  const slug = phpSlug.replace(/_/g, '-');

  const link: ProductLink = {
    name: phpSlug.replace(/_/g, ' '),
    url,
    phpSlug,
    slug,
    defaultType: 'その他',
  };

  const scraped = await scrapeProductPage(link);

  // Convert colors to ScrapedColor format
  const colors = scraped.colors.map(c => ({
    name: c.name,
    imageUrl: c.imageUrl,
  }));

  // Main image: first color image or empty
  const mainImage = colors.length > 0 ? colors[0].imageUrl : '';

  return {
    name: scraped.name,
    name_kana: '',
    slug: scraped.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: scraped.type,
    target_fish: ['ブラックバス'],
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
  log('Flash Union Scraper Pipeline - Starting');
  log('========================================');

  const startTime = Date.now();
  let totalProducts = 0;
  let totalRows = 0;
  let totalColors = 0;
  let totalImages = 0;
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
        log(`\n--- [${i + 1}/${productLinks.length}] ${scraped.name} ---`);

        if (scraped.colors.length === 0) {
          log(`  ⚠ No colors found, skipping product`);
          continue;
        }

        // Check if already in Airtable
        const alreadyInAirtable = await airtableLureExists(link.url);

        // Upload color images to R2
        const colorImageMap = new Map<string, string>();
        for (let ci = 0; ci < scraped.colors.length; ci++) {
          const color = scraped.colors[ci];
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

        // Insert into Supabase
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

        // Create Airtable record if new
        if (!alreadyInAirtable) {
          try {
            await createAirtableLureRecord(
              scraped.name, link.url, makerRecordId, '登録完了',
              `${scraped.colors.length}色 x ${weights.length}ウェイト = ${rowsForProduct}行挿入`,
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
  log('Flash Union Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/flash-union');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
