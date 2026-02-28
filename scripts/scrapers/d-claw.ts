// scripts/scrapers/d-claw.ts
// D-Claw scraper — Static HTML (Dreamweaver-era), UTF-8, fetch-only
// Products at item_saltwater.html, individual pages at offshore_*.html
// Spec table: 長さ | ウエイト | カラー | JAN | 価格
// Jig products have multiple tables (one per weight variant)
// Color images: images/{name}_cl_{N}.jpg or newcolor/{name}_{N}.jpg
// Prices are tax-excluded (×1.1 for tax-inclusive)

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

const MANUFACTURER = 'D-Claw';
const MANUFACTURER_SLUG = 'd-claw';
const SITE_BASE = 'https://d-claw.jp';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Hardcoded product list from item_saltwater.html
interface ProductDef {
  name: string;
  slug: string;
  page: string;          // relative URL
  type: string;          // ルアータイプ
  targetFish: string[];
}

const PRODUCTS: ProductDef[] = [
  // ABS SERIES
  { name: 'Beacon NEO 200', slug: 'beacon-neo-200', page: 'offshore_beaconneo200.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: "SWIMMING PENCIL D'abs230", slug: 'dabs-230', page: 'offshore_dabs230.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  // DIVING MARINO SLIM SERIES
  { name: 'MARINO300 SLIM', slug: 'marino-300-slim', page: 'offshore_marino300slim.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'MARINO250 SLIM', slug: 'marino-250-slim', page: 'offshore_marino250slim.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ'] },
  { name: 'MARINO200 SLIM', slug: 'marino-200-slim', page: 'offshore_marino200slim.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ'] },
  // MARINO SERIES
  { name: 'MARINO280 MESSAMAGNUM', slug: 'marino-280-messamagnum', page: 'offshore_marino280mm.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'GT'] },
  { name: 'MARINO230 MAGNUM', slug: 'marino-230-magnum', page: 'offshore_marino230.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'MARINO210', slug: 'marino-210', page: 'offshore_marino210.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'MARINO180', slug: 'marino-180', page: 'offshore_marino180.html', type: 'ダイビングペンシル', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
  { name: 'MARINO160', slug: 'marino-160', page: 'offshore_marino160.html', type: 'ダイビングペンシル', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
  // DIVING DIRT PENCIL (Bubbles)
  { name: 'Bubbles250GT', slug: 'bubbles-250gt', page: 'offshore_bubbles250gt.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'GT'] },
  { name: 'Bubbles250', slug: 'bubbles-250', page: 'offshore_bubbles250.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'Bubbles215', slug: 'bubbles-215', page: 'offshore_bubbles215.html', type: 'ダイビングペンシル', targetFish: ['ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'Bubbles190', slug: 'bubbles-190', page: 'offshore_bubbles190.html', type: 'ダイビングペンシル', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
  { name: 'Bubbles160', slug: 'bubbles-160', page: 'offshore_bubbles160.html', type: 'ダイビングペンシル', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
  // POPPER BEACON SERIES
  { name: 'Beacon210', slug: 'beacon-210', page: 'offshore_beacon210.html', type: 'ポッパー', targetFish: ['マグロ', 'ヒラマサ', 'GT'] },
  { name: 'Beacon180', slug: 'beacon-180', page: 'offshore_beacon180.html', type: 'ポッパー', targetFish: ['ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'Beacon180 HIRAMASA TUNE', slug: 'beacon-180-hiramasa-tune', page: 'offshore_beacon180hiramasatune.html', type: 'ポッパー', targetFish: ['ヒラマサ'] },
  { name: 'Beacon140', slug: 'beacon-140', page: 'offshore_beacon140.html', type: 'ポッパー', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
  { name: 'Beacon120', slug: 'beacon-120', page: 'offshore_beacon120.html', type: 'ポッパー', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
  // SKIP BATE & SINKING PENCIL
  { name: '円舞 Type-K', slug: 'enbu-type-k', page: 'offshore_enbu_typek.html', type: 'シンキングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ'] },
  { name: '水面CHOP!-TG', slug: 'suimen-chop-tg', page: 'offshore_suimenchop_tg.html', type: 'スキップベイト', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  // JIG
  { name: 'GOKUUSU 泳', slug: 'gokuusu-swim', page: 'offshore_gokuusu_swim.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'タチウオ'] },
  { name: 'GOKUUSU 跳', slug: 'gokuusu-tobi', page: 'offshore_gokuusu_tobi.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'タチウオ'] },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpecRow {
  length: number | null;
  weight: number | null;
  colorName: string;
  jan: string;
  price: number; // tax-excluded
}

interface ColorImage {
  url: string;
  index: number;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  type: string;
  targetFish: string[];
  description: string;
  specRows: SpecRow[];
  colorImages: ColorImage[];
  mainImageUrl: string | null;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [d-claw] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [d-claw] ERROR: ${msg}`); }
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clean color name:
 * - Remove #XX prefix (e.g., "#01 Blue back(ブルーバック)" → "Blue back(ブルーバック)")
 * - If Japanese name in parentheses exists, prefer it (e.g., "Blue back(ブルーバック)" → "ブルーバック")
 * - Otherwise return the cleaned name
 */
function cleanColorName(raw: string): string {
  let name = raw.trim();
  // Remove #XX or #X prefix
  name = name.replace(/^#\d+\s*/, '');
  // If there's a Japanese name in parentheses, extract it
  const jpMatch = name.match(/[（(]([^)）]+)[)）]/);
  if (jpMatch) {
    const jp = jpMatch[1].trim();
    // Use Japanese name if it contains Japanese characters
    if (/[\u3040-\u9fff]/.test(jp)) {
      return jp;
    }
  }
  return name.trim();
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

async function airtableFetch(tableId: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findOrCreateMaker(): Promise<string> {
  // Search for existing maker record
  const formula = encodeURIComponent(`{Slug}='${MANUFACTURER_SLUG}'`);
  const search = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${formula}&maxRecords=1`) as { records: { id: string }[] };
  if (search.records.length > 0) return search.records[0].id;

  // Create new maker record
  const created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': MANUFACTURER,
        'Slug': MANUFACTURER_SLUG,
        'ステータス': '処理中',
        '公式サイト': SITE_BASE,
      },
    }),
  }) as { id: string };
  log(`Created Airtable maker record: ${created.id}`);
  return created.id;
}

async function createAirtableLureRecord(
  name: string, url: string, makerRecordId: string,
  status: string, memo: string,
): Promise<void> {
  await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'ルアー名': name,
        'URL': url,
        'メーカー': [makerRecordId],
        'ステータス': status,
        '備考': memo,
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Scraping: spec table parsing
// ---------------------------------------------------------------------------

function parseSpecTables(html: string): SpecRow[] {
  const rows: SpecRow[] = [];
  // Find all tables that look like spec tables
  const tables = [...html.matchAll(/<table[^>]*class="table"[^>]*>([\s\S]*?)<\/table>/gi)];
  // If no class="table", try any table containing 価格 or カラー
  const allTables = tables.length > 0 ? tables :
    [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)]
      .filter(t => /カラー/.test(t[1]) || /価格/.test(t[1]));

  for (const tableMatch of allTables) {
    const tableHtml = tableMatch[1];
    const trs = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (trs.length < 2) continue;

    // Parse header to find column indices
    const headerCells = [...trs[0][1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(c => stripTags(c[1]));

    const lengthIdx = headerCells.findIndex(h => /長さ|全長|サイズ/.test(h));
    const weightIdx = headerCells.findIndex(h => /ウエイト|ウェイト|重さ|重量/.test(h));
    const colorIdx = headerCells.findIndex(h => /カラー|色/.test(h));
    const janIdx = headerCells.findIndex(h => /JAN/.test(h));
    const priceIdx = headerCells.findIndex(h => /価格/.test(h));

    if (colorIdx < 0) continue; // No color column = not a spec table

    // Track shared values (rowspan)
    let sharedLength: number | null = null;
    let sharedWeight: number | null = null;
    let sharedPrice = 0;

    for (let i = 1; i < trs.length; i++) {
      const cells = [...trs[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(c => stripTags(c[1]));
      if (cells.length === 0) continue;

      // If this row has all columns, update shared values
      if (cells.length >= headerCells.length) {
        // Full row — extract all values
        if (lengthIdx >= 0 && cells[lengthIdx]) {
          const m = cells[lengthIdx].match(/([\d.]+)/);
          sharedLength = m ? parseFloat(m[1]) : null;
        }
        if (weightIdx >= 0 && cells[weightIdx]) {
          const m = cells[weightIdx].match(/([\d.]+)/);
          sharedWeight = m ? parseFloat(m[1]) : null;
        }
        if (priceIdx >= 0 && cells[priceIdx]) {
          const priceStr = cells[priceIdx].replace(/[,，\s]/g, '');
          const m = priceStr.match(/([\d]+)/);
          sharedPrice = m ? parseInt(m[1], 10) : 0;
        }
        const colorName = colorIdx >= 0 ? cells[colorIdx] : '';
        const jan = janIdx >= 0 ? cells[janIdx] || '' : '';
        if (colorName) {
          rows.push({
            length: sharedLength,
            weight: sharedWeight,
            colorName: cleanColorName(colorName),
            jan,
            price: sharedPrice,
          });
        }
      } else {
        // Partial row (rowspan) — only color + JAN
        // The color and JAN are at reduced indices
        const colorName = cells[0] || '';
        const jan = cells.length > 1 ? cells[1] || '' : '';
        if (colorName) {
          rows.push({
            length: sharedLength,
            weight: sharedWeight,
            colorName: cleanColorName(colorName),
            jan,
            price: sharedPrice,
          });
        }
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Scraping: color images
// ---------------------------------------------------------------------------

function parseColorImages(html: string): ColorImage[] {
  const images: ColorImage[] = [];
  const seen = new Set<string>();

  // Find the "Color Lineup" section
  const colorSectionMatch = html.match(/Color\s*Lineup([\s\S]*?)(?:Spec|推奨|<\/section>|<h3[^>]*>(?!Color))/i);
  const searchArea = colorSectionMatch ? colorSectionMatch[1] : '';

  if (!searchArea) return images;

  // Collect all image URLs from Color Lineup section
  // First try lightbox links (<a href="...">) — prefer larger versions
  const aMatches = [...searchArea.matchAll(/<a[^>]+href="([^"]+\.(jpg|png|webp))"/gi)];
  // Then img src as fallback
  const imgMatches = [...searchArea.matchAll(/<img[^>]+src="([^"]+\.(jpg|png|webp))"/gi)];

  // Prefer lightbox (a href) over thumbnails (img src)
  const allMatches = aMatches.length > 0 ? aMatches : imgMatches;

  let idx = 0;
  for (const [, url] of allMatches) {
    const fullUrl = url.startsWith('http') ? url : `${SITE_BASE}/${url}`;
    // Deduplicate by URL
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    // Skip non-color images (nav, icons, etc.)
    const fname = (fullUrl.split('/').pop() || '').toLowerCase();
    if (fname.startsWith('nav') || fname.startsWith('icon') || fname.includes('logo')) continue;
    images.push({ url: fullUrl, index: idx++ });
  }

  return images;
}

// ---------------------------------------------------------------------------
// Scraping: description
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Find content between first two section.content or article tags
  // Look for meaningful description paragraphs
  const articles = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)];
  let desc = '';
  for (const [, content] of articles) {
    const text = stripTags(content);
    // Skip very short or header-only content
    if (text.length > 50 && !text.startsWith('HOME')) {
      desc = text;
      break;
    }
  }
  // Truncate to reasonable length
  if (desc.length > 500) desc = desc.substring(0, 500);
  return desc;
}

// ---------------------------------------------------------------------------
// Scraping: main image
// ---------------------------------------------------------------------------

function parseMainImage(html: string): string | null {
  // Main banner image
  const bannerMatch = html.match(/<div[^>]*id="mainBanner"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i) ||
    html.match(/<div[^>]*class="subImg"[^>]*>\s*<img[^>]+src="([^"]+)"/i);
  if (bannerMatch) {
    const src = bannerMatch[1];
    return src.startsWith('http') ? src : `${SITE_BASE}/${src}`;
  }
  // Fallback: first large image
  const firstImg = html.match(/<img[^>]+src="(images\/[^"]+_top[^"]*\.(jpg|png|webp))"/i);
  if (firstImg) return `${SITE_BASE}/${firstImg[1]}`;
  return null;
}

// ---------------------------------------------------------------------------
// Scrape one product page
// ---------------------------------------------------------------------------

async function scrapeProduct(product: ProductDef): Promise<ScrapedProduct> {
  const url = `${SITE_BASE}/${product.page}`;
  const html = await fetchPage(url);

  const specRows = parseSpecTables(html);
  const colorImages = parseColorImages(html);
  const description = parseDescription(html);
  const mainImageUrl = parseMainImage(html);

  return {
    name: product.name,
    slug: product.slug,
    type: product.type,
    targetFish: product.targetFish,
    description,
    specRows,
    colorImages,
    mainImageUrl,
    sourceUrl: url,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  let totalProducts = 0;
  let totalRows = 0;
  let totalColors = 0;
  let totalImages = 0;
  let errorCount = 0;

  log('========================================');
  log(`D-Claw Pipeline Start — ${PRODUCTS.length} products`);
  log('========================================');

  // --- Airtable: find or create maker ---
  let makerRecordId: string;
  try {
    makerRecordId = await findOrCreateMaker();
    log(`Airtable maker record: ${makerRecordId}`);
  } catch (err) {
    logError(`Airtable maker setup failed: ${err instanceof Error ? err.message : err}`);
    logError('Continuing without Airtable...');
    makerRecordId = '';
  }

  // --- Process each product ---
  for (const product of PRODUCTS) {
    log(`\n--- ${product.name} (${product.slug}) ---`);

    try {
      const scraped = await scrapeProduct(product);
      totalProducts++;

      if (scraped.specRows.length === 0) {
        logError(`  No spec rows found`);
        errorCount++;
        continue;
      }

      log(`  Spec rows: ${scraped.specRows.length}, Color images: ${scraped.colorImages.length}`);
      log(`  Colors: ${scraped.specRows.map(r => r.colorName).join(', ')}`);

      // Deduplicate weights from spec rows
      const weights = [...new Set(scraped.specRows.map(r => r.weight).filter(Boolean))] as number[];
      const lengths = [...new Set(scraped.specRows.map(r => r.length).filter(Boolean))] as number[];
      // Unique colors
      const uniqueColors = [...new Set(scraped.specRows.map(r => r.colorName))];

      // Upload main image
      let mainR2Url: string | null = null;
      if (scraped.mainImageUrl) {
        try {
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/main.webp`;
          mainR2Url = await processAndUploadImage(scraped.mainImageUrl, key);
          log(`  Main image uploaded`);
        } catch (err) {
          logError(`  Main image failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Upload color images and build mapping
      const colorImageMap = new Map<string, string>(); // colorName → R2 URL
      for (let ci = 0; ci < scraped.colorImages.length && ci < uniqueColors.length; ci++) {
        const colorName = uniqueColors[ci];
        const colorImg = scraped.colorImages[ci];
        try {
          const safeName = colorName.replace(/[^a-zA-Z0-9\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '-').toLowerCase();
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/${safeName}.webp`;
          const r2Url = await processAndUploadImage(colorImg.url, key);
          colorImageMap.set(colorName, r2Url);
          totalImages++;
        } catch (err) {
          logError(`  Color image failed [${colorName}]: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Insert rows into Supabase — 1 row per color × weight
      let rowsForProduct = 0;
      for (const specRow of scraped.specRows) {
        const colorName = specRow.colorName;
        const weight = specRow.weight;
        const length = specRow.length || (lengths.length === 1 ? lengths[0] : null);

        // Check if already exists
        if (await lureExists(scraped.slug, colorName, weight)) {
          log(`  Skip (exists): ${colorName} ${weight ? weight + 'g' : ''}`);
          continue;
        }

        // Tax-inclusive price (×1.1, round)
        const taxIncPrice = specRow.price > 0 ? Math.round(specRow.price * 1.1) : 0;

        const imageUrl = colorImageMap.get(colorName) || mainR2Url;

        await insertLure({
          name: scraped.name,
          slug: scraped.slug,
          manufacturer: MANUFACTURER,
          manufacturer_slug: MANUFACTURER_SLUG,
          type: scraped.type,
          price: taxIncPrice,
          description: scraped.description || null,
          images: imageUrl ? [imageUrl] : null,
          official_video_url: null,
          target_fish: scraped.targetFish,
          length: length,
          weight: weight,
          color_name: colorName,
          color_description: null,
          release_year: null,
          is_limited: false,
          diving_depth: null,
          action_type: null,
          source_url: scraped.sourceUrl,
          is_discontinued: false,
        });

        rowsForProduct++;
        totalRows++;
      }
      totalColors += uniqueColors.length;
      log(`  Inserted ${rowsForProduct} rows, ${colorImageMap.size}/${uniqueColors.length} color images`);

      // Create Airtable lure record
      if (makerRecordId) {
        try {
          await createAirtableLureRecord(
            scraped.name, scraped.sourceUrl, makerRecordId, '登録完了',
            `${uniqueColors.length}色 × ${weights.length || 1}ウェイト = ${rowsForProduct}行`,
          );
        } catch (err) {
          logError(`  Airtable lure record failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      await sleep(800); // Polite delay
    } catch (err) {
      logError(`  Product failed: ${err instanceof Error ? err.message : err}`);
      errorCount++;
    }
  }

  // Update maker status
  if (makerRecordId) {
    try {
      await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `/${makerRecordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { 'ステータス': '登録済み' } }),
      });
      log('\nMaker status updated to 登録済み');
    } catch (err) {
      logError(`Maker status update failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('\n========================================');
  log('D-Claw Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}/${PRODUCTS.length}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

main().catch(err => {
  logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
