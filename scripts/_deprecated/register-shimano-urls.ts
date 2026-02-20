// scripts/register-shimano-urls.ts
// One-time script to register all Shimano lure product URLs in Airtable.
// Crawls all sub-category pages with pagination, extracts product links,
// deduplicates, and registers them with status '未処理'.
//
// IMPORTANT: Shimano's WAF blocks headless browsers.
// This script MUST use headless: false (requires GUI display session).
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-shimano-urls.ts              # normal run
//   npx tsx scripts/register-shimano-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SHIMANO_BASE_URL = 'https://fish.shimano.com';

// All sub-category URLs for Shimano lures (from site investigation)
const SHIMANO_SUBCATEGORY_URLS = [
  // シーバス
  '/ja-JP/product/lure/seabass/minnow.html',
  '/ja-JP/product/lure/seabass/sinkingpencil.html',
  '/ja-JP/product/lure/seabass/topwater.html',
  '/ja-JP/product/lure/seabass/vibration_blade.html',
  '/ja-JP/product/lure/seabass/bigbait_jointbait.html',
  // サーフ
  '/ja-JP/product/lure/surf/minnow.html',
  '/ja-JP/product/lure/surf/sinkingpencil.html',
  '/ja-JP/product/lure/surf/topwater.html',
  '/ja-JP/product/lure/surf/vibration_blade.html',
  '/ja-JP/product/lure/surf/bigbait_jointbait.html',
  '/ja-JP/product/lure/surf/jig_spoon.html',
  '/ja-JP/product/lure/surf/worm_jighead.html',
  // ロックショア他
  '/ja-JP/product/lure/rockyshore_etc/jig.html',
  '/ja-JP/product/lure/rockyshore_etc/vibration_blade.html',
  '/ja-JP/product/lure/rockyshore_etc/topwater.html',
  '/ja-JP/product/lure/rockyshore_etc/minnow.html',
  '/ja-JP/product/lure/rockyshore_etc/sinkingpencil.html',
  // ショアエギング
  '/ja-JP/product/lure/shoreeging/egi.html',
  // ボートエギング
  '/ja-JP/product/lure/boateging/egi_dropper.html',
  '/ja-JP/product/lure/boateging/sutte.html',
  // タコ
  '/ja-JP/product/lure/tako/egi.html',
  '/ja-JP/product/lure/tako/sutte.html',
  '/ja-JP/product/lure/tako/others.html',
  // チヌ
  '/ja-JP/product/lure/bream/topwater.html',
  '/ja-JP/product/lure/bream/minnow.html',
  // ライトゲーム
  '/ja-JP/product/lure/lightgame/worm_jighead.html',
  '/ja-JP/product/lure/lightgame/float.html',
  '/ja-JP/product/lure/lightgame/minnow.html',
  '/ja-JP/product/lure/lightgame/jig_vibration_blade.html',
  '/ja-JP/product/lure/lightgame/sinkingpencil.html',
  // オフショアキャスティング
  '/ja-JP/product/lure/offshorecasting/topwater.html',
  '/ja-JP/product/lure/offshorecasting/minnow.html',
  '/ja-JP/product/lure/offshorecasting/jointbait.html',
  '/ja-JP/product/lure/offshorecasting/sinkingpencil.html',
  '/ja-JP/product/lure/offshorecasting/others.html',
  // オフショアジギング
  '/ja-JP/product/lure/offshorejigging/jig.html',
  '/ja-JP/product/lure/offshorejigging/blade.html',
  '/ja-JP/product/lure/offshorejigging/others.html',
  // タイラバ他
  '/ja-JP/product/lure/tairubber_etc/tairubber.html',
  '/ja-JP/product/lure/tairubber_etc/parts.html',
  // タチウオ
  '/ja-JP/product/lure/tachiuo/tenya.html',
  // バス
  '/ja-JP/product/lure/bass/topwater.html',
  '/ja-JP/product/lure/bass/minnow_shad.html',
  '/ja-JP/product/lure/bass/i-motion.html',
  '/ja-JP/product/lure/bass/crankbait.html',
  '/ja-JP/product/lure/bass/bigbait_jointbait.html',
  '/ja-JP/product/lure/bass/vibration_spintail.html',
  '/ja-JP/product/lure/bass/spinnerbait_rubberjig.html',
  // ネイティブトラウト
  '/ja-JP/product/lure/nativetrout/minnow.html',
  '/ja-JP/product/lure/nativetrout/jigminnow_sinkingpencil.html',
  // エリアトラウト
  '/ja-JP/product/lure/areatrout/spoon.html',
  '/ja-JP/product/lure/areatrout/crankbait.html',
  '/ja-JP/product/lure/areatrout/minnow.html',
];

// Sub-categories to exclude entirely (parts, not actual lures)
const EXCLUDED_SUBCATEGORIES = [
  '/tairubber_etc/parts.html',
];

// Max pages per sub-category (Shimano uses 12-item pagination)
const MAX_PAGES_PER_SUBCATEGORY = 10;

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const PAGE_LOAD_DELAY_MS = 3000; // Slightly longer for Shimano's dynamic content
const DRY_RUN = process.argv.includes('--dry-run');
const AIRTABLE_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [register-shimano] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-shimano] ERROR: ${message}`);
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

async function fetchOrCreateShimanoRecordId(): Promise<string> {
  const filter = encodeURIComponent("{Slug}='shimano'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing SHIMANO maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  // Create new maker record
  log('SHIMANO maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create SHIMANO maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'SHIMANO',
        'Slug': 'shimano',
      },
    }),
  });

  log(`Created SHIMANO maker record: ${created.id}`);
  return created.id;
}

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
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
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
 * Crawl a single sub-category page with pagination.
 * Shimano shows 12 items per page with numbered pagination.
 */
async function crawlSubCategory(
  page: Page,
  subCategoryPath: string,
): Promise<DiscoveredProduct[]> {
  const products: DiscoveredProduct[] = [];
  const seenUrls = new Set<string>();

  // Extract category label from path for logging
  const pathParts = subCategoryPath.split('/').filter(Boolean);
  const category = pathParts.slice(-2).join('/').replace('.html', '');

  for (let pageNum = 1; pageNum <= MAX_PAGES_PER_SUBCATEGORY; pageNum++) {
    const pageUrl = pageNum === 1
      ? `${SHIMANO_BASE_URL}${subCategoryPath}`
      : `${SHIMANO_BASE_URL}${subCategoryPath}?page=${pageNum}`;

    log(`  [${category}] Page ${pageNum}: ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    // Check for WAF block
    const title = await page.title().catch(() => '');
    if (title.includes('Access Denied') || title.includes('403')) {
      logError(`  WAF blocked: ${pageUrl}`);
      break;
    }

    // Extract product links
    const pageProducts = await page.evaluate((basePath: string) => {
      const results: { url: string; name: string }[] = [];

      // Shimano product cards have links with href containing the sub-category + salesforce ID
      // Pattern: /ja-JP/product/lure/{category}/{subcategory}/{id}.html
      const links = document.querySelectorAll('a[href*="/product/lure/"]');

      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

        // Must be a detail page (has .html extension and deeper path than category)
        const segments = href.split('/').filter(Boolean);
        if (segments.length < 6) return; // Not deep enough to be a product page
        if (!href.endsWith('.html')) return;

        // Skip if it's a category/sub-category page (no salesforce ID pattern)
        const lastSegment = segments[segments.length - 1].replace('.html', '');
        if (!lastSegment || lastSegment.length < 10) return; // Salesforce IDs are ~18 chars

        // Get product name
        let name = '';
        // Try card title element
        const nameEl = link.querySelector('[class*="name"], [class*="title"], h2, h3, h4');
        if (nameEl) {
          name = nameEl.textContent?.trim() || '';
        }
        if (!name) {
          name = link.textContent?.trim().split('\n')[0].trim() || '';
        }

        // Trim name to reasonable length
        name = name.substring(0, 100);

        results.push({ url: href, name: name || '(名前取得失敗)' });
      });

      return results;
    }, subCategoryPath);

    if (pageProducts.length === 0) {
      if (pageNum === 1) {
        log(`  [${category}] No products found on first page`);
      }
      break;
    }

    let newOnThisPage = 0;
    for (const p of pageProducts) {
      const fullUrl = p.url.startsWith('http')
        ? p.url
        : `${SHIMANO_BASE_URL}${p.url}`;
      const normalized = normalizeUrl(fullUrl);

      if (seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);

      products.push({
        url: normalized,
        name: p.name,
        category,
      });
      newOnThisPage++;
    }

    log(`  [${category}] Page ${pageNum}: ${pageProducts.length} links, ${newOnThisPage} new`);

    // If no new products found on this page, all remaining pages are duplicates — stop
    if (newOnThisPage === 0 && pageNum > 1) {
      break;
    }

    // Check for next page
    const hasNextPage = await page.evaluate((currentPage: number) => {
      // Look for pagination links
      const pageLinks = document.querySelectorAll('a[href*="page="]');
      let hasNext = false;
      pageLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const pageMatch = href.match(/page=(\d+)/);
        if (pageMatch) {
          const linkPage = parseInt(pageMatch[1]);
          if (linkPage > currentPage) hasNext = true;
        }
      });

      // Also check for "NEXT" or "次へ" button
      const nextBtn = document.querySelector('[class*="next"]:not(.disabled), a:has(> [class*="next"])');
      if (nextBtn) hasNext = true;

      return hasNext;
    }, pageNum);

    if (!hasNextPage) {
      break;
    }
  }

  return products;
}

/**
 * Crawl all Shimano sub-categories and discover all products.
 */
async function discoverAllProducts(page: Page): Promise<DiscoveredProduct[]> {
  const allProducts: DiscoveredProduct[] = [];
  const globalSeenUrls = new Set<string>();

  // Filter out excluded sub-categories
  const activeSubCategories = SHIMANO_SUBCATEGORY_URLS.filter(url =>
    !EXCLUDED_SUBCATEGORIES.some(excluded => url.includes(excluded)),
  );

  log(`Crawling ${activeSubCategories.length} sub-categories...`);

  for (let i = 0; i < activeSubCategories.length; i++) {
    const subCatUrl = activeSubCategories[i];
    log(`\nSub-category ${i + 1}/${activeSubCategories.length}: ${subCatUrl}`);

    try {
      const products = await crawlSubCategory(page, subCatUrl);

      let newCount = 0;
      for (const p of products) {
        if (!globalSeenUrls.has(p.url)) {
          globalSeenUrls.add(p.url);
          allProducts.push(p);
          newCount++;
        }
      }

      log(`  Total from this sub-category: ${products.length} (${newCount} new unique)`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`  Failed to crawl ${subCatUrl}: ${errMsg}`);
    }

    // Wait between sub-categories to avoid WAF rate limiting
    if (i < activeSubCategories.length - 1) {
      await sleep(2000);
    }
  }

  return allProducts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('SHIMANO URL Registration - Starting');
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  log('========================================');

  const startTime = Date.now();

  // 1. Get or create SHIMANO maker record
  const shimanoMakerId = await fetchOrCreateShimanoRecordId();
  log(`SHIMANO maker record ID: ${shimanoMakerId}`);

  // 2. Get existing URLs from Airtable
  const existingUrls = await fetchExistingAirtableUrls();

  // 3. Launch browser (headless: false required for Shimano WAF)
  log('Launching browser (headless: false for Shimano WAF)...');
  const browser: Browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page: Page = await context.newPage();

  let allProducts: DiscoveredProduct[] = [];

  try {
    allProducts = await discoverAllProducts(page);
  } finally {
    await browser.close();
    log('Browser closed');
  }

  log(`\nTotal unique products discovered: ${allProducts.length}`);

  // 4. Filter out already-registered products
  const newProducts: DiscoveredProduct[] = [];
  let skippedExisting = 0;

  for (const product of allProducts) {
    if (existingUrls.has(product.url)) {
      skippedExisting++;
      continue;
    }
    newProducts.push(product);
  }

  log(`New products to register: ${newProducts.length}`);

  // 5. Display all products
  if (newProducts.length > 0) {
    log('--- New Products ---');
    for (let i = 0; i < newProducts.length; i++) {
      log(`  ${i + 1}. [${newProducts[i].category}] ${newProducts[i].name}: ${newProducts[i].url}`);
    }

    // 6. Register in Airtable
    if (!DRY_RUN) {
      log('\nRegistering new products in Airtable...');
      const result = await createAirtableRecords(
        newProducts.map(p => ({ name: p.name, url: p.url })),
        shimanoMakerId,
      );
      log(`Registered: ${result.registered}, Errors: ${result.errors}`);
    } else {
      log('\nDRY RUN: Skipping Airtable registration');
    }
  } else {
    log('No new products to register.');
  }

  // 7. Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const p of allProducts) {
    categoryBreakdown[p.category] = (categoryBreakdown[p.category] || 0) + 1;
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('========================================');
  log('Registration Summary');
  log('========================================');
  log(`Sub-categories crawled: ${SHIMANO_SUBCATEGORY_URLS.length}`);
  log(`Total products on site: ${allProducts.length}`);
  log(`Already in Airtable: ${skippedExisting}`);
  log(`New products registered: ${newProducts.length}`);
  log('--- Category Breakdown ---');
  for (const [cat, count] of Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1])) {
    log(`  ${cat}: ${count}`);
  }
  log(`Elapsed time: ${elapsed}s`);
  log('========================================');
}

// Run
main().catch((err) => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
