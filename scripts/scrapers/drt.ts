// scripts/scrapers/drt.ts
// DRT (Division Rebel Tackles) scraper — WordPress custom theme
// fetch-only, no Playwright needed
// Scrapes bait, soft-bait, and jig categories

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

const MANUFACTURER = 'DRT';
const MANUFACTURER_SLUG = 'drt';
const SITE_BASE = 'https://www.divisionrebeltackles.com';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Category pages to scrape (only lure-related)
const CATEGORY_PAGES = [
  { url: `${SITE_BASE}/products/bait/`, type: 'ビッグベイト' },
  { url: `${SITE_BASE}/products/soft-bait/`, type: 'ワーム' },
  { url: `${SITE_BASE}/products/jig/`, type: 'ラバージグ' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  name: string;
  url: string;
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
function log(msg: string): void { console.log(`[${timestamp()}] [drt] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [drt] ERROR: ${msg}`); }
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
    .replace(/&#8243;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8220;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clean HTML entities in product name
function cleanName(name: string): string {
  return name
    .replace(/&#8243;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8220;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

// Parse length from text: "6.6 inch" → ~168mm, "230mm" → 230, "17-inch" → ~432mm
function parseLength(text: string): number | null {
  // Direct mm
  const mmMatch = text.match(/(\d+)\s*mm/i);
  if (mmMatch) return parseInt(mmMatch[1]);
  // Inches
  const inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:inch|インチ|″|")/i);
  if (inchMatch) return Math.round(parseFloat(inchMatch[1]) * 25.4);
  return null;
}

// Parse weight from text: "2oz class" → ~57g, "290g" → 290, "1/2oz" → ~14g
function parseWeight(text: string): number | null {
  // Direct grams
  const gMatch = text.match(/(\d+(?:\.\d+)?)\s*g(?:\s|$|[,)。])/i);
  if (gMatch) return parseFloat(gMatch[1]);
  // Ounces (decimal)
  const ozMatch = text.match(/(\d+(?:\.\d+)?)\s*oz/i);
  if (ozMatch) return Math.round(parseFloat(ozMatch[1]) * 28.35);
  // Ounces (fraction)
  const ozFracMatch = text.match(/(\d+)\/(\d+)\s*oz/i);
  if (ozFracMatch) return Math.round((parseInt(ozFracMatch[1]) / parseInt(ozFracMatch[2])) * 28.35);
  return null;
}

// Parse multiple weights (for jigs): "7g, 12g, 17.5g"
function parseWeights(text: string): number[] {
  const weights: number[] = [];
  const matches = text.matchAll(/(\d+(?:\.\d+)?)\s*g(?:\s|$|[,、/])/gi);
  for (const m of matches) {
    weights.push(parseFloat(m[1]));
  }
  return [...new Set(weights)];
}

// Detect lure type from product name/description
function detectType(name: string, desc: string, defaultType: string): string {
  const combined = (name + ' ' + desc).toLowerCase();
  if (combined.includes('shrimp') || combined.includes('エビ')) return 'ワーム';
  if (combined.includes('shad') || combined.includes('シャッド')) return 'ワーム';
  if (combined.includes('jig') || combined.includes('ジグ')) return 'ラバージグ';
  if (combined.includes('fink') || combined.includes('worm') || combined.includes('ワーム')) return 'ワーム';
  if (combined.includes('apollo') || combined.includes('living') || combined.includes('vts')) return 'ワーム';
  if (combined.includes('crankbait') || combined.includes('クランク')) return 'クランクベイト';
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
// Step 1: Discover product links from category pages
// ---------------------------------------------------------------------------

async function discoverProducts(): Promise<ProductLink[]> {
  const products: ProductLink[] = [];
  const seen = new Set<string>();

  for (const cat of CATEGORY_PAGES) {
    log(`Fetching category: ${cat.url}`);
    const html = await fetchPage(cat.url);

    // DRT product links: <a href="https://www.divisionrebeltackles.com/products/bait/NNNN/">
    // with product name in adjacent text or heading
    const linkMatches = extractAll(html, /<a[^>]*href="(https:\/\/www\.divisionrebeltackles\.com\/products\/(?:bait|soft-bait|jig)\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/gi);

    for (const m of linkMatches) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);

      // Try to extract product name from link content or nearby elements
      let name = stripTags(m[2]).trim();
      if (!name || name.length < 2) {
        // Try img alt text
        const altMatch = m[2].match(/alt="([^"]+)"/i);
        if (altMatch) name = altMatch[1];
      }
      if (!name || name.length < 2) name = `Product ${url.match(/\/(\d+)\/$/)?.[1] || 'unknown'}`;

      products.push({ name, url, defaultType: cat.type });
    }

    await sleep(500);
  }

  log(`Discovered ${products.length} product(s)`);
  return products;
}

// ---------------------------------------------------------------------------
// Step 2: Scrape a product page
// ---------------------------------------------------------------------------

async function scrapeProductPage(link: ProductLink): Promise<ScrapedProduct> {
  log(`Fetching product page: ${link.url}`);
  const html = await fetchPage(link.url);

  // Product name from <title> or og:title
  const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let name = ogTitleMatch ? cleanName(ogTitleMatch[1].split('|')[0].trim()) : '';
  if (!name) name = titleMatch ? cleanName(titleMatch[1].split('|')[0].trim()) : link.name;

  // Slug from URL
  const slug = name.toLowerCase()
    .replace(/[（）()]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-\.]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || `drt-${link.url.match(/\/(\d+)\/$/)?.[1] || 'unknown'}`;

  // Description from og:description or page content
  const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
  const description = ogDescMatch ? ogDescMatch[1].substring(0, 1000) : '';

  // Get full page text for spec parsing
  const bodyMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
    || html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const bodyText = bodyMatch ? stripTags(bodyMatch[1]) : stripTags(html);

  // Parse specs from text
  const length = parseLength(bodyText);
  const weight = parseWeight(bodyText);
  const weights = parseWeights(bodyText);

  // Detect type
  const type = detectType(name, bodyText, link.defaultType);

  // Color variants: find wp-content/uploads images
  // DRT uses WordPress gallery with images like:
  // /main/wp-content/uploads/YYYY/MM/COLORNAME.jpg
  const colors: ColorVariant[] = [];
  const seenColors = new Set<string>();

  // Strategy: find all product images from wp-content/uploads
  // Filter out thumbnails, logos, and non-product images
  const imgMatches = extractAll(
    html,
    /<img[^>]*src="(https?:\/\/www\.divisionrebeltackles\.com\/main\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"]+\.(?:jpg|jpeg|png|webp))"[^>]*(?:alt="([^"]*)")?[^>]*>/gi,
  );

  // Also check for srcset and data-src
  const dataSrcMatches = extractAll(
    html,
    /(?:data-src|data-large_image)="(https?:\/\/www\.divisionrebeltackles\.com\/main\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi,
  );

  const allImages: { url: string; alt: string }[] = [];
  const seenUrls = new Set<string>();

  for (const m of imgMatches) {
    const url = m[1].split('?')[0]; // Remove query params
    if (seenUrls.has(url)) continue;
    // Skip thumbnails (WordPress size suffixes like -150x150, -300x200)
    if (url.match(/-\d+x\d+\./)) continue;
    // Skip common non-product images
    if (url.includes('logo') || url.includes('banner') || url.includes('icon') || url.includes('arrow')) continue;
    seenUrls.add(url);
    allImages.push({ url, alt: m[2] || '' });
  }

  for (const m of dataSrcMatches) {
    const url = m[1].split('?')[0];
    if (seenUrls.has(url)) continue;
    if (url.match(/-\d+x\d+\./)) continue;
    if (url.includes('logo') || url.includes('banner') || url.includes('icon')) continue;
    seenUrls.add(url);
    allImages.push({ url, alt: '' });
  }

  // Extract color name from filename: /2023/07/DRTBASS-Ver2.jpg → "DRT BASS Ver2"
  for (const img of allImages) {
    const filenameMatch = img.url.match(/\/(\d{4})\/\d{2}\/([^/]+)\.\w+$/);
    if (!filenameMatch) continue;

    let colorName = img.alt || filenameMatch[2];
    // Clean up filename into readable color name
    colorName = colorName
      .replace(/[-_]+/g, ' ')
      .replace(/\d+$/, '')        // Remove trailing numbers
      .replace(/\s+/g, ' ')
      .trim();

    if (!colorName || colorName.length < 2) continue;
    if (seenColors.has(colorName.toLowerCase())) continue;
    seenColors.add(colorName.toLowerCase());

    colors.push({ name: colorName, imageUrl: img.url });
  }

  log(`  Name: ${name}, Type: ${type}, Length: ${length ?? 'N/A'}mm, Weight: ${weight ?? 'N/A'}g, Colors: ${colors.length}`);

  return {
    name,
    slug,
    url: link.url,
    type,
    description,
    length,
    weight,
    weights: weights.length > 0 ? weights : (weight ? [weight] : []),
    price: 0, // DRT doesn't publish prices
    colors,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction for pipeline integration
// ---------------------------------------------------------------------------

export const scrapeDrtPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Determine default type from URL path
  let defaultType = 'ビッグベイト';
  if (url.includes('/soft-bait/')) defaultType = 'ワーム';
  else if (url.includes('/jig/')) defaultType = 'ラバージグ';

  const link: ProductLink = {
    name: 'Unknown',
    url,
    defaultType,
  };

  const scraped = await scrapeProductPage(link);

  // Convert colors
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
  log('DRT Scraper Pipeline - Starting');
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
    log('\nUpdating maker status to 登録済み...');
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
  log('DRT Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/drt');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
