// scripts/discover-products.ts
// Discovers new products from multiple manufacturers by crawling their sites
// and comparing against existing Airtable records. New products are
// auto-registered in Airtable with status '未処理' so the nightly pipeline
// picks them up.
//
// Usage:
//   npx tsx scripts/discover-products.ts              # all manufacturers
//   npx tsx scripts/discover-products.ts --dry-run    # preview only, no writes
//   npx tsx scripts/discover-products.ts --maker blueblue   # single manufacturer
//   npx tsx scripts/discover-products.ts --maker megabass   # single manufacturer

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
  maker: string; // manufacturer slug
}

interface ManufacturerConfig {
  slug: string;
  name: string;
  discover: (page: Page) => Promise<Array<{ url: string; name: string }>>;
  excludedNameKeywords: string[];
  excludedUrlSlugs?: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const PAGE_LOAD_DELAY_MS = 2000;
const DRY_RUN = process.argv.includes('--dry-run');

// Parse --maker flag
const makerFlagIndex = process.argv.indexOf('--maker');
const MAKER_FILTER = makerFlagIndex >= 0 ? process.argv[makerFlagIndex + 1] : null;

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
// BlueBlue discovery logic
// ---------------------------------------------------------------------------

const BLUEBLUE_BASE_URL = 'https://www.bluebluefishing.com';
const BLUEBLUE_ITEM_INDEX_URL = `${BLUEBLUE_BASE_URL}/item/`;
const BLUEBLUE_LURE_SERIES_PREFIXES = ['/item/series/001001/'];

async function discoverBlueBlue(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[blueblue] Discovering products...');

  // 1. Find all series pages
  await page.goto(BLUEBLUE_ITEM_INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const allLinks = await page.locator('a[href*="/item/series/"]').all();
  const seriesUrls: string[] = [];

  for (const link of allLinks) {
    const href = await link.getAttribute('href');
    if (!href) continue;
    const isLureCategory = BLUEBLUE_LURE_SERIES_PREFIXES.some(prefix => href.startsWith(prefix));
    if (!isLureCategory) continue;
    const fullUrl = href.startsWith('http') ? href : `${BLUEBLUE_BASE_URL}${href}`;
    seriesUrls.push(fullUrl);
  }

  const uniqueSeries = [...new Set(seriesUrls)];
  log(`[blueblue] Found ${uniqueSeries.length} lure series pages`);

  // 2. Crawl each series page for product detail URLs
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < uniqueSeries.length; i++) {
    const seriesUrl = uniqueSeries[i];
    log(`[blueblue] Crawling series ${i + 1}/${uniqueSeries.length}: ${seriesUrl}`);

    try {
      await page.goto(seriesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      const detailLinks = await page.locator('a[href*="/item/detail/"]').all();

      for (const link of detailLinks) {
        const href = await link.getAttribute('href');
        if (!href) continue;

        const fullUrl = href.startsWith('http') ? href : `${BLUEBLUE_BASE_URL}${href}`;
        const normalized = normalizeUrl(fullUrl);

        if (seen.has(normalized)) continue;
        seen.add(normalized);

        let name = (await link.textContent())?.trim() || '';
        if (!name) {
          const parent = link.locator('..');
          name = (await parent.textContent())?.trim() || '';
        }
        name = name.split('\n')[0].trim().substring(0, 100);

        products.push({ url: normalized, name: name || '(名前取得失敗)' });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[blueblue] Failed to crawl series ${seriesUrl}: ${errMsg}`);
    }

    if (i < uniqueSeries.length - 1) await sleep(PAGE_LOAD_DELAY_MS);
  }

  log(`[blueblue] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// Megabass discovery logic
// ---------------------------------------------------------------------------

const MEGABASS_BASE_URL = 'https://www.megabass.co.jp';
const MEGABASS_CATEGORY_URLS = [
  `${MEGABASS_BASE_URL}/site/freshwater/bass_lure/`,
  `${MEGABASS_BASE_URL}/site/saltwater/sw_lure/`,
];

async function discoverMegabass(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[megabass] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const categoryUrl of MEGABASS_CATEGORY_URLS) {
    const category = categoryUrl.includes('freshwater') ? 'bass' : 'saltwater';
    log(`[megabass] Crawling ${category} category: ${categoryUrl}`);

    try {
      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      const productLinks = await page.locator('a[href*="/site/products/"]').all();

      for (const link of productLinks) {
        const href = await link.getAttribute('href');
        if (!href) continue;

        // Skip excluded path keywords
        if (['lure_parts', 'soft_bait', 'softbait'].some(kw => href.toLowerCase().includes(kw))) {
          continue;
        }

        const fullUrl = href.startsWith('http')
          ? href
          : `${MEGABASS_BASE_URL}${href}`;
        const normalized = normalizeUrl(fullUrl);

        if (seen.has(normalized)) continue;
        seen.add(normalized);

        // Extract product name
        let name = '';
        try {
          name = (await link.textContent())?.trim() || '';
          if (!name) {
            const img = link.locator('img').first();
            name = (await img.getAttribute('alt'))?.trim() || '';
          }
        } catch {
          // ignore
        }
        name = name.split('\n')[0].trim().substring(0, 100);

        // Fallback: extract name from URL slug
        if (!name) {
          const match = href.match(/\/products\/([^/]+)/);
          name = match ? match[1].replace(/_/g, ' ').toUpperCase() : '(名前取得失敗)';
        }

        products.push({ url: normalized, name });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[megabass] Failed to crawl ${categoryUrl}: ${errMsg}`);
    }

    await sleep(PAGE_LOAD_DELAY_MS);
  }

  log(`[megabass] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// Daiwa discovery logic
// ---------------------------------------------------------------------------

const DAIWA_BASE_URL = 'https://www.daiwa.com';
const DAIWA_LURE_LIST_URL = `${DAIWA_BASE_URL}/jp/product/productlist?category1=ルアー`;
const DAIWA_MAX_PAGES = 15;

async function discoverDaiwa(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[daiwa] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (let pageNum = 1; pageNum <= DAIWA_MAX_PAGES; pageNum++) {
    const listUrl = pageNum === 1
      ? DAIWA_LURE_LIST_URL
      : `${DAIWA_LURE_LIST_URL}&page=${pageNum}`;

    log(`[daiwa] Crawling listing page ${pageNum}: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    // Extract product links via page.evaluate for speed
    const pageProducts = await page.evaluate(() => {
      const results: { url: string; name: string }[] = [];
      const links = document.querySelectorAll('a[href*="/jp/product/"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        if (href.includes('productlist')) return;
        if (href.includes('category')) return;
        const text = link.textContent?.trim() || '';
        const name = text.split('\n')[0].trim().substring(0, 100);
        results.push({ url: href, name: name || '(名前取得失敗)' });
      });
      return results;
    });

    if (pageProducts.length === 0) {
      log(`[daiwa]   No products found on page ${pageNum} — stopping pagination`);
      break;
    }

    let newOnThisPage = 0;
    for (const p of pageProducts) {
      const fullUrl = p.url.startsWith('http') ? p.url : `${DAIWA_BASE_URL}${p.url}`;
      // Remove trailing slash for Daiwa URLs
      const normalized = fullUrl.endsWith('/') ? fullUrl.slice(0, -1) : fullUrl;

      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
      newOnThisPage++;
    }

    log(`[daiwa]   Found ${pageProducts.length} links, ${newOnThisPage} new unique products`);

    // Check if there's a next page
    const hasNextPage = await page.evaluate(() => {
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
      log(`[daiwa]   No next page found — stopping pagination at page ${pageNum}`);
      break;
    }
  }

  log(`[daiwa] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// Manufacturer registry
// ---------------------------------------------------------------------------

const MANUFACTURERS: ManufacturerConfig[] = [
  {
    slug: 'blueblue',
    name: 'BlueBlue',
    discover: discoverBlueBlue,
    excludedNameKeywords: ['ジグヘッド', 'ワーム', '交換用', 'パワーヘッド', 'フック'],
  },
  {
    slug: 'megabass',
    name: 'Megabass',
    discover: discoverMegabass,
    excludedNameKeywords: [
      'ワーム', 'WORM', 'ソフトベイト', 'SOFT BAIT',
      'SPARE PARTS', 'SPARE TAIL', 'HOOK', '鬼手仏針',
    ],
    excludedUrlSlugs: [
      'outbarb_hook', 'tinsel-hook', 'teaser-hook',
      'slowl_feather_hook', 'katsuage-hook', 'buddha_hook',
      'i-wing135_spare_parts_kit', 'i-slide187r_spare_tail',
      'makippa_blade_hook', 'makippa_double_assist_hook',
      'bottom_slash_plus_head', 'bottom_slash_plus_starter_set',
      'mag-draft_head', 'okashira_screw', 'okashira_head', 'okashira_head_hg',
    ],
  },
  {
    slug: 'daiwa',
    name: 'DAIWA',
    discover: discoverDaiwa,
    excludedNameKeywords: ['ワーム', 'WORM', 'ソフトルアー', 'SOFT LURE'],
  },
  // Future manufacturers:
  // { slug: 'shimano', name: 'SHIMANO', discover: discoverShimano, excludedNameKeywords: [] },
];

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
 * Fetch a maker record ID from Airtable by slug.
 */
async function fetchMakerRecordId(slug: string): Promise<string> {
  const filter = encodeURIComponent(`{Slug}='${slug}'`);
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length === 0) {
    throw new Error(`Maker record not found in Airtable for slug: ${slug}`);
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
 * Normalize a URL to a canonical form for comparison.
 * Strips trailing slash for consistent matching across manufacturers.
 * Ensures www prefix for BlueBlue.
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();
  // Ensure www prefix for BlueBlue
  normalized = normalized.replace(
    'https://bluebluefishing.com',
    'https://www.bluebluefishing.com',
  );
  // Strip trailing slash for consistent comparison
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('Product Discovery - Starting');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  if (MAKER_FILTER) log(`Manufacturer filter: ${MAKER_FILTER}`);
  log('========================================');

  const startTime = Date.now();

  // Determine which manufacturers to process
  const manufacturers = MAKER_FILTER
    ? MANUFACTURERS.filter(m => m.slug === MAKER_FILTER)
    : MANUFACTURERS;

  if (manufacturers.length === 0) {
    logError(`Unknown manufacturer: ${MAKER_FILTER}. Available: ${MANUFACTURERS.map(m => m.slug).join(', ')}`);
    process.exit(1);
  }

  // 1. Get maker record IDs
  const makerRecordIds = new Map<string, string>();
  for (const mfg of manufacturers) {
    try {
      const id = await fetchMakerRecordId(mfg.slug);
      makerRecordIds.set(mfg.slug, id);
      log(`${mfg.name} maker record ID: ${id}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`Failed to get maker record for ${mfg.name}: ${errMsg}`);
    }
  }

  // 2. Get existing URLs from Airtable
  const existingUrls = await fetchExistingAirtableUrls();

  // 3. Launch browser and discover products for each manufacturer
  log('Launching browser...');
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  const allNewProducts: DiscoveredProduct[] = [];
  const summaryByMaker: Record<string, { discovered: number; new: number; skipped: number }> = {};

  try {
    for (const mfg of manufacturers) {
      if (!makerRecordIds.has(mfg.slug)) {
        logError(`Skipping ${mfg.name} — no maker record ID`);
        continue;
      }

      log(`\n--- ${mfg.name} ---`);
      let discovered: Array<{ url: string; name: string }> = [];

      try {
        discovered = await mfg.discover(page);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`Failed to discover products for ${mfg.name}: ${errMsg}`);
        continue;
      }

      // Deduplicate
      const uniqueProducts = new Map<string, string>();
      for (const p of discovered) {
        if (!uniqueProducts.has(p.url)) {
          uniqueProducts.set(p.url, p.name);
        }
      }

      // Filter
      let skipped = 0;
      const newProducts: DiscoveredProduct[] = [];

      for (const [url, name] of uniqueProducts) {
        if (existingUrls.has(url)) continue;

        // Check name keywords
        const isExcludedByName = mfg.excludedNameKeywords.some(kw =>
          name.toUpperCase().includes(kw.toUpperCase()),
        );
        if (isExcludedByName) {
          log(`  Skipping (excluded keyword): ${name}`);
          skipped++;
          continue;
        }

        // Check URL slugs (if configured)
        if (mfg.excludedUrlSlugs) {
          const isExcludedBySlug = mfg.excludedUrlSlugs.some(slug =>
            url.includes(`/products/${slug}`),
          );
          if (isExcludedBySlug) {
            log(`  Skipping (excluded slug): ${name}`);
            skipped++;
            continue;
          }
        }

        newProducts.push({ url, name, maker: mfg.slug });
      }

      summaryByMaker[mfg.slug] = {
        discovered: uniqueProducts.size,
        new: newProducts.length,
        skipped,
      };

      allNewProducts.push(...newProducts);
      log(`[${mfg.slug}] ${uniqueProducts.size} on site, ${newProducts.length} new, ${skipped} excluded`);
    }
  } finally {
    await browser.close();
    log('Browser closed');
  }

  // 4. Register new products
  log(`\nTotal new products across all manufacturers: ${allNewProducts.length}`);

  if (allNewProducts.length === 0) {
    log('No new products to register. All caught up!');
  } else {
    log('--- New Products ---');
    for (const p of allNewProducts) {
      log(`  [${p.maker}] ${p.name}: ${p.url}`);
    }

    if (!DRY_RUN) {
      log('Registering new products in Airtable...');
      let registered = 0;
      let errors = 0;

      for (const p of allNewProducts) {
        const makerId = makerRecordIds.get(p.maker)!;
        try {
          await createAirtableRecord(p.name, p.url, makerId);
          registered++;
          log(`  Registered: [${p.maker}] ${p.name}`);
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
  for (const mfg of manufacturers) {
    const s = summaryByMaker[mfg.slug];
    if (s) {
      log(`[${mfg.slug}] On site: ${s.discovered}, New: ${s.new}, Excluded: ${s.skipped}`);
    }
  }
  log(`Already in Airtable: ${existingUrls.size}`);
  log(`Total new products: ${allNewProducts.length}`);
  log(`Elapsed time: ${elapsed}s`);
  log('========================================');
}

// Run
main().catch((err) => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
