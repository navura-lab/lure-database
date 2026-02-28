// scripts/scrapers/hmkl.ts
// HMKL scraper — static HTML site (Shift_JIS), fetch-only
// Products listing at /products/, individual product pages at /products/pickup/NAME/
// Spec data in <div id="spec_part"> table, colors in <div id="color_part"> li elements
// Per-color images uploaded to R2 (similar to Valkein pattern)

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

const MANUFACTURER = 'HMKL';
const MANUFACTURER_SLUG = 'hmkl';
const SITE_BASE = 'http://www.hmklnet.com'; // HTTP — SSL cert is broken
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Non-product pages to skip when discovering product links
const SKIP_PAGES = new Set(['blankmodel', 'material', 'shoporiginal', '2021lb']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  name: string; // raw pickup path (e.g. "KI+50+SS")
  url: string;
  slug: string;
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
  weight: number | null;
  length: number | null;
  price: number;
  colors: ColorVariant[];
  targetFish: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [hmkl] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [hmkl] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/** Fetch a page and decode from Shift_JIS to UTF-8 */
async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const decoder = new TextDecoder('shift_jis');
  return decoder.decode(buffer);
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
// Lure type detection
// ---------------------------------------------------------------------------

function detectLureType(productName: string, typeField: string): string {
  const upper = productName.toUpperCase();
  const typeUpper = typeField.toUpperCase();

  // Order matters: check more specific patterns first
  if (/K-?I{1,3}\b/.test(upper) || /MINNOW/.test(upper) || /JORDAN/.test(upper)) return 'ミノー';
  if (/ZAGGER/.test(upper)) return 'ミノー';
  if (/CRANK/.test(upper)) return 'クランクベイト';
  if (/JIG/.test(upper)) return 'メタルジグ';
  if (/ALIVE/.test(upper)) return 'シャッド';
  if (/ASTAIL/.test(upper)) return 'テールスピン';
  if (/DYNAMO/.test(upper)) {
    if (/BUZZBAIT/.test(typeUpper)) return 'バズベイト';
    if (/SPINNERBAIT/.test(typeUpper)) return 'スピナーベイト';
    return 'スピナーベイト';
  }
  if (/PROPKING/.test(upper)) return 'プロップベイト';
  if (/K0/.test(upper) || /WAKE/.test(upper)) return 'ウェイクベイト';
  if (/FRY/.test(upper)) return 'クランクベイト';

  return 'ミノー';
}

// ---------------------------------------------------------------------------
// Target fish detection from MAIN TARGET field
// ---------------------------------------------------------------------------

function detectTargetFish(mainTarget: string): string[] {
  const upper = mainTarget.toUpperCase().trim();
  if (/TROUT/.test(upper)) return ['トラウト'];
  if (/BASS/.test(upper)) return ['ブラックバス'];
  if (/SALT/.test(upper)) return ['シーバス'];
  return ['トラウト', 'ブラックバス'];
}

// ---------------------------------------------------------------------------
// Spec table parsing
// ---------------------------------------------------------------------------

interface ParsedSpec {
  modelName: string;
  weight: number | null;
  length: number | null;
  price: number;
  targetFish: string[];
  typeField: string;
}

function parseSpecTable(html: string): ParsedSpec {
  const result: ParsedSpec = {
    modelName: '',
    weight: null,
    length: null,
    price: 0,
    targetFish: ['トラウト', 'ブラックバス'],
    typeField: '',
  };

  // Find spec table — try id="spec_part" first, then any <table> with WEIGHT row
  const specPartMatch = html.match(/<div\s+id="spec_part">([\s\S]*?)<\/div>/i);
  let specHtml: string;
  if (specPartMatch) {
    specHtml = specPartMatch[1];
  } else {
    // Fallback: find the first <table> that contains a WEIGHT row
    const tables = extractAll(html, /<table[^>]*>([\s\S]*?)<\/table>/gi);
    const specTable = tables.find(t => /WEIGHT/i.test(t[1]));
    if (!specTable) return result;
    specHtml = specTable[1];
  }

  // Extract all table rows
  const rows = extractAll(specHtml, /<tr>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];

    // Extract header (th) cells and data (td) cells
    const thMatches = extractAll(rowHtml, /<th[^>]*>([\s\S]*?)<\/th>/gi);
    if (thMatches.length === 0) continue;

    const label = stripTags(thMatches[0][1]).toUpperCase().trim();

    // MODEL row: <th>MODEL</th><th><span>NAME</span></th>
    if (label === 'MODEL') {
      if (thMatches.length >= 2) {
        // Get the span content inside the second <th>
        const spanMatch = thMatches[1][1].match(/<span[^>]*>([\s\S]*?)<\/span>/i);
        if (spanMatch) {
          result.modelName = stripTags(spanMatch[1]);
        } else {
          result.modelName = stripTags(thMatches[1][1]);
        }
      }
      continue;
    }

    // For other rows, extract <td> content
    const tdMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!tdMatch) continue;
    const tdText = stripTags(tdMatch[1]);

    switch (label) {
      case 'TYPE':
        result.typeField = tdText;
        break;

      case 'WEIGHT': {
        const wMatch = tdText.match(/([\d.]+)\s*g/i);
        if (wMatch) result.weight = parseFloat(wMatch[1]);
        break;
      }

      case 'LENGTH': {
        // Length is in cm (e.g., "5.0cm"), convert to mm
        const lMatch = tdText.match(/([\d.]+)\s*cm/i);
        if (lMatch) {
          result.length = Math.round(parseFloat(lMatch[1]) * 10);
        } else {
          // Fallback: try mm directly
          const mmMatch = tdText.match(/([\d.]+)\s*mm/i);
          if (mmMatch) result.length = Math.round(parseFloat(mmMatch[1]));
        }
        break;
      }

      case 'PRICE': {
        // Prefer tax-included price: "税込 1,485円" or "（ 税込 1,485円 ）"
        const taxIncMatch = tdText.match(/税込\s*[￥¥]?([\d,]+)\s*円/);
        if (taxIncMatch) {
          result.price = parseInt(taxIncMatch[1].replace(/,/g, ''));
        } else {
          // Fallback: first yen amount (may be 税抜, or ￥N,NNN format)
          const yenFmt = tdText.match(/[￥¥]([\d,]+)/);
          if (yenFmt) {
            result.price = parseInt(yenFmt[1].replace(/,/g, ''));
          } else {
            const yenMatch = tdText.match(/([\d,]+)\s*円/);
            if (yenMatch) result.price = parseInt(yenMatch[1].replace(/,/g, ''));
          }
        }
        break;
      }

      case 'MAIN TARGET':
        result.targetFish = detectTargetFish(tdText);
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Color parsing
// ---------------------------------------------------------------------------

function parseColors(html: string, productPickupName: string): ColorVariant[] {
  const baseImgUrl = `${SITE_BASE}/products/pickup/${productPickupName}/`;
  const colors: ColorVariant[] = [];

  // Collect color HTML from ALL known section types:
  // 1. id="color_part" (newer pages)
  // 2. id="colors" (older pages — wraps list1/list2)
  // 3. id="colist" (older pages — alternating li pattern)
  // 4. id="list1", id="list2" (sometimes standalone)
  const sectionIds = ['color_part', 'colors', 'colist', 'list1', 'list2'];
  let combinedColorHtml = '';

  for (const sid of sectionIds) {
    // Match section by ID — grab content up to closing tag or next section
    const re = new RegExp(`<(?:div|ul)\\s+id="${sid}"[^>]*>([\\s\\S]*?)(?:<\\/(?:div|ul)>)`, 'i');
    const m = html.match(re);
    if (m) combinedColorHtml += '\n' + m[1];
  }

  if (!combinedColorHtml) return [];

  // Extract all <li> elements
  const liItems = extractAll(combinedColorHtml, /<li>([\s\S]*?)<\/li>/gi);

  // ---- Handle "colist" alternating pattern ----
  // In colist, color names are in <li><u>EN [JP]</u>desc</li> and images in next <li><a href="img/..">
  // We detect colist by checking if html has id="colist"
  const isColist = /<(?:div|ul)\s+id="colist"/i.test(html);

  if (isColist) {
    // Process alternating pairs: text li, then image li
    for (let i = 0; i < liItems.length - 1; i += 2) {
      const textLi = liItems[i][1];
      const imageLi = liItems[i + 1][1];

      // Color name from <u>EN [JP]</u> in text li
      let colorName = '';
      // Try half-width brackets [JP] first
      const hwBracket = textLi.match(/\[([^\]]+)\]/);
      if (hwBracket) {
        colorName = hwBracket[1].trim();
      } else {
        // Full-width brackets ［JP］
        const fwBracket = textLi.match(/［([^］]+)］/);
        if (fwBracket) {
          colorName = fwBracket[1].trim();
        } else {
          // Fallback: text from <u> tag
          const uMatch = textLi.match(/<u[^>]*>([\s\S]*?)<\/u>/i);
          if (uMatch) colorName = stripTags(uMatch[1]).trim();
        }
      }

      if (!colorName) continue;

      // Image from <a href="img/..."> or <img src="img/..."> in image li
      const imgMatch = imageLi.match(/<a\s+[^>]*href="(img[/\\][^"]+)"/i)
        || imageLi.match(/<img\s+[^>]*src="(img[/\\][^"]+)"/i);
      if (!imgMatch) continue;

      colors.push({
        name: colorName.replace(/※.*/g, '').trim(),
        imageUrl: baseImgUrl + imgMatch[1].replace(/\\/g, '/'),
      });
    }
    return colors;
  }

  // ---- Standard pattern (color_part / colors / list1 / list2) ----
  // Each <li> contains both color name (as text) and image (<a href>)
  for (const liMatch of liItems) {
    const liHtml = liMatch[1];

    // Must have an image — prefer <a href="img/..."> (large image), fallback to <img src="img/...">
    const imgLinkMatch = liHtml.match(/<a\s+[^>]*href="(img[/\\][^"]+)"/i)
      || liHtml.match(/<img\s+[^>]*src="(img[/\\][^"]+)"/i);
    if (!imgLinkMatch) continue;

    // --- Color name ---
    let colorName = '';
    // Try full-width brackets ［JP］ (newer pages)
    const fwBracket = liHtml.match(/［([^］]+)］/);
    if (fwBracket) {
      colorName = fwBracket[1].trim();
    } else {
      // Try half-width brackets [JP]
      const hwBracket = liHtml.match(/\[([^\]]+)\]/);
      if (hwBracket) {
        colorName = hwBracket[1].trim();
      } else {
        // Fallback: text before <a> or <img> tag, stripping <span> and <br> tags
        let textPart = liHtml.split(/<(?:a\s|img\s)/i)[0] || '';
        textPart = textPart.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, '');
        textPart = textPart.replace(/<br\s*\/?>/gi, '');
        textPart = stripTags(textPart);
        colorName = textPart.trim();
      }
    }

    // Clean up: remove ※ annotations
    colorName = colorName.replace(/※.*/g, '').trim();

    // If no text color name found, try extracting from <img title="PRODUCT | COLOR_NAME">
    if (!colorName || colorName.length < 1) {
      const titleMatch = liHtml.match(/title="[^|"]*\|\s*([^"]+)"/i);
      if (titleMatch) {
        colorName = titleMatch[1].trim();
      }
    }

    if (!colorName || colorName.length < 1) continue;

    // Skip navigation/non-color items
    if (/^(カラー|スペック|使い方|HOW TO|SPEC|COLOR)/i.test(colorName)) continue;

    const imageUrl = baseImgUrl + imgLinkMatch[1].replace(/\\/g, '/');
    colors.push({ name: colorName, imageUrl });
  }

  return colors;
}

// ---------------------------------------------------------------------------
// Description extraction
// ---------------------------------------------------------------------------

function extractDescription(html: string): string {
  // Try to find a descriptive <p> tag in the main body area
  // Skip the spec/color sections and look for content paragraphs
  const pMatches = extractAll(html, /<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of pMatches) {
    const text = stripTags(m[1]);
    // Skip very short text, navigation text, and spec labels
    if (text.length < 20) continue;
    if (/^(MODEL|TYPE|WEIGHT|LENGTH|PRICE|MAIN TARGET|HOME|PRODUCTS)/i.test(text)) continue;
    if (/^(カラー|スペック|色|img)/i.test(text)) continue;
    return text.substring(0, 500);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function makeSlug(pickupName: string): string {
  return pickupName.replace(/\+/g, '-').toLowerCase();
}

// ---------------------------------------------------------------------------
// Step 1: Discover product links from /products/ listing page
// ---------------------------------------------------------------------------

async function discoverProducts(): Promise<ProductLink[]> {
  const url = `${SITE_BASE}/products/`;
  log(`Fetching products listing page: ${url}`);
  const html = await fetchPage(url);

  const allProducts: ProductLink[] = [];
  const seen = new Set<string>();

  // Extract all href="pickup/XXX" links
  const linkPattern = /href="pickup\/([^"]+)"/gi;
  const matches = extractAll(html, linkPattern);

  for (const m of matches) {
    let pickupName = m[1];

    // Remove trailing slash if present
    pickupName = pickupName.replace(/\/$/, '');

    // Remove trailing /index.html or similar
    pickupName = pickupName.replace(/\/index\.html?$/, '');

    // Skip non-product pages
    if (SKIP_PAGES.has(pickupName.toLowerCase())) continue;

    // Deduplicate
    if (seen.has(pickupName)) continue;
    seen.add(pickupName);

    const productUrl = `${SITE_BASE}/products/pickup/${pickupName}/`;
    const slug = makeSlug(pickupName);

    allProducts.push({
      name: pickupName,
      url: productUrl,
      slug,
    });
  }

  log(`Total discovered: ${allProducts.length} product(s):`);
  for (const p of allProducts) {
    log(`  ${p.name} -> ${p.slug}`);
  }
  return allProducts;
}

// ---------------------------------------------------------------------------
// Step 2: Scrape a product page
// ---------------------------------------------------------------------------

async function scrapeProductPage(link: ProductLink): Promise<ScrapedProduct | null> {
  log(`Fetching product page: ${link.url}`);
  const html = await fetchPage(link.url);

  // --- Spec table ---
  const spec = parseSpecTable(html);
  const name = spec.modelName || link.name.replace(/\+/g, ' ');

  // --- Lure type ---
  const lureType = detectLureType(name, spec.typeField);

  // --- Colors ---
  const colors = parseColors(html, link.name);

  // --- Description ---
  const description = extractDescription(html);

  log(`  Name: ${name}`);
  log(`  Type: ${lureType}`);
  log(`  Weight: ${spec.weight ?? 'N/A'}g`);
  log(`  Length: ${spec.length ?? 'N/A'}mm`);
  log(`  Price: ${spec.price}`);
  log(`  Target: [${spec.targetFish.join(', ')}]`);
  log(`  Colors: ${colors.length}`);

  if (colors.length === 0) {
    log(`  No colors found -- skipping product`);
    return null;
  }

  return {
    name,
    slug: link.slug,
    url: link.url,
    lureType,
    description,
    weight: spec.weight,
    length: spec.length,
    price: spec.price,
    colors,
    targetFish: spec.targetFish,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction for pipeline integration
// ---------------------------------------------------------------------------

export const scrapeHmklPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Derive pickup name from URL
  // URL format: http://www.hmklnet.com/products/pickup/{NAME}/
  const pickupMatch = url.match(/\/products\/pickup\/([^/]+)\/?$/);
  const pickupName = pickupMatch ? pickupMatch[1] : 'unknown';
  const slug = makeSlug(pickupName);

  const link: ProductLink = {
    name: pickupName,
    url,
    slug,
  };

  const scraped = await scrapeProductPage(link);
  if (!scraped) {
    throw new Error(`Failed to scrape product at ${url}`);
  }

  // Convert colors
  const colors = scraped.colors.map(c => ({
    name: c.name,
    imageUrl: c.imageUrl,
  }));

  // Main image: first color image or empty
  const mainImage = colors.length > 0 ? colors[0].imageUrl : '';

  // Single weight per product
  const weights = scraped.weight !== null ? [scraped.weight] : [];

  return {
    name: scraped.name,
    name_kana: '',
    slug: scraped.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: scraped.lureType,
    target_fish: scraped.targetFish,
    description: scraped.description,
    price: scraped.price,
    colors,
    weights,
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
  log('HMKL Scraper Pipeline - Starting');
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

        // Upload per-color images to R2
        const colorImageMap = new Map<string, string>();
        for (let ci = 0; ci < scraped.colors.length; ci++) {
          const color = scraped.colors[ci];
          try {
            const r2Key = `${MANUFACTURER_SLUG}/${scraped.slug}/${ci}.webp`;
            const pubUrl = await processAndUploadImage(color.imageUrl, r2Key);
            colorImageMap.set(color.name, pubUrl);
            totalImages++;
            log(`  Image uploaded: ${r2Key}`);
          } catch (err) {
            logError(`  Image failed for ${color.name}: ${err instanceof Error ? err.message : err}`);
          }
        }

        // Single weight per product
        const weight = scraped.weight;

        // Insert into Supabase: one row per color
        let rowsForProduct = 0;

        for (const color of scraped.colors) {
          try {
            const exists = await lureExists(scraped.slug, color.name, weight);
            if (exists) {
              log(`  Skip existing: ${color.name} / ${weight ?? 'N/A'}g`);
              continue;
            }

            const imgUrl = colorImageMap.get(color.name) || null;
            await insertLure({
              name: scraped.name,
              slug: scraped.slug,
              manufacturer: MANUFACTURER,
              manufacturer_slug: MANUFACTURER_SLUG,
              type: scraped.lureType,
              price: scraped.price || null,
              description: scraped.description || null,
              images: imgUrl ? [imgUrl] : null,
              color_name: color.name,
              weight,
              length: scraped.length,
              is_limited: false,
              is_discontinued: false,
              target_fish: scraped.targetFish,
            });
            rowsForProduct++;
          } catch (err) {
            logError(`  Insert failed: ${color.name}: ${err instanceof Error ? err.message : err}`);
            errorCount++;
          }
        }

        totalRows += rowsForProduct;
        totalColors += scraped.colors.length;
        log(`  Inserted ${rowsForProduct} rows (${scraped.colors.length} colors x 1 weight)`);

        // Create Airtable record if new
        if (!alreadyInAirtable) {
          try {
            await createAirtableLureRecord(
              scraped.name, link.url, makerRecordId, '登録完了',
              `${scraped.colors.length}色 x 1ウェイト = ${rowsForProduct}行`,
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
  log('HMKL Pipeline Summary');
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
const isDirectRun = process.argv[1]?.includes('/scrapers/hmkl');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
