// scripts/register-evergreen-urls.ts
// One-time script to register all EVERGREEN INTERNATIONAL product URLs in Airtable.
// Crawls 9 lure category pages (Bass Combat/Mode/Fact, Salt, Trout),
// extracts product links, deduplicates, and registers them with status '未処理'.
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/_deprecated/register-evergreen-urls.ts              # normal run
//   npx tsx scripts/_deprecated/register-evergreen-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EVERGREEN_BASE_URL = 'https://www.evergreen-fishing.com';

// 9 lure category pages
const CATEGORY_URLS: Array<{ url: string; label: string }> = [
  // Bass
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=29&vctt_no=1&g_no=4&r=2&s_no=29`, label: 'Bass Combat' },
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=31&vctt_no=1&g_no=4&r=2&s_no=31`, label: 'Bass Mode' },
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=57&vctt_no=1&g_no=4&r=2&s_no=57`, label: 'Bass Fact' },
  // Salt
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=24&vctt_no=2&g_no=4&r=2&s_no=24`, label: 'Salt Jigging' },
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=26&vctt_no=2&g_no=4&r=2&s_no=26`, label: 'Salt Egging' },
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=25&vctt_no=2&g_no=4&r=2&s_no=25`, label: 'Salt SeaBass' },
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=27&vctt_no=2&g_no=4&r=2&s_no=27`, label: 'Salt LightGame' },
  // Trout
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=77&vctt_no=30&r=2&g_no=4&s_no=77`, label: 'Trout Area' },
  { url: `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=78&vctt_no=30&r=2&g_no=4&s_no=78`, label: 'Trout Native' },
];

// Product names to exclude (parts, hooks, accessories — NOT worms/soft baits)
const EXCLUDED_NAME_KEYWORDS = [
  'フック',
  'パーツ',
  'リペアキット',
];

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const PAGE_LOAD_DELAY_MS = 2000;
const DRY_RUN = process.argv.includes('--dry-run');

// Airtable batch create supports up to 10 records at a time
const AIRTABLE_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [register-evergreen] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-evergreen] ERROR: ${message}`);
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
 * Fetch the EVERGREEN maker record ID from Airtable.
 * If not found, creates it.
 */
async function fetchOrCreateEvergreenRecordId(): Promise<string> {
  // Try to find existing record
  const filter = encodeURIComponent("{Slug}='evergreen'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing EVERGREEN maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  // Create new maker record
  log('EVERGREEN maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create EVERGREEN maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'EVERGREEN INTERNATIONAL',
        'Slug': 'evergreen',
      },
    }),
  });

  log(`Created EVERGREEN maker record: ${created.id}`);
  return created.id;
}

/**
 * Batch-create records in Airtable (up to 10 at a time).
 */
async function createAirtableRecords(
  records: Array<{ name: string; url: string }>,
  makerId: string,
): Promise<{ registered: number; errors: number }> {
  let registered = 0;
  let errors = 0;
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const batch = records.slice(i, i + AIRTABLE_BATCH_SIZE);

    try {
      await airtableFetch(
        AIRTABLE_LURE_URL_TABLE_ID,
        '',
        {
          method: 'POST',
          body: JSON.stringify({
            records: batch.map(r => ({
              fields: {
                'ルアー名': r.name,
                'URL': r.url,
                'メーカー': [makerId],
                'ステータス': '未処理',
                '備考': `初回一括登録 (${today})`,
              },
            })),
          }),
        },
      );
      registered += batch.length;
      log(`  Registered batch ${Math.floor(i / AIRTABLE_BATCH_SIZE) + 1}: ${batch.length} records`);
    } catch (err) {
      errors += batch.length;
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`  Batch ${Math.floor(i / AIRTABLE_BATCH_SIZE) + 1} failed: ${errMsg}`);
    }

    // Airtable rate limit: 5 req/s
    await sleep(250);
  }

  return { registered, errors };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  return url.trim();
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
  category: string;
}

/**
 * Crawl an EVERGREEN category page and extract all product URLs.
 * EVERGREEN uses static HTML with product links in format:
 *   /goods_list/ProductName.html
 */
async function discoverProducts(
  page: Page,
  categoryUrl: string,
  categoryLabel: string,
): Promise<DiscoveredProduct[]> {
  log(`Crawling ${categoryLabel}: ${categoryUrl}`);

  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  // Extract product URLs using page.evaluate for reliability
  const productData = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href]');
    const products: Array<{ url: string; text: string }> = [];

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      // Product detail pages: /goods_list/ProductName.html (NOT .php)
      if (href.includes('goods_list/') && href.endsWith('.html') && !href.includes('.php')) {
        const fullUrl = href.startsWith('http')
          ? href
          : window.location.origin + (href.startsWith('/') ? '' : '/') + href;

        // Try to get text from alt attribute of img or text content
        const img = link.querySelector('img');
        const text = img?.getAttribute('alt')?.trim() || link.textContent?.trim() || '';

        products.push({ url: fullUrl, text: text.substring(0, 100) });
      }
    }

    return products;
  });

  // Deduplicate by URL
  const seen = new Set<string>();
  const products: DiscoveredProduct[] = [];

  for (const p of productData) {
    const normalized = normalizeUrl(p.url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Extract name from URL if text is empty
    let name = p.text;
    if (!name) {
      const match = normalized.match(/\/goods_list\/([^/]+)\.html/i);
      name = match ? match[1] : '(名前取得失敗)';
    }

    products.push({
      url: normalized,
      name,
      category: categoryLabel,
    });
  }

  log(`  Found ${products.length} products in ${categoryLabel}`);
  return products;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('EVERGREEN URL Registration - Starting');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('========================================');

  const startTime = Date.now();

  // 1. Get or create EVERGREEN maker record
  const evergreenMakerId = await fetchOrCreateEvergreenRecordId();
  log(`EVERGREEN maker record ID: ${evergreenMakerId}`);

  // 2. Get existing URLs from Airtable
  const existingUrls = await fetchExistingAirtableUrls();

  // 3. Launch browser and discover products
  log('Launching browser...');
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  let allProducts: DiscoveredProduct[] = [];

  try {
    for (const category of CATEGORY_URLS) {
      try {
        const products = await discoverProducts(page, category.url, category.label);
        allProducts.push(...products);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`Failed to crawl ${category.label}: ${errMsg}`);
      }
      await sleep(PAGE_LOAD_DELAY_MS);
    }
  } finally {
    await browser.close();
    log('Browser closed');
  }

  // 4. Deduplicate (same product can appear in multiple categories)
  const uniqueProducts = new Map<string, DiscoveredProduct>();
  for (const p of allProducts) {
    if (!uniqueProducts.has(p.url)) {
      uniqueProducts.set(p.url, p);
    }
  }
  log(`Total unique products discovered: ${uniqueProducts.size}`);

  // 5. Filter out already-registered and excluded products
  const newProducts: DiscoveredProduct[] = [];
  let skippedExisting = 0;
  let skippedByKeyword = 0;

  for (const [, product] of uniqueProducts) {
    if (existingUrls.has(product.url)) {
      skippedExisting++;
      continue;
    }

    // Check name keywords
    const isExcludedByName = EXCLUDED_NAME_KEYWORDS.some(kw =>
      product.name.toUpperCase().includes(kw.toUpperCase()),
    );
    if (isExcludedByName) {
      log(`  Skipping (excluded keyword): ${product.name}`);
      skippedByKeyword++;
      continue;
    }

    newProducts.push(product);
  }

  log(`New products to register: ${newProducts.length}`);

  // 6. Display all products grouped by category
  if (newProducts.length > 0) {
    log('--- New Products ---');

    // Group by category
    const grouped = new Map<string, DiscoveredProduct[]>();
    for (const p of newProducts) {
      const group = grouped.get(p.category) || [];
      group.push(p);
      grouped.set(p.category, group);
    }

    for (const [category, products] of grouped) {
      log(`\n  [${category}: ${products.length}]`);
      for (const p of products) {
        log(`    ${p.name}: ${p.url}`);
      }
    }

    // 7. Register in Airtable
    if (!DRY_RUN) {
      log('\nRegistering new products in Airtable...');
      const result = await createAirtableRecords(
        newProducts.map(p => ({ name: p.name, url: p.url })),
        evergreenMakerId,
      );
      log(`Registered: ${result.registered}, Errors: ${result.errors}`);
    } else {
      log('\nDRY RUN: Skipping Airtable registration');
    }
  } else {
    log('No new products to register.');
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('========================================');
  log('Registration Summary');
  log('========================================');
  log(`Category pages crawled: ${CATEGORY_URLS.length}`);
  log(`Total products on site: ${uniqueProducts.size}`);
  log(`Already in Airtable: ${skippedExisting}`);
  log(`Skipped (excluded): ${skippedByKeyword}`);
  log(`New products registered: ${newProducts.length}`);
  log(`Elapsed time: ${elapsed}s`);
  log('========================================');
}

// Run
main().catch((err) => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
