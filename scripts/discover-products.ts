// scripts/discover-products.ts
// Discovers new BlueBlue products by crawling series pages and comparing
// against existing Airtable records. New products are auto-registered in
// Airtable with status '未処理' so the nightly pipeline picks them up.
//
// Usage:
//   npx tsx scripts/discover-products.ts              # normal run
//   npx tsx scripts/discover-products.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BLUEBLUE_BASE_URL = 'https://www.bluebluefishing.com';
const ITEM_INDEX_URL = `${BLUEBLUE_BASE_URL}/item/`;

// Only crawl saltwater lure series (001001)
// Exclude: 001002 (bass — mostly rods), 001007 (membership-only items)
const LURE_SERIES_PREFIXES = ['/item/series/001001/'];

// Products whose names contain these keywords are skipped (parts, not lures)
const EXCLUDED_NAME_KEYWORDS = ['ジグヘッド', 'ワーム', '交換用', 'パワーヘッド', 'フック'];

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

// BlueBlue maker record ID in Airtable (fetched dynamically at startup)
let BLUEBLUE_MAKER_RECORD_ID = '';

const PAGE_LOAD_DELAY_MS = 2000;
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [discover] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [discover] ERROR: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch<T>(
  tableId: string,
  path: string = '',
  options: RequestInit = {},
): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Get all existing product URLs from Airtable (any status).
 * Returns a Set of normalized URLs.
 */
async function fetchExistingAirtableUrls(): Promise<Set<string>> {
  log('Fetching existing Airtable URLs...');
  const urls = new Set<string>();
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ 'fields[]': 'URL' });
    if (offset) params.set('offset', offset);

    const data = await airtableFetch<{
      records: Array<{ fields: { URL?: string } }>;
      offset?: string;
    }>(AIRTABLE_LURE_URL_TABLE_ID, `?${params.toString()}`);

    for (const record of data.records) {
      const url = record.fields.URL;
      if (url) urls.add(normalizeUrl(url));
    }
    offset = data.offset;
  } while (offset);

  log(`Found ${urls.size} existing URLs in Airtable`);
  return urls;
}

/**
 * Fetch the BlueBlue maker record ID from Airtable.
 */
async function fetchBlueBlueRecordId(): Promise<string> {
  const filter = encodeURIComponent("{Slug}='blueblue'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length === 0) {
    throw new Error('BlueBlue maker record not found in Airtable');
  }
  return data.records[0].id;
}

/**
 * Create a new record in the Airtable ルアーURL table.
 */
async function createAirtableRecord(
  lureName: string,
  url: string,
  makerId: string,
): Promise<void> {
  await airtableFetch(
    AIRTABLE_LURE_URL_TABLE_ID,
    '',
    {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          'ルアー名': lureName,
          'URL': url,
          'メーカー': [makerId],
          'ステータス': '未処理',
          '備考': `自動検出 (${new Date().toISOString().split('T')[0]})`,
        },
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a BlueBlue URL to a canonical form for comparison.
 * Ensures trailing slash and www prefix.
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();
  // Ensure www prefix
  normalized = normalized.replace(
    'https://bluebluefishing.com',
    'https://www.bluebluefishing.com',
  );
  // Ensure trailing slash
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

/**
 * Scrape the BlueBlue /item/ page to find all series page URLs.
 */
async function discoverSeriesUrls(page: Page): Promise<string[]> {
  log(`Navigating to item index: ${ITEM_INDEX_URL}`);
  await page.goto(ITEM_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const allLinks = await page.locator('a[href*="/item/series/"]').all();
  const seriesUrls: string[] = [];

  for (const link of allLinks) {
    const href = await link.getAttribute('href');
    if (!href) continue;

    // Only include lure categories
    const isLureCategory = LURE_SERIES_PREFIXES.some(prefix => href.startsWith(prefix));
    if (!isLureCategory) continue;

    const fullUrl = href.startsWith('http') ? href : `${BLUEBLUE_BASE_URL}${href}`;
    seriesUrls.push(fullUrl);
  }

  // Deduplicate
  const unique = [...new Set(seriesUrls)];
  log(`Found ${unique.length} lure series pages to crawl`);
  return unique;
}

/**
 * Scrape a single series page to find all product detail URLs.
 * Also extracts the product name from the link text.
 */
async function discoverProductsFromSeries(
  page: Page,
  seriesUrl: string,
): Promise<Array<{ url: string; name: string }>> {
  await page.goto(seriesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const detailLinks = await page.locator('a[href*="/item/detail/"]').all();
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const link of detailLinks) {
    const href = await link.getAttribute('href');
    if (!href) continue;

    const fullUrl = href.startsWith('http') ? href : `${BLUEBLUE_BASE_URL}${href}`;
    const normalized = normalizeUrl(fullUrl);

    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Try to get product name from link text or parent element
    let name = (await link.textContent())?.trim() || '';
    if (!name) {
      // Try parent element for name
      const parent = link.locator('..');
      name = (await parent.textContent())?.trim() || '';
    }
    // Clean up name — take first line only, remove excess whitespace
    name = name.split('\n')[0].trim().substring(0, 100);

    products.push({ url: normalized, name: name || '(名前取得失敗)' });
  }

  return products;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('Product Discovery - Starting');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('========================================');

  const startTime = Date.now();

  // 1. Get BlueBlue maker record ID
  BLUEBLUE_MAKER_RECORD_ID = await fetchBlueBlueRecordId();
  log(`BlueBlue maker record ID: ${BLUEBLUE_MAKER_RECORD_ID}`);

  // 2. Get existing URLs from Airtable
  const existingUrls = await fetchExistingAirtableUrls();

  // 3. Launch browser and discover products
  log('Launching browser...');
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  let allDiscoveredProducts: Array<{ url: string; name: string }> = [];

  try {
    // 3a. Find all series pages
    const seriesUrls = await discoverSeriesUrls(page);

    // 3b. Crawl each series page for product detail URLs
    for (let i = 0; i < seriesUrls.length; i++) {
      const seriesUrl = seriesUrls[i];
      log(`Crawling series ${i + 1}/${seriesUrls.length}: ${seriesUrl}`);

      try {
        const products = await discoverProductsFromSeries(page, seriesUrl);
        log(`  Found ${products.length} product(s)`);
        allDiscoveredProducts.push(...products);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`Failed to crawl series ${seriesUrl}: ${errMsg}`);
      }

      // Polite delay between pages
      if (i < seriesUrls.length - 1) {
        await sleep(PAGE_LOAD_DELAY_MS);
      }
    }
  } finally {
    await browser.close();
    log('Browser closed');
  }

  // 4. Deduplicate discovered products
  const uniqueProducts = new Map<string, string>(); // url -> name
  for (const p of allDiscoveredProducts) {
    if (!uniqueProducts.has(p.url)) {
      uniqueProducts.set(p.url, p.name);
    }
  }
  log(`Total unique products discovered: ${uniqueProducts.size}`);

  // 5. Find new products (not in Airtable, not excluded by keyword)
  const newProducts: Array<{ url: string; name: string }> = [];
  let skippedByKeyword = 0;
  for (const [url, name] of uniqueProducts) {
    if (existingUrls.has(url)) continue;

    // Skip parts/accessories based on name keywords
    const isExcluded = EXCLUDED_NAME_KEYWORDS.some(kw => name.includes(kw));
    if (isExcluded) {
      log(`  Skipping (excluded keyword): ${name}`);
      skippedByKeyword++;
      continue;
    }

    newProducts.push({ url, name });
  }

  log(`New products found: ${newProducts.length}`);

  if (newProducts.length === 0) {
    log('No new products to register. All caught up!');
  } else {
    log('--- New Products ---');
    for (const p of newProducts) {
      log(`  ${p.name}: ${p.url}`);
    }

    // 6. Register new products in Airtable
    if (!DRY_RUN) {
      log('Registering new products in Airtable...');
      let registered = 0;
      let errors = 0;

      for (const p of newProducts) {
        try {
          await createAirtableRecord(p.name, p.url, BLUEBLUE_MAKER_RECORD_ID);
          registered++;
          log(`  Registered: ${p.name}`);
          await sleep(200); // Airtable rate limit: 5 req/s
        } catch (err) {
          errors++;
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(`  Failed to register ${p.name}: ${errMsg}`);
        }
      }

      log(`Registered ${registered} new product(s), ${errors} error(s)`);
    } else {
      log('DRY RUN: Skipping Airtable registration');
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('========================================');
  log('Discovery Summary');
  log('========================================');
  log(`Series pages crawled: ${uniqueProducts.size > 0 ? 'yes' : 'no'}`);
  log(`Total products on site: ${uniqueProducts.size}`);
  log(`Already in Airtable: ${existingUrls.size}`);
  log(`Skipped (parts/accessories): ${skippedByKeyword}`);
  log(`New products found: ${newProducts.length}`);
  log(`Elapsed time: ${elapsed}s`);
  log('========================================');
}

// Run
main().catch((err) => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
