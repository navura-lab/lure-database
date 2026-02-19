// scripts/register-daiwa-urls.ts
// One-time script to register all Daiwa lure product URLs in Airtable.
// Crawls Daiwa's product listing pages with pagination, extracts product
// links, deduplicates, and registers them with status '未処理'.
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-daiwa-urls.ts              # normal run
//   npx tsx scripts/register-daiwa-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DAIWA_BASE_URL = 'https://www.daiwa.com';

// Daiwa's lure listing page (paginated: page=1, page=2, ...)
const LURE_LIST_URL = `${DAIWA_BASE_URL}/jp/product/productlist?category1=ルアー`;

// Max pages to crawl (safety limit)
const MAX_PAGES = 15;

// Products whose name/URL contain these keywords are excluded (non-lure products)
const EXCLUDED_NAME_KEYWORDS = [
  'ワーム',
  'WORM',
  'ソフトルアー',
  'SOFT LURE',
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
  console.log(`[${timestamp()}] [register-daiwa] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-daiwa] ERROR: ${message}`);
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
 * Fetch the Daiwa maker record ID from Airtable.
 * If not found, creates it.
 */
async function fetchOrCreateDaiwaRecordId(): Promise<string> {
  // Try to find existing record
  const filter = encodeURIComponent("{Slug}='daiwa'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing DAIWA maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  // Create new maker record
  log('DAIWA maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create DAIWA maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'DAIWA',
        'Slug': 'daiwa',
      },
    }),
  });

  log(`Created DAIWA maker record: ${created.id}`);
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
  let normalized = url.trim();
  // Remove trailing slash for Daiwa URLs (they don't use trailing slashes)
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
}

/**
 * Crawl all pages of Daiwa's lure listing and extract product URLs.
 * The listing page has pagination with "次のページ" link or page=N parameter.
 */
async function discoverAllProducts(page: Page): Promise<DiscoveredProduct[]> {
  const allProducts: DiscoveredProduct[] = [];
  const seenUrls = new Set<string>();

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const listUrl = pageNum === 1
      ? LURE_LIST_URL
      : `${LURE_LIST_URL}&page=${pageNum}`;

    log(`Crawling listing page ${pageNum}: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    // Extract product links via page.evaluate for speed
    const products = await page.evaluate(() => {
      const results: { url: string; name: string }[] = [];

      // Daiwa listing: each product card has <a href="/jp/product/{hash}">
      // with product name in the card text
      const links = document.querySelectorAll('a[href*="/jp/product/"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

        // Skip non-product links (productlist, etc.)
        if (href.includes('productlist')) return;
        if (href.includes('category')) return;

        // Get product name from card text
        const text = link.textContent?.trim() || '';
        const name = text.split('\n')[0].trim().substring(0, 100);

        results.push({
          url: href,
          name: name || '(名前取得失敗)',
        });
      });

      return results;
    });

    if (products.length === 0) {
      log(`  No products found on page ${pageNum} — stopping pagination`);
      break;
    }

    let newOnThisPage = 0;
    for (const p of products) {
      const fullUrl = p.url.startsWith('http')
        ? p.url
        : `${DAIWA_BASE_URL}${p.url}`;
      const normalized = normalizeUrl(fullUrl);

      if (seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);

      allProducts.push({
        url: normalized,
        name: p.name,
      });
      newOnThisPage++;
    }

    log(`  Found ${products.length} links, ${newOnThisPage} new unique products`);

    // Check if there's a next page
    const hasNextPage = await page.evaluate(() => {
      // Look for pagination "次のページ" or ">" link
      const nextLinks = document.querySelectorAll('a[href*="page="]');
      const currentPageMatch = window.location.search.match(/page=(\d+)/);
      const currentPage = currentPageMatch ? parseInt(currentPageMatch[1]) : 1;
      let hasNext = false;
      nextLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const pageMatch = href.match(/page=(\d+)/);
        if (pageMatch) {
          const linkPage = parseInt(pageMatch[1]);
          if (linkPage > currentPage) hasNext = true;
        }
      });
      return hasNext;
    });

    if (!hasNextPage) {
      log(`  No next page found — stopping pagination at page ${pageNum}`);
      break;
    }
  }

  return allProducts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('DAIWA URL Registration - Starting');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('========================================');

  const startTime = Date.now();

  // 1. Get or create DAIWA maker record
  const daiwaMakerId = await fetchOrCreateDaiwaRecordId();
  log(`DAIWA maker record ID: ${daiwaMakerId}`);

  // 2. Get existing URLs from Airtable
  const existingUrls = await fetchExistingAirtableUrls();

  // 3. Launch browser and discover products
  log('Launching browser...');
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page: Page = await context.newPage();

  let allProducts: DiscoveredProduct[] = [];

  try {
    allProducts = await discoverAllProducts(page);
  } finally {
    await browser.close();
    log('Browser closed');
  }

  log(`Total unique products discovered: ${allProducts.length}`);

  // 4. Filter out already-registered and excluded products
  const newProducts: DiscoveredProduct[] = [];
  let skippedExisting = 0;
  let skippedByKeyword = 0;

  for (const product of allProducts) {
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

  // 5. Display all products
  if (newProducts.length > 0) {
    log('--- New Products ---');
    for (let i = 0; i < newProducts.length; i++) {
      log(`  ${i + 1}. ${newProducts[i].name}: ${newProducts[i].url}`);
    }

    // 6. Register in Airtable
    if (!DRY_RUN) {
      log('\nRegistering new products in Airtable...');
      const result = await createAirtableRecords(
        newProducts.map(p => ({ name: p.name, url: p.url })),
        daiwaMakerId,
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
  log(`Listing pages crawled: auto-paginated`);
  log(`Total products on site: ${allProducts.length}`);
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
