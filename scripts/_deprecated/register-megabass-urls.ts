// scripts/register-megabass-urls.ts
// One-time script to register all Megabass product URLs in Airtable.
// Crawls both bass lure and saltwater lure category pages, extracts product
// links, deduplicates, and registers them with status '未処理'.
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-megabass-urls.ts              # normal run
//   npx tsx scripts/register-megabass-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MEGABASS_BASE_URL = 'https://www.megabass.co.jp';

const CATEGORY_URLS = [
  `${MEGABASS_BASE_URL}/site/freshwater/bass_lure/`,
  `${MEGABASS_BASE_URL}/site/saltwater/sw_lure/`,
];

// Subcategories to exclude (parts, soft baits/worms)
const EXCLUDED_PATH_KEYWORDS = [
  'lure_parts',
  'soft_bait',
  'softbait',
];

// Product names/URLs to exclude (parts, hooks, spare parts, accessories)
const EXCLUDED_NAME_KEYWORDS = [
  'ワーム',
  'WORM',
  'ソフトベイト',
  'SOFT BAIT',
  'SPARE PARTS',
  'SPARE TAIL',
  'HOOK',    // standalone hook products
  '鬼手仏針', // hook product
];

// URL slugs to exclude (more precise for hook/parts products)
const EXCLUDED_URL_SLUGS = [
  'outbarb_hook',
  'tinsel-hook',
  'teaser-hook',
  'slowl_feather_hook',
  'katsuage-hook',
  'buddha_hook',
  'i-wing135_spare_parts_kit',
  'i-slide187r_spare_tail',
  'makippa_blade_hook',
  'makippa_double_assist_hook',
  'bottom_slash_plus_head',
  'bottom_slash_plus_starter_set',
  'mag-draft_head',
  'okashira_screw',
  'okashira_head',
  'okashira_head_hg',
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
  console.log(`[${timestamp()}] [register-megabass] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-megabass] ERROR: ${message}`);
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
 * Fetch the Megabass maker record ID from Airtable.
 * If not found, creates it.
 */
async function fetchOrCreateMegabassRecordId(): Promise<string> {
  // Try to find existing record
  const filter = encodeURIComponent("{Slug}='megabass'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing Megabass maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  // Create new maker record
  log('Megabass maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create Megabass maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'Megabass',
        'Slug': 'megabass',
      },
    }),
  });

  log(`Created Megabass maker record: ${created.id}`);
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
  // Ensure trailing slash
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
  category: string; // 'bass' or 'saltwater'
}

/**
 * Crawl a Megabass category page and extract all product URLs.
 */
async function discoverProducts(
  page: Page,
  categoryUrl: string,
): Promise<DiscoveredProduct[]> {
  const category = categoryUrl.includes('freshwater') ? 'bass' : 'saltwater';
  log(`Crawling ${category} category: ${categoryUrl}`);

  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  // Find all product links
  const productLinks = await page.locator('a[href*="/site/products/"]').all();
  const products: DiscoveredProduct[] = [];
  const seen = new Set<string>();

  for (const link of productLinks) {
    const href = await link.getAttribute('href');
    if (!href) continue;

    // Check for excluded paths
    const isExcluded = EXCLUDED_PATH_KEYWORDS.some(kw =>
      href.toLowerCase().includes(kw),
    );
    if (isExcluded) continue;

    const fullUrl = href.startsWith('http')
      ? href
      : `${MEGABASS_BASE_URL}${href}`;
    const normalized = normalizeUrl(fullUrl);

    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Extract product name from link text
    let name = '';
    try {
      // First try to get text directly
      name = (await link.textContent())?.trim() || '';
      // If empty, try to get from img alt
      if (!name) {
        const img = link.locator('img').first();
        name = (await img.getAttribute('alt'))?.trim() || '';
      }
    } catch {
      // ignore
    }

    // Clean up name
    name = name.split('\n')[0].trim().substring(0, 100);

    // Fallback: extract name from URL slug
    if (!name) {
      const match = href.match(/\/products\/([^/]+)/);
      name = match ? match[1].replace(/_/g, ' ').toUpperCase() : '(名前取得失敗)';
    }

    products.push({ url: normalized, name, category });
  }

  log(`  Found ${products.length} products in ${category} category`);
  return products;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('Megabass URL Registration - Starting');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('========================================');

  const startTime = Date.now();

  // 1. Get or create Megabass maker record
  const megabassMakerId = await fetchOrCreateMegabassRecordId();
  log(`Megabass maker record ID: ${megabassMakerId}`);

  // 2. Get existing URLs from Airtable
  const existingUrls = await fetchExistingAirtableUrls();

  // 3. Launch browser and discover products
  log('Launching browser...');
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  let allProducts: DiscoveredProduct[] = [];

  try {
    for (const categoryUrl of CATEGORY_URLS) {
      try {
        const products = await discoverProducts(page, categoryUrl);
        allProducts.push(...products);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`Failed to crawl ${categoryUrl}: ${errMsg}`);
      }
      await sleep(PAGE_LOAD_DELAY_MS);
    }
  } finally {
    await browser.close();
    log('Browser closed');
  }

  // 4. Deduplicate (same product can appear in both categories)
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

    // Check URL slugs
    const isExcludedBySlug = EXCLUDED_URL_SLUGS.some(slug =>
      product.url.includes(`/products/${slug}`),
    );
    if (isExcludedBySlug) {
      log(`  Skipping (excluded slug): ${product.name} [${product.url}]`);
      skippedByKeyword++;
      continue;
    }

    newProducts.push(product);
  }

  log(`New products to register: ${newProducts.length}`);

  // 6. Display all products
  if (newProducts.length > 0) {
    log('--- New Products ---');
    const bassProducts = newProducts.filter(p => p.category === 'bass');
    const swProducts = newProducts.filter(p => p.category === 'saltwater');

    if (bassProducts.length > 0) {
      log(`\n  [Bass Lures: ${bassProducts.length}]`);
      for (const p of bassProducts) {
        log(`    ${p.name}: ${p.url}`);
      }
    }

    if (swProducts.length > 0) {
      log(`\n  [Saltwater Lures: ${swProducts.length}]`);
      for (const p of swProducts) {
        log(`    ${p.name}: ${p.url}`);
      }
    }

    // 7. Register in Airtable
    if (!DRY_RUN) {
      log('\nRegistering new products in Airtable...');
      const result = await createAirtableRecords(
        newProducts.map(p => ({ name: p.name, url: p.url })),
        megabassMakerId,
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
