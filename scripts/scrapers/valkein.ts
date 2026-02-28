// scripts/scrapers/valkein.ts
// Valkein scraper — WordPress site, fetch-only
// Category pages at /products/{spoons,hardbaits,metalvibe}/
// Product pages at /products/{category}/{slug}/
// Spec data in custom div grid, colors in data-* attributes
// ~54 lure products across spoons, hardbaits, metalvibe

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

const MANUFACTURER = 'Valkein';
const MANUFACTURER_SLUG = 'valkein';
const SITE_BASE = 'https://valkein.jp';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Category pages to scrape (skip rods, accessories, apparel)
const CATEGORY_PAGES: { path: string; defaultType: string }[] = [
  { path: '/products/spoons/', defaultType: 'スプーン' },
  { path: '/products/hardbaits/', defaultType: 'クランクベイト' },
  { path: '/products/metalvibe/', defaultType: 'メタルバイブレーション' },
];

// Map English spec "Category" column to Japanese type
const SPEC_CATEGORY_MAP: Record<string, string> = {
  'crankbait': 'クランクベイト',
  'minnow': 'ミノー',
  'vibration': 'メタルバイブレーション',
  'spoon': 'スプーン',
  'shad': 'シャッド',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductLink {
  name: string;
  url: string;
  slug: string;
  defaultType: string;
  category: string; // spoons, hardbaits, metalvibe
}

interface ColorVariant {
  name: string;
  imageUrl: string;
}

interface SpecRow {
  weight: number | null;
  length: number | null;
  price: number;
  category: string | null; // from spec table Category column
  type: string | null;     // from spec table Type column (Floating/Sinking)
}

interface ScrapedProduct {
  name: string;
  japaneseName: string;
  slug: string;
  url: string;
  lureType: string;
  description: string;
  specRows: SpecRow[];
  colors: ColorVariant[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [valkein] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [valkein] ERROR: ${msg}`); }
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
// Step 1: Discover product links from category listing pages
// ---------------------------------------------------------------------------

async function discoverProducts(): Promise<ProductLink[]> {
  const allProducts: ProductLink[] = [];
  const seen = new Set<string>();

  for (const cat of CATEGORY_PAGES) {
    const url = `${SITE_BASE}${cat.path}`;
    log(`Fetching category page: ${url}`);
    const html = await fetchPage(url);

    // Product cards use two different class patterns:
    //   Spoons/Metalvibe: <a class="product-list__item" href="...">
    //   Hardbaits: <a class="series-slider__item" href="...">
    // Both contain: <h3 class="product-name">NAME</h3>
    const cardPattern = /<a\s+class="(?:product-list__item|series-slider__item)"\s+href="([^"]+)"[\s\S]*?<h3\s+class="product-name">([^<]+)<\/h3>/gi;
    const matches = extractAll(html, cardPattern);

    for (const m of matches) {
      const href = m[1];
      const name = m[2].trim();

      // Extract slug from URL: /products/spoons/hi-burst/ → hi-burst
      const slugMatch = href.match(/\/products\/[^/]+\/([^/]+)\/?$/);
      if (!slugMatch) continue;
      const slug = slugMatch[1];

      if (seen.has(slug)) continue;
      seen.add(slug);

      // Extract category from path
      const categoryMatch = href.match(/\/products\/([^/]+)\//);
      const category = categoryMatch ? categoryMatch[1] : 'unknown';

      allProducts.push({
        name,
        url: href.startsWith('http') ? href : `${SITE_BASE}${href}`,
        slug,
        defaultType: cat.defaultType,
        category,
      });
    }

    log(`  Found ${matches.length} product(s) in ${cat.path}`);
    await sleep(500);
  }

  log(`\nTotal discovered: ${allProducts.length} product(s):`);
  for (const p of allProducts) {
    log(`  ${p.slug} → ${p.name} [${p.defaultType}]`);
  }
  return allProducts;
}

// ---------------------------------------------------------------------------
// Step 2: Parse spec data grid from product page
// ---------------------------------------------------------------------------

function parseSpecData(html: string): SpecRow[] {
  // Find the spec-data div with column count
  // <div class="spec-data --divisionN --lineM">
  const specDivMatch = html.match(/class="spec-data\s+--division(\d+)\s+--line(\d+)"/);
  if (!specDivMatch) return [];

  const numCols = parseInt(specDivMatch[1]);

  // Extract header names: <div class="spec-data-th">Weight</div>
  const headers: string[] = [];
  const headerMatches = extractAll(html, /<div\s+class="spec-data-th">([^<]+)<\/div>/gi);
  for (const m of headerMatches) {
    headers.push(m[1].trim());
  }

  if (headers.length !== numCols) {
    log(`  ⚠ Header count (${headers.length}) ≠ division count (${numCols})`);
  }

  // Find column indices (handle typos like "eightEIGHT" for "Weight")
  const weightIdx = headers.findIndex(h => /^(?:weight|eighteight)$/i.test(h));
  const lengthIdx = headers.findIndex(h => h.toLowerCase() === 'length');
  const priceIdx = headers.findIndex(h => h.toLowerCase() === 'price');
  const categoryIdx = headers.findIndex(h => h.toLowerCase() === 'category');
  const typeIdx = headers.findIndex(h => h.toLowerCase() === 'type');

  // Extract all data cells: <span class="spec-data-td__inner">VALUE</span>
  // Some cells contain inline HTML like <font color="red">NEW</font> 1.3g
  // so we use [\s\S]*? and strip tags afterward
  const cells: string[] = [];
  const cellMatches = extractAll(html, /<span\s+class="spec-data-td__inner">([\s\S]*?)<\/span>/gi);
  for (const m of cellMatches) {
    cells.push(stripTags(m[1]).trim());
  }

  // Chunk cells into rows by column count
  const rows: SpecRow[] = [];
  for (let i = 0; i + numCols <= cells.length; i += numCols) {
    const rowCells = cells.slice(i, i + numCols);

    // Parse weight (e.g., "0.4g", "1.8g", " 1.8g")
    let weight: number | null = null;
    if (weightIdx >= 0 && weightIdx < rowCells.length) {
      const wMatch = rowCells[weightIdx].match(/([\d.]+)\s*g/i);
      if (wMatch) weight = parseFloat(wMatch[1]);
    }

    // Parse length (e.g., "22mm", "36mm")
    let length: number | null = null;
    if (lengthIdx >= 0 && lengthIdx < rowCells.length) {
      const lMatch = rowCells[lengthIdx].match(/([\d.]+)\s*mm/i);
      if (lMatch) length = Math.round(parseFloat(lMatch[1]));
    }

    // Parse price (e.g., "¥550", "¥1,540")
    let price = 0;
    if (priceIdx >= 0 && priceIdx < rowCells.length) {
      const pMatch = rowCells[priceIdx].match(/[¥￥]?([\d,]+)/);
      if (pMatch) price = parseInt(pMatch[1].replace(/,/g, ''));
    }

    // Category (e.g., "Crankbait", "Vibration")
    let category: string | null = null;
    if (categoryIdx >= 0 && categoryIdx < rowCells.length) {
      category = rowCells[categoryIdx];
    }

    // Type (e.g., "Floating", "Sinking")
    let type: string | null = null;
    if (typeIdx >= 0 && typeIdx < rowCells.length) {
      type = rowCells[typeIdx];
    }

    rows.push({ weight, length, price, category, type });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Step 3: Scrape a product page
// ---------------------------------------------------------------------------

async function scrapeProductPage(link: ProductLink): Promise<ScrapedProduct> {
  log(`Fetching product page: ${link.url}`);
  const html = await fetchPage(link.url);

  // --- Product name ---
  // <h1 class="product-ttl__main">HI BURST</h1>
  // <h2 class="product-ttl__sub">ハイバースト</h2>
  let englishName = link.name;
  let japaneseName = '';

  const h1Match = html.match(/<h1\s+class="product-ttl__main">([^<]+)<\/h1>/i);
  if (h1Match) englishName = h1Match[1].trim();

  const h2Match = html.match(/<h2\s+class="product-ttl__sub">([^<]+)<\/h2>/i);
  if (h2Match) japaneseName = h2Match[1].trim();

  // Full name: "HI BURST（ハイバースト）" or just English if no Japanese
  const name = japaneseName
    ? `${englishName}（${japaneseName}）`
    : englishName;

  // --- Description ---
  let description = '';
  const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  if (ogDescMatch) {
    description = ogDescMatch[1].trim().substring(0, 500);
  }

  // --- Spec data ---
  const specRows = parseSpecData(html);

  // Determine lure type:
  // 1. From spec table Category column (if present)
  // 2. From default category type
  let lureType = link.defaultType;
  if (specRows.length > 0 && specRows[0].category) {
    const catLower = specRows[0].category.toLowerCase();
    if (SPEC_CATEGORY_MAP[catLower]) {
      lureType = SPEC_CATEGORY_MAP[catLower];
    }
  }

  // --- Color variants ---
  // <a data-name="No.1 ゴールド" data-img="https://..." ...>
  const colors: ColorVariant[] = [];
  const seenColors = new Set<string>();

  const colorPattern = /data-name="([^"]+)"[\s\S]*?data-img="([^"]+)"/gi;
  const colorMatches = extractAll(html, colorPattern);

  for (const m of colorMatches) {
    const colorName = m[1].trim();
    const imageUrl = m[2].trim();

    if (!colorName || colorName.length < 2) continue;
    if (seenColors.has(colorName.toLowerCase())) continue;
    seenColors.add(colorName.toLowerCase());

    colors.push({ name: colorName, imageUrl });
  }

  log(`  Name: ${name}`);
  log(`  Type: ${lureType}`);
  log(`  Spec rows: ${specRows.length} (weights: [${specRows.map(r => r.weight).join(', ')}])`);
  log(`  Colors: ${colors.length}`);

  return {
    name,
    japaneseName,
    slug: link.slug,
    url: link.url,
    lureType,
    description,
    specRows,
    colors,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('Valkein Scraper Pipeline - Starting');
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

        // Build weight list from spec rows
        const weights: (number | null)[] = scraped.specRows.length > 0
          ? scraped.specRows.map(r => r.weight)
          : [null];

        // Use max price
        const price = scraped.specRows.length > 0
          ? Math.max(...scraped.specRows.map(r => r.price).filter(p => p > 0), 0)
          : 0;

        // Use first row's length (typically same across weights for spoons)
        const length = scraped.specRows.length > 0 ? scraped.specRows[0].length : null;

        // Insert into Supabase
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
                type: scraped.lureType,
                price,
                description: scraped.description || null,
                images: imgUrl ? [imgUrl] : null,
                color_name: color.name,
                weight: w,
                length,
                is_limited: false,
                is_discontinued: false,
                target_fish: ['トラウト'],
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
              `${scraped.colors.length}色 x ${weights.length}ウェイト = ${rowsForProduct}行`,
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
  log('Valkein Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}`);
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
