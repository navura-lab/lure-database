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
  /** If true, launches a separate headed (headless: false) browser with custom UA.
   *  Required for sites with strict WAF (e.g. Shimano's Akamai). */
  requiresHeadedBrowser?: boolean;
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
// Shimano discovery logic
// ---------------------------------------------------------------------------

const SHIMANO_BASE_URL = 'https://fish.shimano.com';

// All Shimano lure sub-category URLs
const SHIMANO_SUBCATEGORY_URLS = [
  '/ja-JP/product/lure/seabass/minnow.html',
  '/ja-JP/product/lure/seabass/sinkingpencil.html',
  '/ja-JP/product/lure/seabass/topwater.html',
  '/ja-JP/product/lure/seabass/vibration_blade.html',
  '/ja-JP/product/lure/seabass/bigbait_jointbait.html',
  '/ja-JP/product/lure/surf/minnow.html',
  '/ja-JP/product/lure/surf/sinkingpencil.html',
  '/ja-JP/product/lure/surf/topwater.html',
  '/ja-JP/product/lure/surf/vibration_blade.html',
  '/ja-JP/product/lure/surf/bigbait_jointbait.html',
  '/ja-JP/product/lure/surf/jig_spoon.html',
  '/ja-JP/product/lure/surf/worm_jighead.html',
  '/ja-JP/product/lure/rockyshore_etc/jig.html',
  '/ja-JP/product/lure/rockyshore_etc/vibration_blade.html',
  '/ja-JP/product/lure/rockyshore_etc/topwater.html',
  '/ja-JP/product/lure/rockyshore_etc/minnow.html',
  '/ja-JP/product/lure/rockyshore_etc/sinkingpencil.html',
  '/ja-JP/product/lure/shoreeging/egi.html',
  '/ja-JP/product/lure/boateging/egi_dropper.html',
  '/ja-JP/product/lure/boateging/sutte.html',
  '/ja-JP/product/lure/tako/egi.html',
  '/ja-JP/product/lure/tako/sutte.html',
  '/ja-JP/product/lure/tako/others.html',
  '/ja-JP/product/lure/bream/topwater.html',
  '/ja-JP/product/lure/bream/minnow.html',
  '/ja-JP/product/lure/lightgame/worm_jighead.html',
  '/ja-JP/product/lure/lightgame/float.html',
  '/ja-JP/product/lure/lightgame/minnow.html',
  '/ja-JP/product/lure/lightgame/jig_vibration_blade.html',
  '/ja-JP/product/lure/lightgame/sinkingpencil.html',
  '/ja-JP/product/lure/offshorecasting/topwater.html',
  '/ja-JP/product/lure/offshorecasting/minnow.html',
  '/ja-JP/product/lure/offshorecasting/jointbait.html',
  '/ja-JP/product/lure/offshorecasting/sinkingpencil.html',
  '/ja-JP/product/lure/offshorecasting/others.html',
  '/ja-JP/product/lure/offshorejigging/jig.html',
  '/ja-JP/product/lure/offshorejigging/blade.html',
  '/ja-JP/product/lure/offshorejigging/others.html',
  '/ja-JP/product/lure/tairubber_etc/tairubber.html',
  '/ja-JP/product/lure/tachiuo/tenya.html',
  '/ja-JP/product/lure/bass/topwater.html',
  '/ja-JP/product/lure/bass/minnow_shad.html',
  '/ja-JP/product/lure/bass/i-motion.html',
  '/ja-JP/product/lure/bass/crankbait.html',
  '/ja-JP/product/lure/bass/bigbait_jointbait.html',
  '/ja-JP/product/lure/bass/vibration_spintail.html',
  '/ja-JP/product/lure/bass/spinnerbait_rubberjig.html',
  '/ja-JP/product/lure/nativetrout/minnow.html',
  '/ja-JP/product/lure/nativetrout/jigminnow_sinkingpencil.html',
  '/ja-JP/product/lure/areatrout/spoon.html',
  '/ja-JP/product/lure/areatrout/crankbait.html',
  '/ja-JP/product/lure/areatrout/minnow.html',
];

async function discoverShimano(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[shimano] Discovering products...');
  // Shimano requires headless: false (WAF). The main function handles this
  // by launching a separate headed browser via requiresHeadedBrowser flag.
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < SHIMANO_SUBCATEGORY_URLS.length; i++) {
    const subCatPath = SHIMANO_SUBCATEGORY_URLS[i];

    for (let pageNum = 1; pageNum <= 10; pageNum++) {
      const pageUrl = pageNum === 1
        ? `${SHIMANO_BASE_URL}${subCatPath}`
        : `${SHIMANO_BASE_URL}${subCatPath}?page=${pageNum}`;

      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(PAGE_LOAD_DELAY_MS + 1000);

        // Check for WAF block
        const title = await page.title().catch(() => '');
        if (title.includes('Access Denied') || title.includes('403')) {
          if (i === 0 && pageNum === 1) {
            logError('[shimano] WAF blocked. Shimano requires headless: false browser. Skipping all.');
            return products;
          }
          break;
        }

        const pageProducts = await page.evaluate(() => {
          const results: { url: string; name: string }[] = [];
          const links = document.querySelectorAll('a[href*="/product/lure/"]');

          links.forEach(link => {
            const href = link.getAttribute('href');
            if (!href || !href.endsWith('.html')) return;
            const segments = href.split('/').filter(Boolean);
            if (segments.length < 6) return;
            const lastSegment = segments[segments.length - 1].replace('.html', '');
            if (!lastSegment || lastSegment.length < 10) return;

            let name = '';
            const nameEl = link.querySelector('[class*="name"], [class*="title"], h2, h3, h4');
            if (nameEl) name = nameEl.textContent?.trim() || '';
            if (!name) name = link.textContent?.trim().split('\n')[0].trim() || '';
            name = name.substring(0, 100);

            results.push({ url: href, name: name || '(名前取得失敗)' });
          });
          return results;
        });

        if (pageProducts.length === 0) break;

        let newOnThisPage = 0;
        for (const p of pageProducts) {
          const fullUrl = p.url.startsWith('http') ? p.url : `${SHIMANO_BASE_URL}${p.url}`;
          const normalized = normalizeUrl(fullUrl);
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          products.push({ url: normalized, name: p.name });
          newOnThisPage++;
        }

        // If no new products found on this page, all remaining pages are duplicates — stop
        if (newOnThisPage === 0 && pageNum > 1) break;

        // Check for next page
        const hasNextPage = await page.evaluate((currentPage: number) => {
          const pageLinks = document.querySelectorAll('a[href*="page="]');
          let hasNext = false;
          pageLinks.forEach(link => {
            const href = link.getAttribute('href') || '';
            const pageMatch = href.match(/page=(\d+)/);
            if (pageMatch && parseInt(pageMatch[1]) > currentPage) hasNext = true;
          });
          return hasNext;
        }, pageNum);

        if (!hasNextPage) break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`[shimano] Failed to crawl ${pageUrl}: ${errMsg}`);
        break;
      }
    }

    if (i < SHIMANO_SUBCATEGORY_URLS.length - 1) await sleep(2000);
  }

  log(`[shimano] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// ima discovery logic
// ---------------------------------------------------------------------------

const IMA_BASE_URL = 'https://www.ima-ams.co.jp';
const IMA_LURE_LIST_URL = `${IMA_BASE_URL}/product/products/list?category_id=7`;

async function discoverIma(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[ima] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  try {
    await page.goto(IMA_LURE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    // All 177 products are on a single page — no pagination needed
    const pageProducts = await page.evaluate(() => {
      const results: { url: string; name: string }[] = [];
      const links = document.querySelectorAll('a[href*="/products/detail/"]');
      const seenHrefs = new Set<string>();

      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href || seenHrefs.has(href)) return;
        seenHrefs.add(href);

        // Extract product name from the link's text or child element
        const nameEl = link.querySelector('.product_list__name, h3, h4');
        let name = nameEl?.textContent?.trim() || link.textContent?.trim() || '';
        name = name.split('\n')[0].trim().substring(0, 100);

        results.push({ url: href, name: name || '(名前取得失敗)' });
      });
      return results;
    });

    for (const p of pageProducts) {
      const fullUrl = p.url.startsWith('http') ? p.url : `${IMA_BASE_URL}${p.url}`;
      const normalized = normalizeUrl(fullUrl);

      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
    }

    log(`[ima] Found ${pageProducts.length} links, ${products.length} unique products`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[ima] Failed to crawl ${IMA_LURE_LIST_URL}: ${errMsg}`);
  }

  log(`[ima] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// DUO discovery logic
// ---------------------------------------------------------------------------

const DUO_BASE_URL = 'https://www.duo-inc.co.jp';
// DUO category pages: SALT=2, TROUT=3, BASS=4, 鮎=5
// Category 1 = ROD/GEAR (non-lure)
const DUO_CATEGORY_IDS = [2, 3, 4, 5];

async function discoverDuo(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[duo] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const catId of DUO_CATEGORY_IDS) {
    const categoryUrl = `${DUO_BASE_URL}/product/category/${catId}`;
    const catName = catId === 2 ? 'SALT' : catId === 3 ? 'TROUT' : catId === 4 ? 'BASS' : '鮎';
    log(`[duo] Crawling ${catName} category: ${categoryUrl}`);

    try {
      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(5000); // Nuxt SPA needs time to render

      const pageProducts = await page.evaluate((baseUrl: string) => {
        const results: { url: string; name: string }[] = [];
        const links = document.querySelectorAll('a[href*="/product/"]');

        links.forEach(link => {
          const href = link.getAttribute('href');
          if (!href) return;
          // Only product pages with numeric IDs: /product/{id}
          if (!/\/product\/\d+$/.test(href)) return;
          // Skip category pages
          if (href.includes('/category/')) return;

          // Extract product name from link text or child elements
          let name = '';
          const h3 = link.querySelector('h3, h4, p');
          if (h3) name = h3.textContent?.trim() || '';
          if (!name) name = link.textContent?.trim() || '';
          name = name.split('\n')[0].trim().substring(0, 100);

          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          results.push({ url: fullUrl, name: name || '(名前取得失敗)' });
        });

        return results;
      }, DUO_BASE_URL);

      let newOnThisPage = 0;
      for (const p of pageProducts) {
        const normalized = normalizeUrl(p.url);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        products.push({ url: normalized, name: p.name });
        newOnThisPage++;
      }

      log(`[duo]   ${catName}: ${pageProducts.length} links, ${newOnThisPage} new unique products`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[duo] Failed to crawl ${categoryUrl}: ${errMsg}`);
    }

    await sleep(PAGE_LOAD_DELAY_MS);
  }

  log(`[duo] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// deps discovery logic
// ---------------------------------------------------------------------------

const DEPS_BASE_URL = 'https://www.depsweb.co.jp';
const DEPS_LISTING_URL = `${DEPS_BASE_URL}/products/lure/`;

// Categories to exclude from deps (non-hardbait)
const DEPS_EXCLUDED_CATEGORIES = ['SOFT BAIT', 'SUPER BIG WORM SERIES', 'JIGHEAD/HOOK'];

async function discoverDeps(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[deps] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  try {
    await page.goto(DEPS_LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    // deps listing page groups products under h2 category headers.
    // We need to exclude SOFT BAIT, SUPER BIG WORM SERIES, JIGHEAD/HOOK categories.
    const pageProducts = await page.evaluate((excludedCategories: string[]) => {
      const results: { url: string; name: string; category: string }[] = [];

      // Walk through all h2 category headers
      const h2s = document.querySelectorAll('h2');
      for (const h2 of h2s) {
        // Extract category name (h2 text may have duplicated lines due to line breaks)
        const rawText = h2.textContent || '';
        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const category = lines[0] || '';

        if (!category) continue;

        // Check if this category should be excluded
        const isExcluded = excludedCategories.some(
          exc => category.toUpperCase().includes(exc.toUpperCase()),
        );
        if (isExcluded) continue;

        // Find the product list that follows this h2
        // Walk siblings until we hit the next h2 or run out
        let sibling = h2.nextElementSibling;
        while (sibling && sibling.tagName !== 'H2') {
          const links = sibling.querySelectorAll('a[href*="/product/"]');
          for (const link of links) {
            const href = link.getAttribute('href');
            if (!href) continue;
            // Skip if it's a category page or non-product link
            if (href.includes('/products/') && !href.match(/\/product\/[^/]+\/?$/)) continue;

            let name = '';
            const nameEl = link.querySelector('h3, h4, .product-name, .title');
            if (nameEl) name = nameEl.textContent?.trim() || '';
            if (!name) name = link.textContent?.trim() || '';
            name = name.split('\n')[0].trim().substring(0, 100);

            results.push({ url: href, name: name || '(名前取得失敗)', category });
          }
          sibling = sibling.nextElementSibling;
        }
      }

      return results;
    }, DEPS_EXCLUDED_CATEGORIES);

    for (const p of pageProducts) {
      const fullUrl = p.url.startsWith('http') ? p.url : `${DEPS_BASE_URL}${p.url}`;
      const normalized = normalizeUrl(fullUrl);

      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
    }

    log(`[deps] Found ${pageProducts.length} links, ${products.length} unique products (excluded categories: ${DEPS_EXCLUDED_CATEGORIES.join(', ')})`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[deps] Failed to crawl ${DEPS_LISTING_URL}: ${errMsg}`);
  }

  log(`[deps] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// Jackall discovery logic
// ---------------------------------------------------------------------------

const JACKALL_BASE_URL = 'https://www.jackall.co.jp';

// Sections to crawl: [sectionPath, sectionName]
const JACKALL_SECTIONS: [string, string][] = [
  ['/bass/', 'BASS'],
  ['/saltwater/shore-casting/', 'SALT SHORE'],
  ['/saltwater/offshore-casting/', 'SALT OFFSHORE'],
  ['/timon/', 'TROUT (Timon)'],
];

// Category slugs to exclude (non-lure: rods, accessories, tackle, etc.)
const JACKALL_EXCLUDED_CATEGORIES = new Set([
  'rod', 'revoltage-rod', 'bpm', 'nazzy-choice',
  'cian-rod', 'casting', 'surf-rod', 'light-game',
  'tconnection', 't-connection-comfy-rod', 't-connection_s',
  'rod-tairkabura', 'rod-hitosutenya', 'boat-casting-rod',
  'rod-tachiuo-jigging', 'rod-bluefish-jigging',
  'tiprun-rod', 'fugu-rod', 'ikametalrod',
  'reel', 'accessory', 'apparel-tt', 'apparel-terminal-tackle', 'apparel',
  'hook-jighead', 'line', 'sinker', 'tool',
  'case-bag', 'sticker', 'jackall-works', 'bag', 'wear',
  'hook', 'spare', 'parts',
  'wader-gamevest', 'set', 'other', 'custom-parts',
  'salt-products-offs-246',
]);

// URL/name keywords to exclude individual products (non-lure items)
const JACKALL_URL_EXCLUDE = [
  'hook', 'spare', 'replacement', 'parts', 'sticker',
  'case', 'bag', 'apparel', 'wear', 'cap', 'shirt',
  'custom-weight', 'e-snap', 'esnap',
  'wader', 'vest', '/rod/', '/accessory/',
  'sabiki', 'leader',
];

const JACKALL_NAME_EXCLUDE = [
  'フック', 'HOOK', 'スペア', 'SPARE', 'ｽﾍﾟｱ', '替え', '交換',
  'パーツ', 'PARTS', 'ケース', 'CASE', 'バッグ', 'BAG',
  'キャップ', 'CAP', 'シャツ', 'SHIRT', 'ステッカー', 'STICKER',
  'アパレル', 'ライン', 'LINE', 'シンカー', 'SINKER',
  'ロッド', 'ROD', 'リール', 'REEL',
  'イースナップ', 'ウェーダー', 'WADER', 'ベスト', 'VEST',
  'カスタムウェイト', 'スターターセット', 'ワンタッチラバー',
  'オーバルリング', 'VCリーダー', 'LGフロート',
  'LEADER', 'リーダー', 'サビキ', 'SABIKI',
];

async function discoverJackall(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[jackall] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const [sectionPath, sectionName] of JACKALL_SECTIONS) {
    const productsUrl = `${JACKALL_BASE_URL}${sectionPath}products/`;
    log(`[jackall] Loading ${sectionName}: ${productsUrl}`);

    try {
      await page.goto(productsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      // Get category links
      const categoryLinks = await page.evaluate((basePath: string) => {
        const links: { url: string; slug: string }[] = [];
        const anchors = document.querySelectorAll(`a[href*="${basePath}products/category/"]`);
        const seenSlugs = new Set<string>();

        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          const match = href.match(/\/products\/category\/([^/]+)/);
          if (!match) continue;
          const slug = match[1];
          if (seenSlugs.has(slug)) continue;
          seenSlugs.add(slug);
          const fullUrl = href.startsWith('http') ? href : `https://www.jackall.co.jp${href}`;
          links.push({ url: fullUrl, slug });
        }
        return links;
      }, sectionPath);

      // Crawl each non-excluded category
      for (const cat of categoryLinks) {
        if (JACKALL_EXCLUDED_CATEGORIES.has(cat.slug)) continue;

        for (let pageNum = 1; pageNum <= 20; pageNum++) {
          const pageUrl = pageNum === 1
            ? cat.url
            : `${cat.url.replace(/\/$/, '')}/page/${pageNum}/`;

          try {
            await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await sleep(PAGE_LOAD_DELAY_MS);

            const pageProducts = await page.evaluate(() => {
              const results: { url: string; name: string }[] = [];
              const items = document.querySelectorAll('.product-list__item a');
              for (const a of items) {
                const href = a.getAttribute('href');
                if (!href || href.includes('/category/')) continue;
                const jpName = a.querySelector('.product-list__title--main')?.textContent?.trim() || '';
                const enName = a.querySelector('.product-list__title--sub, h4.common-list__meta')?.textContent?.trim().replace(/\s*NEW\s*$/i, '') || '';
                results.push({ url: href, name: jpName || enName || '' });
              }
              return results;
            });

            if (pageProducts.length === 0) break;

            for (const p of pageProducts) {
              const fullUrl = p.url.startsWith('http') ? p.url : `${JACKALL_BASE_URL}${p.url}`;
              const normalized = fullUrl.replace(/\/$/, '');
              if (seen.has(normalized)) continue;

              // URL exclusion
              const urlLower = normalized.toLowerCase();
              if (JACKALL_URL_EXCLUDE.some(kw => urlLower.includes(kw))) continue;

              // Name exclusion
              if (p.name && JACKALL_NAME_EXCLUDE.some(kw => p.name.toUpperCase().includes(kw.toUpperCase()))) continue;

              seen.add(normalized);
              products.push({ url: normalized, name: p.name || '(名前取得失敗)' });
            }

            // Check for next page
            const hasNext = await page.evaluate((currentPage: number) => {
              const pageLinks = document.querySelectorAll('.page-pagnation a, .navigation.pagination a');
              for (const link of pageLinks) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/\/page\/(\d+)/);
                if (match && parseInt(match[1]) > currentPage) return true;
              }
              return false;
            }, pageNum);

            if (!hasNext) break;
          } catch {
            break;
          }
        }
      }

      log(`[jackall] ${sectionName}: ${products.length} total so far`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[jackall] Failed to crawl ${sectionName}: ${errMsg}`);
    }
  }

  log(`[jackall] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// EVERGREEN discovery logic
// ---------------------------------------------------------------------------

const EVERGREEN_BASE_URL = 'https://www.evergreen-fishing.com';

// 9 lure category pages
const EVERGREEN_CATEGORY_URLS = [
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=29&vctt_no=1&g_no=4&r=2&s_no=29`, // Bass Combat
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=31&vctt_no=1&g_no=4&r=2&s_no=31`, // Bass Mode
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=57&vctt_no=1&g_no=4&r=2&s_no=57`, // Bass Fact
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=24&vctt_no=2&g_no=4&r=2&s_no=24`, // Salt Jigging
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=26&vctt_no=2&g_no=4&r=2&s_no=26`, // Salt Egging
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=25&vctt_no=2&g_no=4&r=2&s_no=25`, // Salt SeaBass
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=27&vctt_no=2&g_no=4&r=2&s_no=27`, // Salt LightGame
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=77&vctt_no=30&r=2&g_no=4&s_no=77`, // Trout Area
  `${EVERGREEN_BASE_URL}/goods_list/goods_list_22lure.php?vctg_no=4&vcts_no=78&vctt_no=30&r=2&g_no=4&s_no=78`, // Trout Native
];

async function discoverEvergreen(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[evergreen] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const categoryUrl of EVERGREEN_CATEGORY_URLS) {
    try {
      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      const pageProducts = await page.evaluate(() => {
        const results: { url: string; name: string }[] = [];
        const links = document.querySelectorAll('a[href]');

        for (const link of links) {
          const href = link.getAttribute('href') || '';
          // Product detail pages: /goods_list/ProductName.html (NOT .php)
          if (href.includes('goods_list/') && href.endsWith('.html') && !href.includes('.php')) {
            const fullUrl = href.startsWith('http')
              ? href
              : window.location.origin + (href.startsWith('/') ? '' : '/') + href;

            const img = link.querySelector('img');
            const text = img?.getAttribute('alt')?.trim() || link.textContent?.trim() || '';

            results.push({ url: fullUrl, text: text.substring(0, 100) });
          }
        }

        return results;
      });

      for (const p of pageProducts) {
        const normalized = normalizeUrl(p.url);
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        let name = p.text;
        if (!name) {
          const match = normalized.match(/\/goods_list\/([^/]+)\.html/i);
          name = match ? match[1] : '(名前取得失敗)';
        }

        products.push({ url: normalized, name });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[evergreen] Failed to crawl category: ${errMsg}`);
    }

    await sleep(PAGE_LOAD_DELAY_MS);
  }

  log(`[evergreen] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// APIA discovery logic
// ---------------------------------------------------------------------------

const APIA_BASE_URL = 'https://www.apiajapan.com';
const APIA_LURE_LIST_URL = `${APIA_BASE_URL}/product/lure/`;

async function discoverApia(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[apia] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  try {
    await page.goto(APIA_LURE_LIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    const pageProducts = await page.evaluate((baseUrl: string) => {
      const results: { url: string; name: string }[] = [];
      const links = document.querySelectorAll('a[href*="/product/lure/"]');

      for (const link of links) {
        const href = link.getAttribute('href');
        if (!href) continue;

        // Skip the listing page itself
        if (href === '/product/lure/' || href === '/product/lure') continue;
        if (href.endsWith('/product/lure/') || href.endsWith('/product/lure')) continue;

        // Must match product pattern: /product/lure/{slug}/
        if (!/\/product\/lure\/[^/]+\/?$/.test(href)) continue;

        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

        // Extract product name from link text or child elements
        let name = '';
        const nameEl = link.querySelector('h2, h3, h4, p, span');
        if (nameEl) name = nameEl.textContent?.trim() || '';
        if (!name) name = link.textContent?.trim() || '';
        name = name.split('\n')[0].trim().substring(0, 100);

        results.push({ url: fullUrl, name: name || '(名前取得失敗)' });
      }
      return results;
    }, APIA_BASE_URL);

    for (const p of pageProducts) {
      const normalized = normalizeUrl(p.url);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
    }

    log(`[apia] Found ${pageProducts.length} links, ${products.length} unique products`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[apia] Failed to crawl ${APIA_LURE_LIST_URL}: ${errMsg}`);
  }

  log(`[apia] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// COREMAN discovery logic
// ---------------------------------------------------------------------------

const COREMAN_BASE_URL = 'https://www.coreman.jp';
const COREMAN_LURE_LIST_URL = `${COREMAN_BASE_URL}/product_lure/`;

async function discoverCoreman(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[coreman] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  try {
    await page.goto(COREMAN_LURE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    const pageProducts = await page.evaluate((baseUrl: string) => {
      const results: { url: string; name: string }[] = [];
      const links = document.querySelectorAll('a[href]');

      for (const link of links) {
        const href = link.getAttribute('href');
        if (!href) continue;

        // Match /product_lure/{slug} but NOT the listing page itself
        if (!/\/product_lure\/[^/?#]+/.test(href)) continue;
        const cleanHref = href.replace(/\/$/, '');
        if (cleanHref === '/product_lure' || cleanHref.endsWith('/product_lure')) continue;

        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

        // Skip external links (DUO collaboration products)
        if (!fullUrl.includes('coreman.jp')) continue;

        // Extract product name from link text
        let name = link.textContent?.trim()?.split('\n')[0]?.trim() || '';
        name = name.substring(0, 100);

        results.push({ url: fullUrl, name: name || '(名前取得失敗)' });
      }
      return results;
    }, COREMAN_BASE_URL);

    for (const p of pageProducts) {
      const normalized = normalizeUrl(p.url);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
    }

    log(`[coreman] Found ${pageProducts.length} links, ${products.length} unique products`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[coreman] Failed to crawl ${COREMAN_LURE_LIST_URL}: ${errMsg}`);
  }

  log(`[coreman] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// Pazdesign (reed) discovery logic
// ---------------------------------------------------------------------------

const PAZDESIGN_BASE_URL = 'https://pazdesign.co.jp';
const PAZDESIGN_LURE_LIST_URL = `${PAZDESIGN_BASE_URL}/products/reed/`;

// URL slugs to exclude (hooks, spare parts, accessories)
const PAZDESIGN_EXCLUDED_URL_SLUGS = [
  'ls_hook', 'perfectassisthook',
  'benishizuku_skirt', 'benishizuku_necktie', 'benishizuku_hook',
];

async function discoverPazdesign(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[pazdesign] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  try {
    await page.goto(PAZDESIGN_LURE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000); // jQuery client-side pagination — all products in DOM after JS runs

    const pageProducts = await page.evaluate((baseUrl: string) => {
      const results: { url: string; name: string }[] = [];
      const links = document.querySelectorAll('a[href]');

      for (const link of links) {
        const href = link.getAttribute('href');
        if (!href) continue;

        // Match relative links like "./grandsoldier/" or "grandsoldier/"
        // and absolute links like "/products/reed/grandsoldier/"
        const relMatch = href.match(/^\.?\/?([a-zA-Z0-9_]+)\/?$/);
        const absMatch = href.match(/\/products\/reed\/([a-zA-Z0-9_]+)\/?$/);

        const slug = relMatch ? relMatch[1] : absMatch ? absMatch[1] : null;
        if (!slug) continue;

        // Skip "reed" itself (the listing page link)
        if (slug === 'reed') continue;

        const fullUrl = `${baseUrl}/products/reed/${slug}/`;

        // Extract name from link text or child elements
        let name = '';
        const nameEl = link.querySelector('h3, h4, p, span');
        if (nameEl) name = nameEl.textContent?.trim() || '';
        if (!name) name = link.textContent?.trim() || '';
        name = name.split('\n')[0].trim().substring(0, 100);

        results.push({ url: fullUrl, name: name || '(名前取得失敗)' });
      }
      return results;
    }, PAZDESIGN_BASE_URL);

    for (const p of pageProducts) {
      const normalized = normalizeUrl(p.url);
      if (seen.has(normalized)) continue;

      // Check excluded URL slugs
      const slug = normalized.match(/\/products\/reed\/([^/]+)/)?.[1] || '';
      if (PAZDESIGN_EXCLUDED_URL_SLUGS.some(exc => slug === exc)) {
        log(`  [pazdesign] Skipping excluded slug: ${slug}`);
        continue;
      }

      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
    }

    log(`[pazdesign] Found ${pageProducts.length} links, ${products.length} unique products (after slug exclusions)`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[pazdesign] Failed to crawl ${PAZDESIGN_LURE_LIST_URL}: ${errMsg}`);
  }

  log(`[pazdesign] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// O.S.P discovery logic
// ---------------------------------------------------------------------------

const OSP_BASE_URL = 'https://www.o-s-p.net';

// All 13 category pages to crawl
const OSP_CATEGORY_PAGES = [
  '/products-list/bass/hardlure',
  '/products-list/bass/softlure',
  '/products-list/bass/wirebait',
  '/products-list/bass/jig',
  '/products-list/bass/metal',
  '/products-list/bass/frog',
  '/products-list/trout/hardlure',
  '/products-list/ayu/hardlure',
  '/products-list/salt/hardlure',
  '/products-list/salt/softlure',
  '/products-list/salt/jig',
  '/products-list/salt/metaljig',
  '/products-list/salt/tairubber',
];

// Products with these exact slugs are excluded (tairubber accessories)
const OSP_EXCLUDED_SLUGS = new Set([
  'tie_asym',
  'tie_double',
  'tie_str',
  'tie_unit',
]);

async function discoverOsp(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[osp] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const catPath of OSP_CATEGORY_PAGES) {
    const categoryUrl = `${OSP_BASE_URL}${catPath}`;
    log(`[osp] Crawling: ${categoryUrl}`);

    try {
      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      const pageProducts = await page.evaluate((baseUrl: string) => {
        const results: Array<{ url: string; name: string }> = [];
        const links = document.querySelectorAll('a[href*="/products/"]');

        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/\/products\/([a-zA-Z0-9_-]+)\/?$/);
          if (!match) continue;

          const slug = match[1];
          if (slug === 'products' || slug === 'products-list') continue;

          const fullUrl = `${baseUrl}/products/${slug}/`;

          let name = '';
          const nameEl = link.querySelector('h4, h3, p, span');
          if (nameEl) name = nameEl.textContent?.trim() || '';
          if (!name) name = link.textContent?.trim()?.split('\n')[0]?.trim() || '';
          name = name.substring(0, 100);

          results.push({ url: fullUrl, name: name || slug });
        }

        return results;
      }, OSP_BASE_URL);

      for (const p of pageProducts) {
        const normalized = normalizeUrl(p.url);
        if (seen.has(normalized)) continue;

        // Check excluded slugs
        const slugMatch = normalized.match(/\/products\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1].toLowerCase() : '';
        if (OSP_EXCLUDED_SLUGS.has(slug)) {
          log(`  [osp] Skipping excluded slug: ${slug}`);
          continue;
        }

        seen.add(normalized);
        products.push({ url: normalized, name: p.name });
      }

      log(`[osp]   ${catPath}: ${pageProducts.length} links, ${seen.size} unique so far`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[osp] Failed to crawl ${categoryUrl}: ${errMsg}`);
    }

    await sleep(500); // Be polite between pages
  }

  log(`[osp] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// GANCRAFT — gancraft.com (EUC-JP, static HTML, categories: bass/saltwater/ayu)
// ---------------------------------------------------------------------------

const GANCRAFT_BASE_URL = 'https://gancraft.com';
const GANCRAFT_CATEGORY_PAGES = ['/bass.html', '/saltwater.html', '/ayu.html'];

async function discoverGancraft(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[gancraft] Discovering products...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  for (const catPath of GANCRAFT_CATEGORY_PAGES) {
    const categoryUrl = `${GANCRAFT_BASE_URL}${catPath}`;
    log(`[gancraft] Crawling: ${categoryUrl}`);

    try {
      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      const pageProducts = await page.evaluate((baseUrl: string) => {
        const results: Array<{ url: string; name: string }> = [];
        const links = document.querySelectorAll('a[href*="lures/"]');

        for (const link of links) {
          let href = link.getAttribute('href') || '';
          if (!href.includes('lures/')) continue;

          // Normalize: extract path, ensure .html suffix
          let path = href.replace(/^(https?:\/\/[^/]+)?/, '').replace(/\/$/, '');
          if (!path.endsWith('.html')) path += '.html';
          if (!path.startsWith('/')) path = '/' + path;

          const fullUrl = baseUrl + path;

          // Extract product name from alt text or link text
          const img = link.querySelector('img');
          let name = img?.getAttribute('alt')?.trim() || '';
          if (!name) name = link.textContent?.trim()?.split('\n')[0]?.trim() || '';
          name = name.substring(0, 100);

          // Extract slug for fallback name
          const slugMatch = path.match(/\/lures\/(.+?)\.html$/);
          const slug = slugMatch ? slugMatch[1] : '';

          results.push({ url: fullUrl, name: name || slug });
        }

        return results;
      }, GANCRAFT_BASE_URL);

      for (const p of pageProducts) {
        const normalized = normalizeUrl(p.url);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        products.push({ url: normalized, name: p.name });
      }

      log(`[gancraft]   ${catPath}: ${pageProducts.length} links, ${seen.size} unique so far`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[gancraft] Failed to crawl ${categoryUrl}: ${errMsg}`);
    }

    await sleep(500);
  }

  log(`[gancraft] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// LUCKY CRAFT discovery
// ---------------------------------------------------------------------------

async function discoverLuckyCraft(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[luckycraft] Discovering products from category.html...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  const categoryUrl = 'https://www.luckycraft.co.jp/category.html';
  log(`[luckycraft] Crawling: ${categoryUrl}`);

  try {
    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    const pageProducts = await page.evaluate(() => {
      var results: Array<{ url: string; name: string }> = [];
      var links = document.querySelectorAll('a[href*="/product/"]');

      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (!href.includes('/product/')) continue;
        if (!href.endsWith('.html')) continue;

        // Make absolute
        var fullUrl = href;
        if (href.startsWith('/')) {
          fullUrl = 'https://www.luckycraft.co.jp' + href;
        } else if (!href.startsWith('http')) {
          fullUrl = 'https://www.luckycraft.co.jp/' + href;
        }
        // Normalize http to https
        fullUrl = fullUrl.replace(/^http:\/\//, 'https://');

        // Extract name from link text
        var name = (links[i].textContent || '').trim();
        // Extract slug as fallback
        var pathParts = fullUrl.split('/');
        var fileName = (pathParts[pathParts.length - 1] || '').replace('.html', '');

        results.push({ url: fullUrl, name: name || fileName });
      }

      return results;
    });

    for (const p of pageProducts) {
      const normalized = normalizeUrl(p.url);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: p.name });
    }

    log(`[luckycraft]   category.html: ${pageProducts.length} links, ${seen.size} unique`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[luckycraft] Failed to crawl ${categoryUrl}: ${errMsg}`);
  }

  log(`[luckycraft] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// DUEL — duel.co.jp
// ---------------------------------------------------------------------------

async function discoverDuel(page: Page): Promise<Array<{ url: string; name: string }>> {
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  const DUEL_BASE = 'https://www.duel.co.jp';
  const CATEGORY = 277; // "ルアー全て"
  let pageNum = 1;

  while (true) {
    const url = pageNum === 1
      ? `${DUEL_BASE}/products/?category=${CATEGORY}`
      : `${DUEL_BASE}/products/more.php?p=${pageNum}&category=${CATEGORY}`;

    log(`[duel] Crawling page ${pageNum}: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    const links = await page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="detail.php?pid="]');
      var results: Array<{ url: string; name: string }> = [];
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i] as HTMLAnchorElement;
        var href = a.href;
        // Try to extract product name from nearby text
        var nameEl = a.querySelector('.c-card-product_name, .product-name, h3, h2');
        var name = nameEl ? nameEl.textContent.trim() : '';
        if (href) results.push({ url: href, name: name || href });
      }
      return results;
    });

    if (links.length === 0) break;

    for (const link of links) {
      const normalized = link.url.replace(/^http:/, 'https:');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      products.push({ url: normalized, name: link.name });
    }

    log(`[duel]   page ${pageNum}: ${links.length} links, ${seen.size} unique total`);
    pageNum++;
  }

  log(`[duel] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// Tackle House — tacklehouse.co.jp (static HTML, single catalog page)
// ---------------------------------------------------------------------------

const TACKLEHOUSE_BASE_URL = 'https://tacklehouse.co.jp';
const TACKLEHOUSE_PRODUCTS_URL = `${TACKLEHOUSE_BASE_URL}/product/`;

// Overview pages and accessory pages to exclude by slug
const TACKLEHOUSE_EXCLUDED_SLUGS = new Set([
  'index', 'datasheet',
  'kten', 'contact', 'shores', 'elfin',
  'k2', 'twinkle', 'buffet', 'resistance', 'rb', 'pj', 'bo', 'cruise', 'shibuki',
  'mlh', 'nts', 'tsuno', 'saltia',
]);

async function discoverTacklehouse(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[tacklehouse] Discovering products from /product/ ...');
  const products: Array<{ url: string; name: string }> = [];
  const seen = new Set<string>();

  try {
    await page.goto(TACKLEHOUSE_PRODUCTS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY_MS);

    const pageProducts = await page.evaluate(function () {
      var results: Array<{ url: string; name: string }> = [];
      var anchors = document.querySelectorAll('a[href$=".html"]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i] as HTMLAnchorElement;
        var href = a.href;
        var name = (a.textContent || '').trim();
        if (href && href.indexOf('/product/') >= 0) {
          results.push({ url: href, name: name });
        }
      }
      return results;
    });

    for (const p of pageProducts) {
      // Extract slug from URL
      var slugMatch = p.url.match(/\/product\/([^/]+)\.html/);
      if (!slugMatch) continue;
      var slug = slugMatch[1];

      // Skip excluded slugs
      if (TACKLEHOUSE_EXCLUDED_SLUGS.has(slug)) continue;

      // Normalize URL
      var normalizedUrl = `${TACKLEHOUSE_BASE_URL}/product/${slug}.html`;

      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);

      products.push({ url: normalizedUrl, name: p.name || slug });
    }

    log(`[tacklehouse] Found ${pageProducts.length} links, ${products.length} unique products`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[tacklehouse] Failed to crawl ${TACKLEHOUSE_PRODUCTS_URL}: ${errMsg}`);
  }

  log(`[tacklehouse] Discovered ${products.length} products`);
  return products;
}

// ---------------------------------------------------------------------------
// ZIPBAITS discovery logic
// ---------------------------------------------------------------------------

const ZIPBAITS_BASE_URL = 'https://www.zipbaits.com';
// Categories: c=1 TROUT, c=2 SEA BASS, c=3 KURODAI, c=4 LIGHT SALT, c=5 BASS
const ZIPBAITS_CATEGORIES = [1, 2, 3, 4, 5];

async function discoverZipbaits(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[zipbaits] Discovering products from /item/?c=1..5 ...');
  const products: Array<{ url: string; name: string }> = [];
  const seenIds = new Set<string>();

  for (const cat of ZIPBAITS_CATEGORIES) {
    const catUrl = `${ZIPBAITS_BASE_URL}/item/?c=${cat}`;
    try {
      await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      const pageProducts = await page.evaluate(function () {
        var results: Array<{ url: string; name: string }> = [];
        var anchors = document.querySelectorAll('a[href*="?i="]');
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i] as HTMLAnchorElement;
          var href = a.href;
          var name = (a.textContent || '').trim();
          if (href) {
            results.push({ url: href, name: name });
          }
        }
        return results;
      });

      log(`[zipbaits] Category ${cat}: found ${pageProducts.length} links`);

      for (var p of pageProducts) {
        var idMatch = p.url.match(/[?&]i=(\d+)/);
        if (!idMatch) continue;
        var id = idMatch[1];
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        var normalizedUrl = `${ZIPBAITS_BASE_URL}/item/?i=${id}`;
        products.push({ url: normalizedUrl, name: p.name || id });
      }
    } catch (err) {
      var errMsg = err instanceof Error ? err.message : String(err);
      logError(`[zipbaits] Failed to crawl ${catUrl}: ${errMsg}`);
    }
  }

  log(`[zipbaits] Discovered ${products.length} unique products`);
  return products;
}

// ---------------------------------------------------------------------------
// SMITH discovery logic
// ---------------------------------------------------------------------------

const SMITH_BASE_URL = 'https://www.smith.jp';
const SMITH_CATEGORY_PAGES = [
  '03-basstacle.html',
  '03-trouttacle.html',
  '03-saltwater.html',
  '03-cattacle.html',
  '03-snaketacle.html',
  '03-expedition.html',
];

const SMITH_EXCLUDED_SLUGS = [
  // Rods (bass)
  'bareafun', 'hiroism',
  // Rods (trout)
  'lagless', 'tactist', 'realflex', 'daggerstream',
  'bstc', 'multiyouse', 'panoramashaft', 'ss4custom', 'neuelimited',
  'ilflusso', 'averlla', 'tareafun',
  // Rods (salt)
  'bowdevil', 'smoky', 'darkshadowex',
  'baylineraj', 'baylinermk', 'baylinerakbm', 'baylinerrf', 'baylinersj',
  'hsjbeveljerk', 'hsjcs', 'hsjssl', 'gravitation',
  'kozexpcasting', 'kozexpspinning', 'kozexpjigging',
  'amjx', 'gtk', 'wrc', 'olp',
  // Rods (catfish/snakehead)
  'namanchu', 'mhkoz3',
  // Accessories & tools
  'accessory', 'reelgrease', 'releaser', 'neomaghookkeeper',
  'eyetunerfinesse', 'easyfishgrip', 'egisharpner',
  'option', 'tool', 'parts',
  // Non-product pages
  'heddon_ss',
  // External links
  'superstrike',
];

async function discoverSmith(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[smith] Discovering products from 6 category pages ...');
  var products: Array<{ url: string; name: string }> = [];
  var seenKeys = new Set<string>();

  for (var catPage of SMITH_CATEGORY_PAGES) {
    var catUrl = SMITH_BASE_URL + '/html/' + catPage;
    try {
      await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);

      var pageProducts = await page.evaluate(function () {
        var results: Array<{ url: string; name: string }> = [];
        var anchors = document.querySelectorAll('a[href*="product/"]');
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i] as HTMLAnchorElement;
          var href = a.href;
          if (href && href.indexOf('.html') > 0) {
            var name = (a.textContent || '').trim();
            results.push({ url: href, name: name });
          }
        }
        return results;
      });

      log('[smith] Category ' + catPage + ': found ' + pageProducts.length + ' links');

      for (var p of pageProducts) {
        // Extract category/dir for dedup: "trout/dcontact"
        var match = p.url.match(/\/product\/([^/]+)\/([^/]+)\//);
        if (!match) continue;

        var key = match[1] + '/' + match[2];

        // Check exclusions
        var excluded = false;
        var lower = p.url.toLowerCase();
        for (var j = 0; j < SMITH_EXCLUDED_SLUGS.length; j++) {
          if (lower.indexOf(SMITH_EXCLUDED_SLUGS[j].toLowerCase()) >= 0) {
            excluded = true;
            break;
          }
        }
        if (excluded) continue;

        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        products.push({ url: p.url, name: p.name || match[2] });
      }
    } catch (err) {
      var errMsg = err instanceof Error ? err.message : String(err);
      logError('[smith] Failed to crawl ' + catUrl + ': ' + errMsg);
    }
  }

  log('[smith] Discovered ' + products.length + ' unique products');
  return products;
}

// ---------------------------------------------------------------------------
// TIEMCO discovery logic
// ---------------------------------------------------------------------------

const TIEMCO_BASE_URL = 'https://www.tiemco.co.jp';
const TIEMCO_CATEGORY_CONFIGS = [
  { cat: '002001003', label: 'Bass Hard Lures' },
  { cat: '002001004', label: 'Bass Soft Lures' },
  { cat: '002002004', label: 'Trout Hard Lures' },
];
const TIEMCO_SEARCH_KEYWORDS = [
  '%E9%AE%8E%E3%83%AB%E3%82%A2%E3%83%BC',  // 鮎ルアー
  '%E9%9B%B7%E9%AD%9A',                      // 雷魚
  '%E5%B0%8F%E7%89%A9%E9%87%A3%E3%82%8A',   // 小物釣り
];
const TIEMCO_LURE_CAT_PREFIXES = [
  '002001003', '002001004', '002002004', '002004', '002005', '002006',
];
const TIEMCO_EXCLUDED_CAT_PREFIXES = [
  '002001001', '002001002', '002001005', '002001006', '002001007',
  '002002001', '002002002', '002002003', '002002005',
  '001', '003',
];

function tiemcoIsLureCat(catCode: string): boolean {
  for (var i = 0; i < TIEMCO_EXCLUDED_CAT_PREFIXES.length; i++) {
    if (catCode.startsWith(TIEMCO_EXCLUDED_CAT_PREFIXES[i])) return false;
  }
  for (var j = 0; j < TIEMCO_LURE_CAT_PREFIXES.length; j++) {
    if (catCode.startsWith(TIEMCO_LURE_CAT_PREFIXES[j])) return true;
  }
  return false;
}

async function discoverTiemco(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[tiemco] Discovering products from category pages + search pages ...');
  var products: Array<{ url: string; name: string }> = [];
  var seenPids = new Set<string>();

  // Helper: extract product links from current page
  async function extractLinks(): Promise<Array<{ url: string; name: string }>> {
    return page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="ProductDetail.aspx"]');
      var results: Array<{ url: string; name: string }> = [];
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i] as HTMLAnchorElement;
        var href = a.href;
        if (!href) continue;
        var name = (a.textContent || '').trim();
        // Remove image alt text and whitespace noise
        name = name.replace(/\s+/g, ' ').trim();
        if (name.length > 100) name = '';
        results.push({ url: href, name: name });
      }
      return results;
    });
  }

  function processLinks(links: Array<{ url: string; name: string }>): void {
    for (var lk of links) {
      var pidMatch = lk.url.match(/[?&]pid=(\d+)/);
      if (!pidMatch) continue;
      var pid = pidMatch[1];

      var catMatch = lk.url.match(/[?&]cat=(\d+)/);
      var catCode = catMatch ? catMatch[1] : '';

      if (catCode && !tiemcoIsLureCat(catCode)) continue;

      if (seenPids.has(pid)) continue;
      seenPids.add(pid);

      products.push({ url: lk.url, name: lk.name || pid });
    }
  }

  // 1. Main category pages with pagination
  for (var config of TIEMCO_CATEGORY_CONFIGS) {
    var pno = 1;
    while (true) {
      var catUrl = TIEMCO_BASE_URL + '/Form/Product/ProductList.aspx?cat=' + config.cat + '&bid=lurefishing&dpcnt=40&pno=' + pno;
      try {
        await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(PAGE_LOAD_DELAY_MS);

        var links = await extractLinks();
        log('[tiemco] ' + config.label + ' page ' + pno + ': ' + links.length + ' links');

        if (links.length === 0) break;
        processLinks(links);
        if (links.length < 40) break;
        pno++;
      } catch (err) {
        var errMsg = err instanceof Error ? err.message : String(err);
        logError('[tiemco] Failed to crawl ' + config.label + ' page ' + pno + ': ' + errMsg);
        break;
      }
    }
  }

  // 2. Search-based pages for smaller categories
  for (var swrd of TIEMCO_SEARCH_KEYWORDS) {
    var searchUrl = TIEMCO_BASE_URL + '/Form/Product/ProductList.aspx?swrd=' + swrd + '&bid=lurefishing&dpcnt=40&pno=1';
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_LOAD_DELAY_MS);
      var searchLinks = await extractLinks();
      log('[tiemco] Search "' + decodeURIComponent(swrd) + '": ' + searchLinks.length + ' links');
      processLinks(searchLinks);
    } catch (err) {
      var errMsg2 = err instanceof Error ? err.message : String(err);
      logError('[tiemco] Failed search "' + swrd + '": ' + errMsg2);
    }
  }

  log('[tiemco] Discovered ' + products.length + ' unique products');
  return products;
}

// ---------------------------------------------------------------------------
// Manufacturer registry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RAID JAPAN discovery logic
// ---------------------------------------------------------------------------

var RAID_BASE_URL = 'http://raidjapan.com';
var RAID_LISTING_PAGES = [
  { url: `${RAID_BASE_URL}/?page_id=43`, label: 'Lures' },
  { url: `${RAID_BASE_URL}/?page_id=14122`, label: 'Backyard' },
];

async function discoverRaid(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts = new Map<string, { url: string; name: string }>();

  for (var config of RAID_LISTING_PAGES) {
    log(`[raid] Fetching ${config.label}: ${config.url}`);
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    var products = await page.evaluate(function () {
      var links = document.querySelectorAll('a[href*="?product="]');
      var results: { slug: string; name: string }[] = [];
      for (var i = 0; i < links.length; i++) {
        var el = links[i] as HTMLAnchorElement;
        var href = el.href;
        var match = href.match(/[?&]product=([^&#]+)/);
        if (!match) continue;
        var slug = match[1];
        // Try to get product name from child elements or alt text
        var img = el.querySelector('img') as HTMLImageElement | null;
        var nameText = img ? (img.alt || '') : (el.textContent?.trim() || '');
        results.push({ slug: slug, name: nameText });
      }
      return results;
    });

    for (var p of products) {
      if (!allProducts.has(p.slug)) {
        allProducts.set(p.slug, {
          url: `${RAID_BASE_URL}/?product=${p.slug}`,
          name: p.name || p.slug,
        });
      }
    }

    log(`[raid] ${config.label}: ${products.length} links (${allProducts.size} unique total)`);
  }

  log(`[raid] Discovered ${allProducts.size} unique products`);
  return Array.from(allProducts.values());
}

// ---------------------------------------------------------------------------
// Nories discovery logic
// ---------------------------------------------------------------------------

// Bass categories to EXCLUDE
var NORIES_BASS_EXCLUDE_CATE_IDS = [7, 11]; // rods, accessories
// Bass slugs to EXCLUDE (miscategorized non-lure products)
var NORIES_BASS_EXCLUDE_SLUGS = [
  'black-performance-treble-hooks', 'aging-bass-liquid',
  'bitepowder-ebi', 'bitebass-liquid',
];
// Salt lure slugs (everything else is rods/jigheads)
var NORIES_SALT_LURE_SLUGS = ['oyster-minnow-92'];
// Trout slugs to EXCLUDE (rods + accessories)
var NORIES_TROUT_EXCLUDE_SLUGS = [
  'spike-arrow', 'escloser', 'ambitious-craque',
  'fish-releaser-ns-01', 'trout-tackle-storage-ns-01_pa', 'feed',
];

async function discoverNories(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];

  // --- Bass: WP REST API ---
  log('[nories] Fetching bass products via WP REST API...');
  var apiPage = 1;
  while (true) {
    var apiUrl = `https://nories.com/wp-json/wp/v2/bass?per_page=100&page=${apiPage}&_fields=slug,basscate,link,title`;
    var res = await fetch(apiUrl);
    if (!res.ok) break;
    var items: any[] = await res.json();
    if (items.length === 0) break;

    for (var item of items) {
      var cats: number[] = item.basscate || [];
      var excluded = cats.some(function (c: number) {
        return NORIES_BASS_EXCLUDE_CATE_IDS.includes(c);
      });
      if (excluded || NORIES_BASS_EXCLUDE_SLUGS.includes(item.slug)) continue;
      allProducts.push({
        url: item.link,
        name: item.title?.rendered || item.slug,
      });
    }
    apiPage++;
  }
  log(`[nories] Bass lures: ${allProducts.length}`);

  // --- Salt ---
  for (var saltSlug of NORIES_SALT_LURE_SLUGS) {
    allProducts.push({
      url: `https://nories.com/salt/${saltSlug}/`,
      name: saltSlug,
    });
  }
  log(`[nories] Added ${NORIES_SALT_LURE_SLUGS.length} salt lure(s)`);

  // --- Trout: listing page ---
  log('[nories] Fetching trout products...');
  await page.goto('https://trout.nories.com/products/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  var troutLinks = await page.evaluate(function () {
    var h2s = document.querySelectorAll('h2');
    var luresH2: HTMLElement | null = null;
    var accessoriesH2: HTMLElement | null = null;
    for (var i = 0; i < h2s.length; i++) {
      var text = (h2s[i].textContent || '').trim();
      if (text === 'LURES') luresH2 = h2s[i] as HTMLElement;
      if (text === 'ACCESSORIES') accessoriesH2 = h2s[i] as HTMLElement;
    }
    if (!luresH2) return [];
    var links: string[] = [];
    var current: Node | null = luresH2.nextSibling;
    while (current) {
      if (current === accessoriesH2) break;
      if (current instanceof HTMLElement) {
        if (current.tagName === 'H2') break;
        var anchors = current.querySelectorAll('a[href*="/products/"]');
        for (var j = 0; j < anchors.length; j++) {
          var href = (anchors[j] as HTMLAnchorElement).href;
          if (href.includes('/products/') && !href.endsWith('/products/')) links.push(href);
        }
      }
      current = current.nextSibling;
    }
    return links;
  });

  var seenTrout = new Set<string>();
  for (var tLink of troutLinks) {
    var tMatch = tLink.match(/\/products\/([^/]+)\/?$/);
    if (!tMatch) continue;
    var tSlug = tMatch[1];
    if (NORIES_TROUT_EXCLUDE_SLUGS.includes(tSlug) || seenTrout.has(tSlug)) continue;
    seenTrout.add(tSlug);
    allProducts.push({
      url: `https://trout.nories.com/products/${tSlug}/`,
      name: tSlug,
    });
  }
  log(`[nories] Trout lures: ${seenTrout.size}`);
  log(`[nories] Discovered ${allProducts.length} total lure products`);
  return allProducts;
}

// ---------------------------------------------------------------------------
// Rapala (rapala.co.jp) — 5 brands: Rapala, Storm, Blue Fox, Luhr-Jensen, North Craft
// ---------------------------------------------------------------------------

var RAPALA_BRAND_LISTINGS = [
  {
    name: 'Rapala',
    url: 'https://rapala.co.jp/cn4/cn5/rapala_lure.html',
    filterPrefix: '/cn4/cn5/',
    excludeKeywords: ['_top', 'rapala_lure', 'rapala_tool', 'rapala_cap', 'rapala_bag', 'line_top', 'rapala_sun', 'rod_reel', 'globe', 'tshirt'],
  },
  {
    name: 'Storm',
    url: 'https://rapala.co.jp/cn6/cn26/stormlure_top.html',
    filterPrefix: '/cn6/',
    excludeKeywords: ['_top', 'stormlure', 'storm_top', 'tool_top'],
  },
  {
    name: 'Blue Fox',
    url: 'https://rapala.co.jp/cn7/bluefoxlure_top.html',
    filterPrefix: '/cn7/',
    excludeKeywords: ['_top', 'bluefox'],
  },
  {
    name: 'Luhr-Jensen',
    url: 'https://rapala.co.jp/cn9/cn17/luhr_jensen_top.html',
    filterPrefix: '/cn9/cn17/',
    excludeKeywords: ['_top', 'luhr_jensen_top'],
  },
  {
    name: 'North Craft',
    url: 'https://rapala.co.jp/cn10/nrothcraft_top.html',
    filterPrefix: '/cn10/',
    excludeKeywords: ['_top', 'nrothcraft_top'],
  },
];

async function discoverRapala(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  for (var brand of RAPALA_BRAND_LISTINGS) {
    log(`[rapala] Crawling ${brand.name}: ${brand.url}`);
    await page.goto(brand.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    var links: string[] = await page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*=".html"]');
      var results: string[] = [];
      for (var i = 0; i < anchors.length; i++) {
        var href = (anchors[i] as HTMLAnchorElement).href;
        if (results.indexOf(href) === -1) results.push(href);
      }
      return results;
    });

    var filterPrefix = brand.filterPrefix;
    var excludeKeywords = brand.excludeKeywords;

    var productUrls = links.filter(function (l) {
      if (l.indexOf(filterPrefix) === -1) return false;
      for (var kw of excludeKeywords) {
        if (l.indexOf(kw) >= 0) return false;
      }
      return true;
    });

    for (var u of productUrls) {
      if (seen.has(u)) continue;
      seen.add(u);
      // Extract short name from URL filename
      var nameMatch = u.match(/\/([^/]+)\.html$/);
      var shortName = nameMatch ? nameMatch[1].toUpperCase() : u;
      allProducts.push({ url: u, name: `${brand.name} ${shortName}` });
    }
    log(`[rapala] ${brand.name}: ${productUrls.length} product URLs`);
  }

  log(`[rapala] Discovered ${allProducts.length} total lure products`);
  return allProducts;
}

// ---------------------------------------------------------------------------
// Maria (Yamaria) — /maria/product/gm/plug (3 pages, 12/page)
// ---------------------------------------------------------------------------

var MARIA_LISTING_PAGES = [
  'https://www.yamaria.co.jp/maria/product/gm/plug',
  'https://www.yamaria.co.jp/maria/product/gm/plug?absolutepage=2',
  'https://www.yamaria.co.jp/maria/product/gm/plug?absolutepage=3',
];

async function discoverMaria(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  for (var i = 0; i < MARIA_LISTING_PAGES.length; i++) {
    var listUrl = MARIA_LISTING_PAGES[i];
    log(`[maria] Crawling page ${i + 1}/${MARIA_LISTING_PAGES.length}: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    var items: Array<{ url: string; name: string }> = await page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="/product/detail/"]');
      var results: Array<{ url: string; name: string }> = [];
      for (var j = 0; j < anchors.length; j++) {
        var href = (anchors[j] as HTMLAnchorElement).href;
        var name = (anchors[j].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        results.push({ url: href, name: name || href });
      }
      return results;
    });

    for (var item of items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      allProducts.push(item);
    }
    log(`[maria] Page ${i + 1}: ${items.length} links, ${allProducts.length} unique so far`);
  }

  log(`[maria] Discovered ${allProducts.length} total lure products`);
  return allProducts;
}

// ---------------------------------------------------------------------------
// Bassday — 6 category pages, JS rendering required
// ---------------------------------------------------------------------------

var BASSDAY_CATEGORIES = [
  'https://www.bassday.co.jp/item/?c=1',  // ネイティブトラウト
  'https://www.bassday.co.jp/item/?c=2',  // エリア/フレッシュウォーター
  'https://www.bassday.co.jp/item/?c=4',  // ソルトウォーター
  'https://www.bassday.co.jp/item/?c=5',  // ライトソルト
  'https://www.bassday.co.jp/item/?c=6',  // オフショア
  'https://www.bassday.co.jp/item/?c=7',  // バス
];

async function discoverBassday(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<string>();

  for (var i = 0; i < BASSDAY_CATEGORIES.length; i++) {
    var catUrl = BASSDAY_CATEGORIES[i];
    log(`[bassday] Crawling category ${i + 1}/${BASSDAY_CATEGORIES.length}: ${catUrl}`);
    await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS rendering — wait for content
    await page.waitForTimeout(3000);

    var items: Array<{ id: string; name: string }> = await page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="?i="]');
      var results: Array<{ id: string; name: string }> = [];
      for (var j = 0; j < anchors.length; j++) {
        var href = (anchors[j] as HTMLAnchorElement).getAttribute('href') || '';
        var match = href.match(/[?&]i=(\d+)/);
        if (!match) continue;
        // Name from h4 (Japanese name) inside the link
        var h4 = anchors[j].querySelector('h4');
        var name = h4 ? (h4.textContent || '').replace(/[\s\u3000]+/g, ' ').trim() : '';
        // Fallback to h3 (English name)
        if (!name) {
          var h3 = anchors[j].querySelector('h3');
          name = h3 ? (h3.textContent || '').replace(/[\s\u3000]+/g, ' ').trim() : '';
        }
        results.push({ id: match[1], name: name || ('bassday-' + match[1]) });
      }
      return results;
    });

    var newCount = 0;
    for (var item of items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      allProducts.push({
        url: 'https://www.bassday.co.jp/item/?i=' + item.id,
        name: item.name,
      });
      newCount++;
    }
    log(`[bassday] Category ${i + 1}: ${items.length} links, ${newCount} new, ${allProducts.length} total`);
  }

  log(`[bassday] Discovered ${allProducts.length} total lure products`);
  return allProducts;
}

// ---------------------------------------------------------------------------
// Jackson — 2 category pages (salt + trout), SSR HTML
// ---------------------------------------------------------------------------

var JACKSON_CATEGORIES = [
  'https://jackson.jp/?pt=products&cat=salt&s=',
  'https://jackson.jp/?pt=products&cat=trout&s=',
];

// Rod tags to exclude from lure discovery
var JACKSON_ROD_TAGS = ['rod', 'native rod', 'area rod'];

async function discoverJackson(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenSlugs = new Set<string>();

  for (var i = 0; i < JACKSON_CATEGORIES.length; i++) {
    var catUrl = JACKSON_CATEGORIES[i];
    log(`[jackson] Crawling category ${i + 1}/${JACKSON_CATEGORIES.length}: ${catUrl}`);
    await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    var items: Array<{ url: string; name: string; tags: string[] }> = await page.evaluate(function () {
      var results: Array<{ url: string; name: string; tags: string[] }> = [];
      var links = document.querySelectorAll('ul.comListUl.flex > li > a');
      for (var j = 0; j < links.length; j++) {
        var anchor = links[j] as HTMLAnchorElement;
        var href = anchor.getAttribute('href') || '';
        if (href.indexOf('/products/') < 0) continue;

        // Product name from span.ttl
        var ttlSpan = anchor.querySelector('span.ttl');
        var name = ttlSpan ? (ttlSpan.textContent || '').replace(/[\s\u3000]+/g, ' ').trim() : '';

        // Category tags from span.tagList > span.info
        var tagEls = anchor.querySelectorAll('span.tagList span.info');
        var tags: string[] = [];
        for (var ti = 0; ti < tagEls.length; ti++) {
          var tagText = (tagEls[ti].textContent || '').trim();
          if (tagText) tags.push(tagText);
        }

        results.push({ url: href, name: name, tags: tags });
      }
      return results;
    });

    var newCount = 0;
    for (var item of items) {
      // Extract slug
      var slugMatch = item.url.match(/\/products\/([^/?#]+)/);
      if (!slugMatch) continue;
      var slug = slugMatch[1];
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      // Skip if any tag matches rod tags
      var isRod = false;
      for (var ti2 = 0; ti2 < item.tags.length; ti2++) {
        if (JACKSON_ROD_TAGS.indexOf(item.tags[ti2].toLowerCase().trim()) >= 0) {
          isRod = true;
          break;
        }
      }
      if (isRod) continue;

      allProducts.push({
        url: item.url.indexOf('http') === 0 ? item.url : 'https://jackson.jp' + item.url,
        name: item.name || slug,
      });
      newCount++;
    }
    log(`[jackson] Category ${i + 1}: ${items.length} links, ${newCount} new, ${allProducts.length} total`);
  }

  log(`[jackson] Discovered ${allProducts.length} total lure products`);
  return allProducts;
}

// ---------------------------------------------------------------------------
// Gamakatsu — WP REST API (no Playwright needed), filter lure bodies from hooks
// ---------------------------------------------------------------------------

// Gamakatsu "lure" category (p_category=108) contains mostly hooks.
// These keywords in product names indicate hooks/accessories to exclude.
var GAMAKATSU_EXCLUDE_PATTERNS = [
  // Hooks (generic)
  /ジグヘッド/i, /アシストフック/i, /トレブルフック/i, /シングルフック/i,
  /ワームフック/i, /オフセットフック/i, /マス針/i, /チヌ針/i,
  /ソルトウォーターフック/i, /ツインフック/i, /ダブルフック/i,
  /替えフック/i, /スペアフック/i, /サポートフック/i,
  /ジギングフック/i, /ジグフック/i, /トレーラーフック/i,
  // Treble hooks: トレブル XX / SP / RB series
  /^トレブル\s/i, /^トレブル$/i,
  // Jig hooks: ジグ 29/31 etc.
  /^ジグ\s\d/i,
  // Named hook lines
  /^TR-\d/i, /^SC\d/i, /^ダブル\s\d/i,
  /ワーム\s*\d{3}/i, // ワーム 316, 318, 322, 329, 333 etc.
  /HYDROLL/i,
  /アウトバーブ/i, /剛双牙/i,
  // Assist hooks / lines
  /^アシスト\s/i, /アシストライン/i,
  // Jig heads (named products)
  /ホリゾンヘッド/i, /ボトムノッカー/i, /キャロヘッド/i,
  /ミニフットボール/i, /レンジスイマー/i, /スイミングショット/i,
  /マイクロダーター/i,
  // Hook series
  /セオライズ/i, /エリートツアラー/i, /ブリスペシャル/i,
  /ソアリンロール/i, /LDマスター/i,
  // Rig / leader / accessories
  /ファイターズリング/i, /スナップ/i, /リーダー/i,
  /シンカー/i, /ジカリグ/i, /ビフテキリグ/i, /フリーリグ/i,
  /サーベルポイント/i, /スイベル/i, /ダブルクレン/i,
  /シリコンスカート/i, /PEジョインター/i, /音速PE/i,
  /チューンドヘッド/i, /チューンド管/i,
  /AJカスタム/i, /コブラ/i, /P-?フレックス/i,
  /カモフラージュ/i,
  // Spare parts
  /スペアテール/i, /スペアパーツ/i,
  // ウェイテッドフック
  /ウェイテッドフック/i,
  // テンヤ / ラバージグ (heads, not lure bodies)
  /テンヤ/i, /^ラバ(ー)?ジグ/i,
  // Worm hooks with product-line name
  /^宵姫.*(ヘッド|フック|リグ|リーダー)/i,
  /^桜幻.*(フック|ネクタイ|スカート|スイベル)/i,
  // ワインドマスター: some are jig heads, some are lure sets
  /ワインドマスター.*ヘッド/i, /ワインドマスター.*セット/i,
  // ラン＆ガン キャロライナ (rig)
  /ラン＆ガン/i, /ラン&ガン/i,
  // サーモンリグ / 海サクラ (salmon rig/hook)
  /サーモンリグ/i, /海サクラ/i,
  // ジョイントノッカー (jig head with hooks, not lure body)
  /ジョイントノッカー/i,
  // ツイン SP M (twin hook, not lure)
  /^ツイン\sSP/i,
  // 宵姫 ラウンド (jig head)
  /宵姫\sラウンド/i,
  // ワインドトレーラー (trailer hooks for winding rigs)
  /ワインドトレーラー/i,
];

// Product IDs that are confirmed NOT lure bodies (hooks/accessories/jigheads)
var GAMAKATSU_EXCLUDE_IDS = new Set([
  // Worm hooks, assist hooks, jigheads, accessories etc.
  // These were identified during initial product classification
]);

async function discoverGamakatsu(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<string>();
  var page2 = 1;
  var perPage = 100;
  var totalPages = 1;

  log('[gamakatsu] Fetching products from WP REST API (p_category=108)...');

  while (page2 <= totalPages) {
    var apiUrl = 'https://www.gamakatsu.co.jp/wp-json/wp/v2/products?p_category=108&per_page=' + perPage + '&page=' + page2;
    var res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      log('[gamakatsu] API error on page ' + page2 + ': ' + res.status);
      break;
    }

    // Get total pages from header on first request
    if (page2 === 1) {
      var totalPagesHeader = res.headers.get('X-WP-TotalPages');
      if (totalPagesHeader) totalPages = parseInt(totalPagesHeader, 10);
      var totalItems = res.headers.get('X-WP-Total');
      log('[gamakatsu] Total items in category: ' + (totalItems || '?') + ', pages: ' + totalPages);
    }

    var products: Array<{ id: number; title: { rendered: string }; link: string; slug: string }> = await res.json();

    for (var pi = 0; pi < products.length; pi++) {
      var prod = products[pi];
      var prodName = prod.title.rendered.replace(/<[^>]+>/g, '').trim();
      var prodUrl = prod.link;
      var prodId = String(prod.id);
      var prodSlug = prod.slug;

      if (seenIds.has(prodId)) continue;
      seenIds.add(prodId);

      // Skip excluded IDs
      if (GAMAKATSU_EXCLUDE_IDS.has(prodSlug)) continue;

      // Skip if name matches exclusion patterns (hooks/accessories)
      var excluded = false;
      for (var ei = 0; ei < GAMAKATSU_EXCLUDE_PATTERNS.length; ei++) {
        if (GAMAKATSU_EXCLUDE_PATTERNS[ei].test(prodName)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;

      allProducts.push({ url: prodUrl, name: prodName });
    }

    log('[gamakatsu] Page ' + page2 + '/' + totalPages + ': ' + products.length + ' items, ' + allProducts.length + ' lures so far');
    page2++;
    await sleep(200);
  }

  log('[gamakatsu] Discovered ' + allProducts.length + ' lure products (filtered from ' + seenIds.size + ' total)');
  return allProducts;
}

// ---------------------------------------------------------------------------
// issei — WordPress sitemap XML (no REST API for CPTs)
// ---------------------------------------------------------------------------

async function discoverIssei(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var sitemaps = [
    'https://issei.tv/wp-sitemap-posts-green_cray_fish-1.xml',
    'https://issei.tv/wp-sitemap-posts-umitaro-1.xml',
  ];

  for (var si = 0; si < sitemaps.length; si++) {
    var sitemapUrl = sitemaps[si];
    var label = si === 0 ? 'bass' : 'salt';
    log('[issei] Fetching sitemap (' + label + '): ' + sitemapUrl);

    try {
      var res = await fetch(sitemapUrl);
      if (!res.ok) {
        logError('[issei] Sitemap fetch failed: ' + res.status);
        continue;
      }
      var xml = await res.text();
      var locMatches = xml.match(/<loc>([^<]+)<\/loc>/g);
      if (!locMatches) {
        log('[issei] No <loc> entries found in ' + label + ' sitemap');
        continue;
      }

      for (var li = 0; li < locMatches.length; li++) {
        var locMatch = locMatches[li].match(/<loc>([^<]+)<\/loc>/);
        if (!locMatch) continue;
        var prodUrl = locMatch[1].trim();
        // Extract post ID from URL as name placeholder
        var idMatch = prodUrl.match(/\/(\d+)\.html$/);
        var prodName = idMatch ? label + '-' + idMatch[1] : prodUrl;
        allProducts.push({ url: prodUrl, name: prodName });
      }

      log('[issei] ' + label + ' sitemap: ' + locMatches.length + ' URLs');
    } catch (err: any) {
      logError('[issei] Sitemap error (' + label + '): ' + (err.message || err));
    }

    await sleep(500);
  }

  log('[issei] Discovered ' + allProducts.length + ' total products from sitemaps');
  return allProducts;
}

// ---------------------------------------------------------------------------
// Gary Yamamoto — Yoast SEO sitemaps (not wp-sitemap)
// ---------------------------------------------------------------------------

var GARY_YAMAMOTO_SITEMAPS = [
  'https://www.gary-yamamoto.com/sitemap-pt-products-2022-11.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2021-08.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2021-03.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2020-12.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2020-08.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2020-06.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2020-02.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2020-01.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2019-12.xml',
  'https://www.gary-yamamoto.com/sitemap-pt-products-2019-07.xml',
];

var GARY_YAMAMOTO_EXCLUDED_SLUGS = [
  'meshcap', 'cap2', 'lightningcap', 'flatbillcap', 'flatbillmeshcap', 'sunvisor',
  'tshirt', 'drytshirt', 'longtshirt', 'yamamoto_tshirt', 'hoodjacket',
  'sticker', 'gy-sticker', 'dokuro-sticker', 'dokuro-sticker-mini', 'cutting-sticker', 'ban18-sticker',
  'sugoihook', 'sugoihookonikko', 'specialhook', 'footballjighead',
  'sugoisinker', 'tiki-tiki-sinker', 'nyantamasinker',
  'yabai-meshcap', 'yabaiflatbillmeshcap',
  'yabai-low-cap', 'yabai-sunvisor',
  'yabaiapparel',
  'kawabe01',
];

var GARY_YAMAMOTO_EXCLUDED_KEYWORDS = [
  'sticker', 'meshcap', 'tshirt', 'sunvisor', 'low-cap',
  'hoodjacket', 'apparel',
];

async function discoverGaryYamamoto(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var allUrls: string[] = [];
  var seenUrls = new Set<string>();

  for (var si = 0; si < GARY_YAMAMOTO_SITEMAPS.length; si++) {
    var sitemapUrl = GARY_YAMAMOTO_SITEMAPS[si];
    log('[gary-yamamoto] Fetching sitemap ' + (si + 1) + '/' + GARY_YAMAMOTO_SITEMAPS.length + '...');

    try {
      var res = await fetch(sitemapUrl);
      if (!res.ok) {
        logError('[gary-yamamoto] Sitemap fetch failed (' + res.status + '): ' + sitemapUrl);
        continue;
      }
      var xml = await res.text();
      var locMatches = xml.match(/<loc>([^<]+)<\/loc>/g);
      if (!locMatches) continue;

      for (var li = 0; li < locMatches.length; li++) {
        var locMatch = locMatches[li].match(/<loc>([^<]+)<\/loc>/);
        if (!locMatch) continue;
        var prodUrl = locMatch[1].trim();
        if (!seenUrls.has(prodUrl)) {
          seenUrls.add(prodUrl);
          allUrls.push(prodUrl);
        }
      }
    } catch (err: any) {
      logError('[gary-yamamoto] Sitemap error: ' + (err.message || err));
    }

    await sleep(200);
  }

  log('[gary-yamamoto] Total URLs from sitemaps: ' + allUrls.length);

  // Filter out non-lure products
  var allProducts: Array<{ url: string; name: string }> = [];
  for (var ui = 0; ui < allUrls.length; ui++) {
    var url = allUrls[ui];

    // Extract last path segment as slug
    var pathParts = url.replace(/\/$/, '').split('/');
    var slug = pathParts[pathParts.length - 1];
    var decodedSlug = decodeURIComponent(slug).toLowerCase();

    // Skip category index pages (e.g., /products/gary/, /products/yabai/)
    if (/\/products\/(gary|yabai)\/?$/.test(url)) continue;
    // Skip category sub-pages (e.g., /products/gary/singletailgrub/)
    if (/\/products\/(gary|yabai)\/[a-z_-]+\/?$/.test(url) && !/\/products\/(gary|yabai)\/[^/]+\/[^/]+/.test(url)) {
      // This is a category page like /products/gary/curlytail — check if it's a known category
      // Product URLs have the form /products/{slug} (no gary/yabai prefix in Airtable)
    }

    // Check excluded slugs
    if (GARY_YAMAMOTO_EXCLUDED_SLUGS.indexOf(slug) >= 0) continue;
    if (GARY_YAMAMOTO_EXCLUDED_SLUGS.indexOf(decodedSlug) >= 0) continue;

    // Check excluded keywords
    var keywordExcluded = false;
    for (var ki = 0; ki < GARY_YAMAMOTO_EXCLUDED_KEYWORDS.length; ki++) {
      if (decodedSlug.indexOf(GARY_YAMAMOTO_EXCLUDED_KEYWORDS[ki]) >= 0) {
        keywordExcluded = true;
        break;
      }
    }
    if (keywordExcluded) continue;

    allProducts.push({ url: url, name: slug });
  }

  log('[gary-yamamoto] After filtering: ' + allProducts.length + ' products (from ' + allUrls.length + ' total URLs)');
  return allProducts;
}

// ---------------------------------------------------------------------------
// ValleyHill — Category page crawling (WordPress + Welcart, no usable sitemap)
// ---------------------------------------------------------------------------

var VALLEYHILL_CATEGORIES = [
  '/category/item/salt-water/genrelist/tipruneging',
  '/category/item/salt-water/genrelist/tachiuo',
  '/category/item/salt-water/genrelist/ika-metal',
  '/category/item/salt-water/genrelist/flatfish',
  '/category/item/salt-water/genrelist/ajing',
  '/category/item/salt-water/genrelist/tako',
  '/category/item/salt-water/genrelist/rock-fish',
  '/category/item/salt-water/genrelist/shoregame',
  '/category/item/salt-water/genrelist/eging',
  '/category/item/salt-water/genrelist/jigging',
  '/category/item/salt-water/genrelist/tai',
  '/category/item/fresh-water/fw-genrelist/fw-hardlure',
  '/category/item/fresh-water/fw-genrelist/fw-worm',
  '/category/item/fresh-water/fw-genrelist/fw-catfish',
  '/category/item/fresh-water/fw-genrelist/snakehead',
  '/category/item/kamiwaza/kamiwaza-lure',
  '/category/item/kamiwaza/kamiwaza-jig',
];

async function discoverValleyhill(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<string>();

  for (var ci = 0; ci < VALLEYHILL_CATEGORIES.length; ci++) {
    var catPath = VALLEYHILL_CATEGORIES[ci];
    var catUrl = 'https://valleyhill1.jp' + catPath;
    var catName = catPath.split('/').pop() || catPath;

    log('[valleyhill] Crawling category: ' + catName);

    try {
      await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      var urls = await page.evaluate(function() {
        var links: string[] = [];
        document.querySelectorAll('a').forEach(function(el) {
          var href = (el as HTMLAnchorElement).href || '';
          var m = href.match(/valleyhill1\.jp\/(\d+)\/?$/);
          if (m) links.push(m[1]);
        });
        return links.filter(function(v, i, a) { return a.indexOf(v) === i; });
      });

      for (var ui = 0; ui < urls.length; ui++) {
        var productId = urls[ui];
        if (!seenIds.has(productId)) {
          seenIds.add(productId);
          allProducts.push({
            url: 'https://valleyhill1.jp/' + productId,
            name: 'Product ' + productId,
          });
        }
      }

      log('[valleyhill] ' + catName + ': ' + urls.length + ' products');
    } catch (err: any) {
      logError('[valleyhill] Category error (' + catName + '): ' + (err.message || err));
    }

    await sleep(1000);
  }

  log('[valleyhill] Discovered ' + allProducts.length + ' total unique products from ' + VALLEYHILL_CATEGORIES.length + ' categories');
  return allProducts;
}

// ---------------------------------------------------------------------------
// Major Craft discovery logic
// ---------------------------------------------------------------------------

async function discoverMajorcraft(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[majorcraft] Crawling lure listing page...');

  await page.goto('https://www.majorcraft.co.jp/lure/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  var products = await page.evaluate(function() {
    var results: Array<{ url: string; name: string }> = [];
    var seen: Record<string, boolean> = {};

    // All product links on the listing page
    var links = document.querySelectorAll('a[href*="/lure/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i] as HTMLAnchorElement;
      var href = a.href || '';

      // Only product detail pages: /lure/{slug}/ (not /lure/?lure_cate=xxx)
      var m = href.match(/\/lure\/([^?/]+)\/?$/);
      if (!m) continue;

      var slug = m[1];
      // Skip the main listing page itself
      if (slug === 'lure') continue;

      // Normalize URL
      var normalizedUrl = 'https://www.majorcraft.co.jp/lure/' + slug + '/';
      if (seen[normalizedUrl]) continue;
      seen[normalizedUrl] = true;

      // Try to get name from the link text or nearby elements
      var name = (a.textContent || '').trim();
      if (!name || name.length < 2) {
        // Try parent element text
        var parent = a.parentElement;
        if (parent) {
          name = (parent.textContent || '').trim().substring(0, 60);
        }
      }
      if (!name || name.length < 2) {
        name = decodeURIComponent(slug);
      }

      results.push({ url: normalizedUrl, name: name });
    }
    return results;
  });

  log('[majorcraft] Discovered ' + products.length + ' unique products from listing page');
  return products;
}

// ---------------------------------------------------------------------------
// YAMASHITA — 8 category pages with pagination, 12 items/page
// ---------------------------------------------------------------------------

var YAMASHITA_CATEGORIES = [
  'https://www.yamaria.co.jp/yamashita/product/gy/eging',
  'https://www.yamaria.co.jp/yamashita/product/gy/squid',
  'https://www.yamaria.co.jp/yamashita/product/gy/octpass',
  'https://www.yamaria.co.jp/yamashita/product/gy/hairtail',
  'https://www.yamaria.co.jp/yamashita/product/gy/widgets',
  'https://www.yamaria.co.jp/yamashita/product/gy/cushion',
  'https://www.yamaria.co.jp/yamashita/product/gy/takobeito',
  'https://www.yamaria.co.jp/yamashita/product/gy/other',
];

async function discoverYamashita(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  for (var ci = 0; ci < YAMASHITA_CATEGORIES.length; ci++) {
    var catUrl = YAMASHITA_CATEGORIES[ci];
    var catName = catUrl.split('/').pop() || 'unknown';

    // First, get total count from page 1 to calculate pagination
    await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    var firstPageData = await page.evaluate(function () {
      var r = { totalCount: 0, links: [] as Array<{ url: string; name: string }> };

      // Total count from "XX件" text
      var bodyText = document.body.textContent || '';
      var countMatch = bodyText.match(/(\d+)\s*件/);
      if (countMatch) r.totalCount = parseInt(countMatch[1], 10);

      // Product links on this page
      var anchors = document.querySelectorAll('a[href*="/product/detail/"]');
      for (var i = 0; i < anchors.length; i++) {
        var href = (anchors[i] as HTMLAnchorElement).href;
        // Skip ec.yamaria.com links
        if (href.indexOf('ec.yamaria.com') >= 0) continue;
        // Must be yamashita product detail
        if (href.indexOf('/yamashita/product/detail/') < 0) continue;
        var name = (anchors[i].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        r.links.push({ url: href, name: name || href });
      }
      return r;
    });

    // Add page 1 results
    for (var item of firstPageData.links) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      allProducts.push(item);
    }
    log('[yamashita] ' + catName + ' page 1: ' + firstPageData.links.length + ' links, total=' + firstPageData.totalCount + '件, unique so far=' + allProducts.length);

    // Calculate remaining pages (12 items per page)
    var totalPages = Math.ceil(firstPageData.totalCount / 12);
    for (var pageNum = 2; pageNum <= totalPages; pageNum++) {
      var pageUrl = catUrl + '?cmdarticlesearch=1&posted_sort=d&absolutepage=' + pageNum;
      log('[yamashita] ' + catName + ' page ' + pageNum + '/' + totalPages + ': ' + pageUrl);

      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      var pageData = await page.evaluate(function () {
        var links: Array<{ url: string; name: string }> = [];
        var anchors = document.querySelectorAll('a[href*="/product/detail/"]');
        for (var i = 0; i < anchors.length; i++) {
          var href = (anchors[i] as HTMLAnchorElement).href;
          if (href.indexOf('ec.yamaria.com') >= 0) continue;
          if (href.indexOf('/yamashita/product/detail/') < 0) continue;
          var name = (anchors[i].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          links.push({ url: href, name: name || href });
        }
        return links;
      });

      for (var pItem of pageData) {
        if (seen.has(pItem.url)) continue;
        seen.add(pItem.url);
        allProducts.push(pItem);
      }
      log('[yamashita] ' + catName + ' page ' + pageNum + ': ' + pageData.length + ' links, unique so far=' + allProducts.length);
    }
  }

  log('[yamashita] Discovered ' + allProducts.length + ' total unique products across all categories');
  return allProducts;
}

// ---------------------------------------------------------------------------
// IMAKATSU discovery
// ---------------------------------------------------------------------------

var IMAKATSU_CATEGORIES = [
  'https://www.imakatsu.co.jp/hard-lure/',
  'https://www.imakatsu.co.jp/soft-lure/',
  'https://www.imakatsu.co.jp/other-lure/',
];

async function discoverImakatsu(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenUrls = new Set<string>();

  for (var catUrl of IMAKATSU_CATEGORIES) {
    log('[imakatsu] Crawling category: ' + catUrl);
    await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    var products = await page.evaluate(function () {
      var items = document.querySelectorAll('section.product_list li a');
      var results: Array<{ url: string; name: string }> = [];
      for (var i = 0; i < items.length; i++) {
        var a = items[i] as HTMLAnchorElement;
        var href = a.href || '';
        var p = a.querySelector('p');
        var name = p ? p.textContent?.trim() || '' : a.textContent?.trim() || '';
        if (href) results.push({ url: href, name: name });
      }
      return results;
    });

    for (var p of products) {
      // Skip legacy www2 links
      if (p.url.includes('www2.imakatsu.co.jp')) {
        log('[imakatsu] Skipping legacy URL: ' + p.url);
        continue;
      }
      // Skip webshop links
      if (p.url.includes('imakatsu-webshop.jp')) continue;
      // Skip external links
      if (!p.url.includes('imakatsu.co.jp')) continue;
      // Normalize double slashes in path
      var normalized = p.url.replace(/([^:])\/\//g, '$1/');
      if (!seenUrls.has(normalized)) {
        seenUrls.add(normalized);
        allProducts.push({ url: normalized, name: p.name });
      }
    }

    log('[imakatsu] Category ' + catUrl.split('/').filter(Boolean).pop() + ': ' + products.length + ' links, unique so far=' + allProducts.length);
  }

  log('[imakatsu] Discovered ' + allProducts.length + ' total unique products');
  return allProducts;
}

// ---------------------------------------------------------------------------
// BOTTOMUP discovery
// ---------------------------------------------------------------------------

var BOTTOMUP_LISTING_URL = 'https://bottomup.info/products/';

// Accessory slugs to exclude (non-lure products)
var BOTTOMUP_ACCESSORY_SLUGS = new Set([
  'artis2020newcolor', 'bottomup-trucker-meshcap', 'bup-sunvisor',
  'bup-flat-cap', 'bottomupventilationworkcap',
  'bottomup-complete-measure-sheet-mesh-type2024',
  'bottomup-rod-holder-quick-shot', 'curl-rod-holder-hard',
  'curl-rod-holder', 'bottomupcuttingsticker',
]);

async function discoverBottomup(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[bottomup] Crawling product listing: ' + BOTTOMUP_LISTING_URL);
  await page.goto(BOTTOMUP_LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  var products = await page.evaluate(function () {
    var results: Array<{ url: string; name: string; category: string }> = [];
    var blocks = document.querySelectorAll('div.block01');
    for (var b = 0; b < blocks.length; b++) {
      var anchor = blocks[b].querySelector('a[name]');
      var category = anchor ? anchor.getAttribute('name') || '' : '';
      var links = blocks[b].querySelectorAll('ul.list-products > li > a');
      for (var i = 0; i < links.length; i++) {
        var a = links[i] as HTMLAnchorElement;
        var href = a.href || '';
        var name = a.textContent?.trim() || '';
        results.push({ url: href, name: name, category: category });
      }
    }
    return results;
  });

  // Filter: exclude accessory category and known accessory slugs
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenUrls = new Set<string>();

  for (var p of products) {
    // Skip accessory category
    if (p.category === 'accessory') {
      log('[bottomup] Skipping accessory: ' + p.name);
      continue;
    }
    // Check slug against accessory list
    var slugMatch = p.url.match(/\/products\/([^\/]+)\/?/);
    var slug = slugMatch ? slugMatch[1] : '';
    if (BOTTOMUP_ACCESSORY_SLUGS.has(slug)) {
      log('[bottomup] Skipping accessory slug: ' + slug);
      continue;
    }
    if (!seenUrls.has(p.url)) {
      seenUrls.add(p.url);
      allProducts.push({ url: p.url, name: p.name });
    }
  }

  log('[bottomup] Discovered ' + allProducts.length + ' lure products (excluded ' + (products.length - allProducts.length) + ' accessories)');
  return allProducts;
}

// ---------------------------------------------------------------------------
// Fish Arrow — WordPress REST API (categories 6=Bass, 7=Salt only)
// ---------------------------------------------------------------------------

// Category IDs to INCLUDE (lures only)
var FISHARROW_LURE_CATEGORY_IDS = new Set([6, 7]); // Bass, Salt

async function discoverFisharrow(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<string>();

  log('[fisharrow] Fetching products from WP REST API...');

  var apiUrl = 'https://fisharrow.co.jp/wp-json/wp/v2/product?per_page=100';
  var res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    log('[fisharrow] API error: ' + res.status);
    return allProducts;
  }

  var totalItems = res.headers.get('X-WP-Total');
  log('[fisharrow] Total items from API: ' + (totalItems || '?'));

  var products: Array<{
    id: number;
    title: { rendered: string };
    link: string;
    slug: string;
    'product-category': number[];
  }> = await res.json();

  for (var pi = 0; pi < products.length; pi++) {
    var prod = products[pi];
    var prodId = String(prod.id);
    if (seenIds.has(prodId)) continue;
    seenIds.add(prodId);

    // Filter by category: only include Bass (6) and Salt (7)
    var categories = prod['product-category'] || [];
    var hasLureCategory = false;
    for (var ci = 0; ci < categories.length; ci++) {
      if (FISHARROW_LURE_CATEGORY_IDS.has(categories[ci])) {
        hasLureCategory = true;
        break;
      }
    }
    if (!hasLureCategory) {
      var prodName0 = prod.title.rendered.replace(/<[^>]+>/g, '').trim();
      log('[fisharrow] Skipping non-lure category: ' + prodName0);
      continue;
    }

    var prodName = prod.title.rendered.replace(/<[^>]+>/g, '').trim();
    var prodUrl = prod.link;

    allProducts.push({ url: prodUrl, name: prodName });
  }

  log('[fisharrow] Discovered ' + allProducts.length + ' lure products (filtered from ' + seenIds.size + ' total)');
  return allProducts;
}

// ---------------------------------------------------------------------------
// Keitech — Custom CMS, product listing at /pages/636/
// ---------------------------------------------------------------------------

// Page IDs to exclude: non-product pages (rods, terminal tackle, categories, blogs, info)
var KEITECH_EXCLUDED_PAGE_IDS = new Set([
  '628', '629', '600', '589',  // Custom Rods
  '616', '573', '22', '23', '24', '25', '160',  // Terminal Tackle (jig heads, weights)
  '543', '462', '466', '555', '540', '644', '496',  // Category listing pages
  '469', '502', '501', '500', '499',  // Blog / message pages
  '637',  // Events
  '618', '542',  // Weights & Jig Heads category pages
  '3', '457', '4', '0',  // Contact, Sitemap, Privacy, Details link
]);

async function discoverKeitech(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];

  log('[keitech] Navigating to product listing: /pages/636/');
  await page.goto('https://keitech.co.jp/pages/636/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(PAGE_LOAD_DELAY_MS);

  // Extract all product links from the listing page
  var links = await page.evaluate(function() {
    var results: Array<{ url: string; name: string; pageId: string }> = [];
    var seen = new Set();
    var allLinks = document.querySelectorAll('a[href*="/pages/"]');
    for (var i = 0; i < allLinks.length; i++) {
      var href = allLinks[i].getAttribute('href') || '';
      var match = href.match(/\/pages\/(\d+)\/?/);
      if (!match) continue;
      var pageId = match[1];
      if (pageId === '636') continue; // Skip listing page itself
      if (seen.has(pageId)) continue;
      seen.add(pageId);

      // Get name from link text or nearest text content
      var name = (allLinks[i].textContent || '').trim();
      // If link wraps an image, try parent or sibling text
      if (!name || name.length < 2) {
        var parent = allLinks[i].closest('.record');
        if (parent) {
          var textEl = parent.querySelector('.text-design-set-area');
          if (textEl) {
            name = (textEl.textContent || '').trim().split('\n')[0].trim();
          }
        }
      }
      if (!name) name = 'Page ' + pageId;

      var fullUrl = 'https://keitech.co.jp/pages/' + pageId + '/';
      results.push({ url: fullUrl, name: name, pageId: pageId });
    }
    return results;
  });

  log('[keitech] Found ' + links.length + ' total product links');

  for (var li = 0; li < links.length; li++) {
    var link = links[li];
    if (KEITECH_EXCLUDED_PAGE_IDS.has(link.pageId)) {
      log('[keitech] Excluding (rod/terminal): ' + link.name + ' (page ' + link.pageId + ')');
      continue;
    }
    allProducts.push({ url: link.url, name: link.name });
  }

  log('[keitech] Discovered ' + allProducts.length + ' lure products (filtered from ' + links.length + ' total)');
  return allProducts;
}

// ---------------------------------------------------------------------------
// Sawamura — WordPress + Welcart, karil.co.jp
// ---------------------------------------------------------------------------

// Sawamura-specific subcategory IDs (lures only, exclude jig heads cat=47,48)
var SAWAMURA_LURE_CATS = [42, 81, 41, 40, 39, 49, 46, 45, 44, 43];
// cat=47 (ワンナップ魂) and cat=48 (ワンナップ魂オフセット) are jig heads = terminal tackle

async function discoverSawamura(page: Page): Promise<Array<{ url: string; name: string }>> {
  var allProducts: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<string>();

  for (var ci = 0; ci < SAWAMURA_LURE_CATS.length; ci++) {
    var catId = SAWAMURA_LURE_CATS[ci];
    var pageNum = 1;

    while (true) {
      var catUrl = 'https://karil.co.jp/?cat=' + catId;
      if (pageNum > 1) catUrl += '&paged=' + pageNum;

      log('[sawamura] Fetching cat=' + catId + ' page=' + pageNum);
      await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(PAGE_LOAD_DELAY_MS);

      var links = await page.evaluate(function() {
        var results: Array<{ url: string; name: string; postId: string }> = [];
        var articles = document.querySelectorAll('article');
        for (var i = 0; i < articles.length; i++) {
          var link = articles[i].querySelector('a[href*="?p="]');
          if (!link) continue;
          var href = link.getAttribute('href') || '';
          var match = href.match(/[?&]p=(\d+)/);
          if (!match) continue;

          var nameEl = articles[i].querySelector('h2, .item-name, h3');
          var name = nameEl ? (nameEl.textContent || '').trim() : 'Product ' + match[1];
          // Clean name: remove "サワムラ" prefix for cleaner display
          name = name.replace(/^サワムラ\s*/u, '').trim();

          results.push({ url: 'https://karil.co.jp/?p=' + match[1], name: name, postId: match[1] });
        }
        return results;
      });

      if (links.length === 0) break;

      for (var li = 0; li < links.length; li++) {
        if (!seenIds.has(links[li].postId)) {
          seenIds.add(links[li].postId);
          allProducts.push({ url: links[li].url, name: links[li].name });
        }
      }

      // Check if there's a next page
      var hasNext = await page.evaluate(function() {
        var nextLink = document.querySelector('a.next, .nav-next a, a[rel="next"]');
        return !!nextLink;
      });
      if (!hasNext) break;
      pageNum++;
    }
  }

  log('[sawamura] Discovered ' + allProducts.length + ' lure products (from ' + seenIds.size + ' unique IDs)');
  return allProducts;
}

// ---------------------------------------------------------------------------
// DSTYLE — dstyle-lure.co.jp (WordPress, custom post type "products")
// All products listed on /products/ page in sections: soft-lure, hard-lure,
// jackalldstyle (joint project), jigs. Exclude ROD and ACCESSORY.
// ---------------------------------------------------------------------------

var DSTYLE_EXCLUDED_SECTIONS = ['rod', 'accessory'];

// ---------------------------------------------------------------------------
// Ecogear (ecogear.jp) — WordPress REST API for ecogear + fishleague CPTs
// ---------------------------------------------------------------------------

async function discoverEcogear(_page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[ecogear] Fetching products via WP REST API...');

  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  // Fetch ecogear CPT (paginate)
  var ecogearPage = 1;
  while (true) {
    var ecogearUrl = 'https://ecogear.jp/wp-json/wp/v2/ecogear?per_page=100&page=' + ecogearPage + '&_fields=id,slug,title,link';
    log('[ecogear] Fetching: ' + ecogearUrl);
    var res = await fetch(ecogearUrl);
    if (!res.ok) break;
    var items: Array<{ id: number; slug: string; title: { rendered: string }; link: string }> = await res.json();
    if (items.length === 0) break;
    for (var i = 0; i < items.length; i++) {
      var url = items[i].link;
      var name = items[i].title.rendered.replace(/&#\d+;/g, '').replace(/&amp;/g, '&').trim();
      if (url && !seen.has(url)) {
        seen.add(url);
        results.push({ url: url, name: name });
      }
    }
    ecogearPage++;
    if (items.length < 100) break;
  }

  // Fetch fishleague CPT
  var flUrl = 'https://ecogear.jp/wp-json/wp/v2/fishleague?per_page=100&_fields=id,slug,title,link';
  log('[ecogear] Fetching FishLeague: ' + flUrl);
  var flRes = await fetch(flUrl);
  if (flRes.ok) {
    var flItems: Array<{ id: number; slug: string; title: { rendered: string }; link: string }> = await flRes.json();
    for (var fi = 0; fi < flItems.length; fi++) {
      var flUrlItem = flItems[fi].link;
      var flName = flItems[fi].title.rendered.replace(/&#\d+;/g, '').replace(/&amp;/g, '&').trim();
      if (flUrlItem && !seen.has(flUrlItem)) {
        seen.add(flUrlItem);
        results.push({ url: flUrlItem, name: flName });
      }
    }
  }

  log('[ecogear] Total discovered: ' + results.length + ' products');
  return results;
}

async function discoverDstyle(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[dstyle] Fetching product listing from /products/');
  await page.goto('https://dstyle-lure.co.jp/products/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  var products = await page.evaluate(function() {
    var results: Array<{ url: string; name: string; section: string }> = [];
    var seen = new Set();

    // Find all product cards
    var cards = document.querySelectorAll('div.box-products');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var linkEl = card.querySelector('p.link-products a');
      if (!linkEl) continue;

      var url = linkEl.getAttribute('href') || '';
      var name = (linkEl.textContent || '').trim();
      if (!url || !name) continue;

      // Determine which section this card belongs to
      // Walk up from card to find preceding anchor[name] or h3.tit-03
      var section = 'unknown';
      var prev = card.previousElementSibling;
      var walkLimit = 50;
      while (prev && walkLimit > 0) {
        // Check for section anchor: <a name="soft-lure">
        var anchor = prev.querySelector('a[name]');
        if (anchor) {
          section = anchor.getAttribute('name') || 'unknown';
          break;
        }
        if (prev.tagName === 'A' && prev.getAttribute('name')) {
          section = prev.getAttribute('name') || 'unknown';
          break;
        }
        prev = prev.previousElementSibling;
        walkLimit--;
      }

      if (!seen.has(url)) {
        seen.add(url);
        results.push({ url: url, name: name, section: section });
      }
    }
    return results;
  });

  // Filter out excluded sections (rod, accessory)
  var lureProducts = products.filter(function(p) {
    for (var i = 0; i < DSTYLE_EXCLUDED_SECTIONS.length; i++) {
      if (p.section === DSTYLE_EXCLUDED_SECTIONS[i]) return false;
    }
    return true;
  });

  log('[dstyle] Found ' + products.length + ' total products, ' + lureProducts.length + ' lure products (excluded ' + (products.length - lureProducts.length) + ' non-lure)');

  return lureProducts.map(function(p) {
    return { url: p.url, name: p.name };
  });
}

// ---------------------------------------------------------------------------
// GEECRACK discover
// ---------------------------------------------------------------------------

var GEECRACK_LURE_CATEGORIES = [
  // Bass
  { prefix: 'bass', category: 'hard_lure' },
  { prefix: 'bass', category: 'soft_lure' },
  { prefix: 'bass', category: 'wire_bait' },
  { prefix: 'bass', category: 'jig' },
  // Saltwater
  { prefix: 'saltwater', category: 'ika' },
  { prefix: 'saltwater', category: 'aji' },
  { prefix: 'saltwater', category: 'aomono' },
  { prefix: 'saltwater', category: 'tai' },
  { prefix: 'saltwater', category: 'seabass' },
  { prefix: 'saltwater', category: 'rockfish' },
];

async function discoverGeecrack(page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[geecrack] Discovering products from category pages...');

  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  for (var ci = 0; ci < GEECRACK_LURE_CATEGORIES.length; ci++) {
    var cat = GEECRACK_LURE_CATEGORIES[ci];
    var catUrl = 'https://www.geecrack.com/' + cat.prefix + '/product/' + cat.category + '/';
    log('[geecrack] Fetching category: ' + cat.prefix + '/' + cat.category);

    try {
      await page.goto(catUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      var products = await page.evaluate(function() {
        var items: Array<{ url: string; name: string }> = [];
        // Product links are in the listing area — a tags with href containing /detail/?id=
        var allLinks = document.querySelectorAll('a[href*="detail/?id="]');
        for (var i = 0; i < allLinks.length; i++) {
          var href = allLinks[i].getAttribute('href') || '';
          var text = (allLinks[i].textContent || '').trim();
          // Skip links with no text (thumbnail links) — they duplicate the named links
          if (!text || text.length < 2) continue;
          // Normalize: extract only the first line (English name)
          var name = text.split('\n')[0].trim();
          items.push({ url: href, name: name });
        }
        return items;
      });

      for (var pi = 0; pi < products.length; pi++) {
        var prodUrl = products[pi].url;
        // Normalize URL to absolute
        if (!prodUrl.startsWith('http')) {
          prodUrl = 'https://www.geecrack.com' + prodUrl;
        }
        // Extract id for dedup
        var idMatch = prodUrl.match(/id=(\d+)/);
        var idKey = idMatch ? idMatch[1] : prodUrl;
        if (!seen.has(idKey)) {
          seen.add(idKey);
          results.push({ url: prodUrl, name: products[pi].name });
        }
      }

      log('[geecrack]   ' + cat.prefix + '/' + cat.category + ': ' + products.length + ' links, ' + results.length + ' unique total');

    } catch (err: any) {
      log('[geecrack]   ERROR fetching ' + catUrl + ': ' + err.message);
    }
  }

  log('[geecrack] Total discovered: ' + results.length + ' unique products');
  return results;
}

// ---------------------------------------------------------------------------
// REINS — reinsfishing.com (WC Store API, no Playwright needed)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Berkley — purefishing.jp sitemap-based discovery (no Playwright needed)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ENGINE — engine.rings-fishing.jp
// ---------------------------------------------------------------------------

var ENGINE_CATEGORIES = [
  'https://engine.rings-fishing.jp/syouhin/soft-bait/',
  'https://engine.rings-fishing.jp/syouhin/hard-bait/',
  'https://engine.rings-fishing.jp/syouhin/loops/',
  'https://engine.rings-fishing.jp/syouhin/collaboration/',
];

async function discoverEngine(_page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[engine] Discovering products from category pages...');

  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  for (var ci = 0; ci < ENGINE_CATEGORIES.length; ci++) {
    var catUrl = ENGINE_CATEGORIES[ci];
    log('[engine] Fetching category: ' + catUrl);

    var resp = await fetch(catUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!resp.ok) {
      log('[engine] WARNING: Failed to fetch category ' + catUrl + ' (' + resp.status + ')');
      continue;
    }

    var html = await resp.text();

    // Extract product links: <li><a href="...page2/{slug}/"><img...><span>Name</span></a></li>
    var linkPattern = /<li>\s*<a\s+href="(https:\/\/engine\.rings-fishing\.jp\/page2\/[^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>\s*<\/a>\s*<\/li>/g;
    var match;

    while ((match = linkPattern.exec(html)) !== null) {
      var url = match[1];
      var name = match[2].trim();
      // Normalize URL: ensure trailing slash
      if (!url.endsWith('/')) url = url + '/';
      // Decode percent-encoded URLs
      try { url = decodeURIComponent(url); } catch (e) { /* keep as-is */ }

      if (!seen.has(url)) {
        seen.add(url);
        results.push({ url: url, name: name });
      }
    }
  }

  log('[engine] Discovered ' + results.length + ' products');
  return results;
}

// ---------------------------------------------------------------------------
// HIDEUP — hideup.jp
// Single page at /product/ contains all products organized by category.
// Products are linked as <a href="/product/{slug}.php"> in sidebar nav.
// Categories to include: Hard lures, Soft lures, Jigs, Umbrella Rig, Saltwater, Retreex
// Categories to exclude: Fishing Rods, Tools, RCMF, Apparel, Discon items
// ---------------------------------------------------------------------------

var HIDEUP_EXCLUDED_SLUGS = [
  'rod_recommendation', 'macca', 'Red_macca', 'macca_red_signature', // Rods
  'cblm', 'amistopper', 'HU-3010NDM', 'HU-3020NDDM', 'HU-3043NDD', // Tools
  'RCMF2019', 'RCMF', 'RCMF_Fishing_Tee_2020', 'RCMF_parka_2020', 'RCMF_parka_2021', // RCMF merch
  'mesh_cap_stream_logo', 'hu-slc', 'mesh-cap', 'knitcap', // Apparel
  'hood_neck_warmer', 'hood_neck_warmer_sweat', 'facecover2020', 'facecover', // Apparel
  'saltwater', // Saltwater color page (not a product)
];

async function discoverHideup(_page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[hideup] Discovering products from /product/ listing page...');

  var listingUrl = 'https://hideup.jp/product/';
  var resp = await fetch(listingUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  if (!resp.ok) {
    log('[hideup] WARNING: Failed to fetch listing page (' + resp.status + ')');
    return [];
  }

  var html = await resp.text();

  // Extract all product links: <a href="/product/{slug}.php">Name</a>
  // Also capture links from banner area: <a href="{slug}.php">
  var results: Array<{ url: string; name: string }> = [];
  var seenSlugs: Record<string, boolean> = {};

  // Pattern 1: sidebar nav links with explicit /product/ prefix
  var linkPattern1 = /<a\s+href="\/product\/([^"]+\.php)"[^>]*>([^<]*)<\/a>/g;
  var m1;
  while ((m1 = linkPattern1.exec(html)) !== null) {
    var slug1 = m1[1].replace(/\.php$/, '');
    var name1 = m1[2].trim();
    if (!slug1 || !name1) continue;
    if (seenSlugs[slug1]) continue;
    if (HIDEUP_EXCLUDED_SLUGS.indexOf(slug1) >= 0) continue;

    seenSlugs[slug1] = true;
    results.push({
      url: 'https://hideup.jp/product/' + slug1 + '.php',
      name: name1,
    });
  }

  // Pattern 2: banner area links with relative paths (e.g., <a href="slide_fall_jig.php">)
  var linkPattern2 = /<a\s+href="([a-zA-Z0-9_\-]+\.php)"[^>]*>/g;
  var m2;
  while ((m2 = linkPattern2.exec(html)) !== null) {
    var slug2 = m2[1].replace(/\.php$/, '');
    if (!slug2) continue;
    if (seenSlugs[slug2]) continue;
    if (HIDEUP_EXCLUDED_SLUGS.indexOf(slug2) >= 0) continue;

    // Try to get name from nearby img alt or text
    var nameContext = html.substring(m2.index, m2.index + 500);
    var altMatch = nameContext.match(/alt="([^"]*)"/);
    var prodName = altMatch ? altMatch[1] : slug2;

    seenSlugs[slug2] = true;
    results.push({
      url: 'https://hideup.jp/product/' + slug2 + '.php',
      name: prodName,
    });
  }

  log('[hideup] Discovered ' + results.length + ' products');
  return results;
}

var BERKLEY_EXCLUDED_URL_PARTS = ['/line/', '/acse/', '/bag/'];
var BERKLEY_EXCLUDED_NAME_PARTS = [
  'fireline', 'vanish', 'trilene', 'x5 ', 'x9 ', 'super fireline',
  'messenger bag', 'mesh cap', 'jacket', 'cutter', 'clipper', 'plier',
  'net', 'scale', 'stringer', 'inflatable',
];

async function discoverBerkley(_page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[berkley] Discovering products via sitemap.xml...');

  var sitemapUrl = 'https://www.purefishing.jp/sitemap.xml';
  var resp = await fetch(sitemapUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!resp.ok) throw new Error('Failed to fetch sitemap: ' + resp.status);

  var xml = await resp.text();

  // Extract all Berkley product URLs ending with .html
  var urlPattern = /<loc>(https:\/\/www\.purefishing\.jp\/product\/berkley\/[^<]+\.html)<\/loc>/g;
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();
  var match;

  while ((match = urlPattern.exec(xml)) !== null) {
    var url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);

    // Exclude non-lure URLs
    var excluded = false;
    for (var ei = 0; ei < BERKLEY_EXCLUDED_URL_PARTS.length; ei++) {
      if (url.indexOf(BERKLEY_EXCLUDED_URL_PARTS[ei]) >= 0) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    // Extract name from URL slug: last segment without .html
    var slug = url.replace(/\.html$/, '').split('/').pop() || '';
    var name = slug.replace(/-/g, ' ');

    // Exclude by name keywords
    var nameLower = name.toLowerCase();
    for (var ni = 0; ni < BERKLEY_EXCLUDED_NAME_PARTS.length; ni++) {
      if (nameLower.indexOf(BERKLEY_EXCLUDED_NAME_PARTS[ni]) >= 0) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    results.push({ url: url, name: name });
  }

  // Also crawl category pages for products not in sitemap
  var catBaseUrl = 'https://www.purefishing.jp/product/berkley/cat/';
  for (var pageNum = 1; pageNum <= 10; pageNum++) {
    var catUrl = pageNum === 1 ? catBaseUrl : catBaseUrl + 'index_' + pageNum + '.html';
    try {
      var catResp = await fetch(catUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (!catResp.ok) break;
      var catHtml = await catResp.text();
      var linkPattern = /href="(\/product\/berkley\/[^"]+\.html)"/g;
      var linkMatch;
      while ((linkMatch = linkPattern.exec(catHtml)) !== null) {
        var fullUrl = 'https://www.purefishing.jp' + linkMatch[1];
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);

        // Check exclusions
        var excl = false;
        for (var ei = 0; ei < BERKLEY_EXCLUDED_URL_PARTS.length; ei++) {
          if (fullUrl.indexOf(BERKLEY_EXCLUDED_URL_PARTS[ei]) >= 0) { excl = true; break; }
        }
        if (excl) continue;

        var catSlug = fullUrl.replace(/\.html$/, '').split('/').pop() || '';
        var catName = catSlug.replace(/-/g, ' ');
        var catNameLower = catName.toLowerCase();
        for (var ni = 0; ni < BERKLEY_EXCLUDED_NAME_PARTS.length; ni++) {
          if (catNameLower.indexOf(BERKLEY_EXCLUDED_NAME_PARTS[ni]) >= 0) { excl = true; break; }
        }
        if (excl) continue;

        results.push({ url: fullUrl, name: catName });
      }
    } catch (e) {
      break;
    }
    // Small delay
    await new Promise(function(resolve) { setTimeout(resolve, 500); });
  }

  log('[berkley] Found ' + results.length + ' product URLs');
  return results;
}

var REINS_LURE_CATEGORY_SLUGS = [
  'soft-baits', 'worms', 'craws-creatures', 'swimbaits',
];

async function discoverReins(_page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[reins] Discovering products via WC Store API...');

  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();
  var pageNum = 1;

  while (true) {
    var apiUrl = 'https://www.reinsfishing.com/wp-json/wc/store/products?per_page=100&page=' + pageNum;
    log('[reins] Fetching page ' + pageNum + ': ' + apiUrl);

    var response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      log('[reins] API returned ' + response.status + ', stopping pagination');
      break;
    }

    var products: any[] = await response.json();
    if (!products || products.length === 0) break;

    log('[reins] Page ' + pageNum + ': ' + products.length + ' products');

    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var categorySlugs: string[] = (p.categories || []).map(function(c: any) { return c.slug; });

      // Must have 'reins' category
      if (categorySlugs.indexOf('reins') < 0) continue;

      // Must have at least one lure category
      var isLure = false;
      for (var ci = 0; ci < REINS_LURE_CATEGORY_SLUGS.length; ci++) {
        if (categorySlugs.indexOf(REINS_LURE_CATEGORY_SLUGS[ci]) >= 0) {
          isLure = true;
          break;
        }
      }

      // Also check: lure products have pa_color attribute
      if (!isLure) {
        var hasColor = false;
        var attrs = p.attributes || [];
        for (var ai = 0; ai < attrs.length; ai++) {
          if (attrs[ai].taxonomy === 'pa_color') {
            hasColor = true;
            break;
          }
        }
        if (!hasColor) continue;
      }

      var permalink = p.permalink || '';
      var name = (p.name || '').replace(/&#8243;/g, '″').replace(/&#8217;/g, '\u2019').replace(/&#8211;/g, '–').replace(/&amp;/g, '&');

      if (!permalink || seen.has(permalink)) continue;
      seen.add(permalink);

      results.push({ url: permalink, name: name });
    }

    pageNum++;
  }

  log('[reins] Total discovered: ' + results.length + ' lure products');
  return results;
}

// ---------------------------------------------------------------------------
// Manufacturer configurations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Little Jack discovery logic
// ---------------------------------------------------------------------------

async function discoverLittleJack(_page: Page): Promise<Array<{ url: string; name: string }>> {
  log('[littlejack] Discovering products via WP REST API (template=page-lp.php)...');

  // Little Jack uses WordPress with LP pages (page-lp.php template) for products
  // NOTE: Pretty permalinks disabled → use ?rest_route= instead of /wp-json/
  var apiUrl = 'https://www.little-jack-lure.com/?rest_route=/wp/v2/pages&per_page=100&_fields=id,title,template,status';
  var resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });

  if (!resp.ok) {
    log('[littlejack] WARNING: WP REST API failed (' + resp.status + '). Trying page 2...');
    return [];
  }

  var pages = await resp.json() as Array<{ id: number; title: { rendered: string }; template: string; status: string }>;
  var results: Array<{ url: string; name: string }> = [];
  var seenIds: Record<number, boolean> = {};

  for (var i = 0; i < pages.length; i++) {
    var p = pages[i];
    if (p.status !== 'publish') continue;
    // Only include LP template pages (product pages)
    if (p.template !== 'page-lp.php') continue;
    if (seenIds[p.id]) continue;
    seenIds[p.id] = true;

    // Decode HTML entities in title
    var name = p.title.rendered
      .replace(/&#8211;/g, '–')
      .replace(/&#8212;/g, '—')
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#8217;/g, "'")
      .replace(/&#8216;/g, "'")
      .trim();

    if (!name) continue;

    results.push({
      url: 'https://www.little-jack-lure.com/?page_id=' + p.id,
      name: name,
    });
  }

  // Check if there are more pages (WP returns X-WP-TotalPages header)
  var totalPages = parseInt(resp.headers.get('X-WP-TotalPages') || '1', 10);
  if (totalPages > 1) {
    for (var pg = 2; pg <= totalPages; pg++) {
      var nextUrl = 'https://www.little-jack-lure.com/?rest_route=/wp/v2/pages&per_page=100&_fields=id,title,template,status&page=' + pg;
      var nextResp = await fetch(nextUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      if (!nextResp.ok) break;

      var nextPages = await nextResp.json() as Array<{ id: number; title: { rendered: string }; template: string; status: string }>;
      for (var j = 0; j < nextPages.length; j++) {
        var np = nextPages[j];
        if (np.status !== 'publish') continue;
        if (np.template !== 'page-lp.php') continue;
        if (seenIds[np.id]) continue;
        seenIds[np.id] = true;

        var npName = np.title.rendered
          .replace(/&#8211;/g, '–')
          .replace(/&#8212;/g, '—')
          .replace(/&#038;/g, '&')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#8217;/g, "'")
          .replace(/&#8216;/g, "'")
          .trim();

        if (!npName) continue;

        results.push({
          url: 'https://www.little-jack-lure.com/?page_id=' + np.id,
          name: npName,
        });
      }
    }
  }

  log('[littlejack] Discovered ' + results.length + ' products via WP REST API');
  return results;
}

// Little Jack excluded name keywords:
// GOODS/アクセサリーページ（フック等）はLPテンプレートを使っていないので
// WP REST API `template=page-lp.php` で自動的に除外される。
// 念のためキーワードフィルターも設定。
var LITTLEJACK_EXCLUDED_NAMES = [
  'GOODS', 'グッズ', 'アクセサリー', 'ACCESSORY',
  'フック', 'HOOK', 'パーツ', 'PARTS',
  'ロッド', 'ROD', 'リール', 'REEL',
  'バッグ', 'BAG', 'ウェア', 'WEAR',
  'キャップ', 'CAP', 'ステッカー', 'STICKER',
];

// ---- Jumprize ----
// jumprize.com — Jimdo Creator (static HTML), sitemap.xml available
// Product URLs: /lure/series{N}/{slug}/ or /lure/yukifactory/{slug}/
// Fetch-only, no Playwright needed

async function discoverJumprize(): Promise<DiscoveredProduct[]> {
  var results: DiscoveredProduct[] = [];

  // Fetch sitemap.xml
  var sitemapUrl = 'https://www.jumprize.com/sitemap.xml';
  log('[jumprize] Fetching sitemap: ' + sitemapUrl);
  var res = await fetch(sitemapUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[jumprize] HTTP ' + res.status + ' fetching sitemap');
  var xml = await res.text();

  // Extract all <loc> URLs
  var locRegex = /<loc>(.*?)<\/loc>/g;
  var locMatch: RegExpExecArray | null;
  var allUrls: string[] = [];
  while ((locMatch = locRegex.exec(xml)) !== null) {
    allUrls.push(locMatch[1]);
  }
  log('[jumprize] Sitemap URLs: ' + allUrls.length);

  // Filter product pages:
  // - Must be under /lure/ (not /metal/, /other/, etc — those are category pages)
  // - Must have at least 5 path segments (e.g. /lure/series1/rowdy130f/)
  // - Exclude category/series index pages
  var EXCLUDED_PATHS = [
    '/lure/',           // main lure index
    '/hansoku/',        // promotional pages
    '/q-a',             // Q&A page
  ];
  var SERIES_PATTERNS = /\/series\d+\/$/;

  for (var i = 0; i < allUrls.length; i++) {
    var rawUrl = allUrls[i];
    // Decode URL-encoded characters for name extraction
    var decodedUrl = decodeURIComponent(rawUrl);

    // Must be under /lure/ path
    if (decodedUrl.indexOf('/lure/') === -1) continue;

    // Must have enough path depth (product page, not category)
    var pathParts = decodedUrl.replace(/\/+$/, '').split('/');
    if (pathParts.length < 6) continue; // https://www.jumprize.com/lure/series1/product/ = 6

    // Exclude category pages and specific paths
    var isExcluded = false;
    for (var j = 0; j < EXCLUDED_PATHS.length; j++) {
      if (decodedUrl.endsWith(EXCLUDED_PATHS[j])) { isExcluded = true; break; }
    }
    if (isExcluded) continue;

    // Exclude series index pages (/lure/series1/, /lure/series2/, etc)
    if (SERIES_PATTERNS.test(decodedUrl)) continue;
    // Exclude yukifactory index
    if (decodedUrl.endsWith('/yukifactory/')) continue;

    // Extract product name from slug
    var slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
    var pName = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });

    results.push({
      url: rawUrl, // Use original (possibly encoded) URL
      name: pName,
    });
  }

  log('[jumprize] Discovered ' + results.length + ' product pages from sitemap');
  return results;
}

var JUMPRIZE_EXCLUDED_NAMES = [
  'ロッド', 'ROD', 'リール', 'REEL',
  'フック', 'HOOK', 'ライン', 'LINE',
  'バッグ', 'BAG', 'ウェア', 'WEAR',
  'アクセサリー', 'ACCESSORY', 'グッズ', 'GOODS',
];

// ---- 34 (THIRTY FOUR) ----
// 34net.jp — WordPress + custom theme, WP REST API available
// Product URLs: /products/worm/{slug}/
// Fetch-only, no Playwright needed. アジング専門メーカー

async function discoverThirtyfour(): Promise<DiscoveredProduct[]> {
  var results: DiscoveredProduct[] = [];

  // Use WP REST API to get all pages
  var apiUrl = 'https://34net.jp/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,link';
  log('[thirtyfour] Fetching pages via WP REST API: ' + apiUrl);

  var page1Res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!page1Res.ok) throw new Error('[thirtyfour] HTTP ' + page1Res.status);
  var pages: any[] = await page1Res.json();

  // Get page 2 if needed
  var totalPages = parseInt(page1Res.headers.get('X-WP-TotalPages') || '1', 10);
  if (totalPages > 1) {
    var page2Res = await fetch(apiUrl + '&page=2', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (page2Res.ok) {
      var p2 = await page2Res.json();
      pages = pages.concat(p2);
    }
  }

  log('[thirtyfour] Total WP pages: ' + pages.length);

  // Filter: only /products/worm/ pages (individual product pages, not category)
  for (var i = 0; i < pages.length; i++) {
    var pg = pages[i];
    var link = pg.link || '';

    // Include worm product pages
    if (link.indexOf('/products/worm/') !== -1 && link !== 'https://34net.jp/products/worm/') {
      var pName = pg.title && pg.title.rendered
        ? pg.title.rendered
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#8217;/g, "'")
            .replace(/&#8220;/g, '"')
            .replace(/&#8221;/g, '"')
            .trim()
        : pg.slug;
      results.push({ url: link, name: pName });
    }
  }

  log('[thirtyfour] Discovered ' + results.length + ' worm products via WP REST API');
  return results;
}

// ---------------------------------------------------------------------------
// TICT (tict-net.com) — fetch-only, Shift_JIS
// ---------------------------------------------------------------------------

async function discoverTict(): Promise<DiscoveredProduct[]> {
  var res = await fetch('https://tict-net.com/product/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[tict] HTTP ' + res.status);

  var buffer = await res.arrayBuffer();
  var decoder = new TextDecoder('shift_jis');
  var html = decoder.decode(buffer);

  var products: DiscoveredProduct[] = [];
  var seen = new Set<string>();

  // Match all product links: <a href="xxx.html" class="hover_img2">
  // and <li><a href="xxx.html">name</a></li> from the nav
  var linkRegex = /href="([a-z][a-z0-9_]+\.html)"[^>]*>(?:<img[^>]*>)?([^<]*)/gi;
  var match;
  while ((match = linkRegex.exec(html)) !== null) {
    var slug = match[1].replace('.html', '');
    if (seen.has(slug)) continue;

    // Extract name from text or from image alt
    var rawName = match[2].trim();
    if (!rawName) {
      // Try to get name from the next link in nav
      var navMatch = html.match(new RegExp('href="' + match[1] + '"[^>]*>([^<]+)<'));
      if (navMatch) rawName = navMatch[1].trim();
    }
    if (!rawName) rawName = slug;

    var url = 'https://tict-net.com/product/' + match[1];
    seen.add(slug);
    products.push({ url: url, name: rawName, maker: 'tict' });
  }

  return products;
}

var TICT_EXCLUDED_NAMES = [
  // ロッド・リール
  'SRAM', 'sram', 'ICE CUBE', 'icecube', 'UTR', 'EXR', 'MSR',
  // ライン
  'JOKER', 'SHINOBI', 'リーダー', 'leader', 'JACKBRIGHT', 'RHYME', 'ボルドーレッド', 'bordeaux',
  // ジグヘッド・Mキャロ
  'アジスタ', 'azisuta', 'メバスタ', 'mebasuta', 'キャロかぶら', 'carokabura',
  'Mキャロ', 'mcaro', 'minimcaro', 'azisutatg',
  // リグ・フック
  'laclip', 'swivel', 'lacring', 'HOOK', 'hook',
  // アクセサリー
  'バランサー', 'balancer', 'キーパー', 'keeper', 'ガイドスルー', 'guidethrough',
  'ロッドベルト', 'rodbelt', 'ティップ', 'tipcover', 'stamen', 'rodcase', 'forceps',
  'utilitycase', 'fishingmat', 'fishingpliers', 'clearpouch', 'tissuecover',
  'azishimepick', 'leaderholder', 'pacchinscale', 'rodwrap', 'slimcase', 'hangtowel',
  // バッグ・ケース・バケツ
  'slingbag', 'padbelt', 'dbelt', 'pliersholder', 'coolerbag', 'middlepouch',
  'activebag', 'pocketpouch', 'instanet', 'tacklebag', 'rodholder',
  'magreleaser', 'stool', 'versatileholder',
  'bakkan', 'livebucket', 'holderbucket', 'microbucket', 'handycase',
  'cargo', 'fbucket', 'optiontray', 'storage',
  // ステッカー
  'sticker', 'ステッカー', 'measure_sticker', 'graphicsticker',
  // パーツリスト・旧製品
  'partslist', 'oldgoods', 'expec',
  // エギ計測
  'paparazzi', 'BOTTOM COP', 'bottomcop',
  // リベルテ
  'liberte', 'Liberte',
];

var TICT_EXCLUDED_SLUGS = [
  'index', 'partslist', 'oldgoods', 'expec_index',
  'sram_utr', 'sram_utr_t2', 'sram_exr', 'sram_utr_552582t2', 'sram_utr_5558t2',
  'msr_52ap', 'msr_54mt', 'msr_7480tc', 'msr_56it', 'msr_62xss', 'msr_6372ap',
  'icecube', 'balancer',
  'liberte', 'slingbag', 'padbelt', 'dbelt', 'pliersholder', 'coolerbag',
  'middlepouch', 'activebag', 'pocketpouch', 'instanet', 'tacklebag', 'rodholder',
  'magreleaser', 'stool', 'versatileholder',
  'mcaro', 'minimcaro',
  'azisuta', 'carokabura', 'mebasuta', 'azisutatg', 'mebasuta_vc',
  'joker', 'shinobi', 'leader', 'jackbright', 'rhyme', 'bordeauxred', 'bordeauxred2',
  'laclip', 'swivel', 'lacring_snap',
  'keeper', 'guidethrough', 'rodbelt', 'tipcover', 'rodcase', 'forceps',
  'utilitycase', 'fishingmat', 'fishingpliers', 'clearpouch', 'tissuecover',
  'azishimepick', 'leaderholder', 'pacchinscale', 'rodwrap', 'slimcase', 'hangtowel',
  'stamen_case', 'stamen_case2',
  'sticker', 'graphicsticker', 'tacklesticker_viii', 'measure_sticker',
  'ompact_bakkan3', 'compact_bakkan3', 'livebucket2', 'holderbucket2', 'holderbucket_dx',
  'microbucket', 'compact_handycase', 'cargo', 'fbucket', 'optiontray', 'storage',
  'paparazzi', 'hookg2', 'bottomcop_light', 'bottomcop',
];

// ---------------------------------------------------------------------------
// NOIKE (noike-m.com) — WordPress, WP REST API
// ---------------------------------------------------------------------------

async function discoverNoike(): Promise<DiscoveredProduct[]> {
  var results: DiscoveredProduct[] = [];

  // Use WP REST API to get all pages
  var apiUrl = 'https://noike-m.com/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,link';
  log('[noike] Fetching pages via WP REST API: ' + apiUrl);

  var res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[noike] HTTP ' + res.status);
  var pages: any[] = await res.json();

  log('[noike] Total WP pages: ' + pages.length);

  for (var i = 0; i < pages.length; i++) {
    var pg = pages[i];
    var link = pg.link || '';
    var slug = pg.slug || '';

    // Skip category/info pages and non-product pages
    if (NOIKE_NON_PRODUCT_SLUGS.indexOf(slug) !== -1) continue;

    // Skip excluded slugs (sinkers, jig heads, accessories)
    var excluded = false;
    for (var e = 0; e < NOIKE_EXCLUDED_SLUGS.length; e++) {
      if (slug.indexOf(NOIKE_EXCLUDED_SLUGS[e]) !== -1) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    var pName = pg.title && pg.title.rendered
      ? pg.title.rendered
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#8217;/g, "'")
          .replace(/&#8220;/g, '\u201C')
          .replace(/&#8221;/g, '\u201D')
          .replace(/&quot;/g, '"')
          .replace(/&#0*39;/g, "'")
          .trim()
      : slug;

    results.push({ url: link, name: pName });
  }

  log('[noike] Discovered ' + results.length + ' lure products via WP REST API');
  return results;
}

var NOIKE_EXCLUDED_NAMES = [
  'シンカー', 'SINKER', 'sinker',
  'ジグヘッド', 'JIG HEAD',
  'スナップ', 'SNAP', 'snap',
  'ストッパー', 'STOPPER',
];

var NOIKE_EXCLUDED_SLUGS = [
  'tg-nail-sinker', 'tg-bullet-sinker',
  'tungsten-drop-shot', 'tungsten-dropshot',
  'sinker-stopper', 'lure-snap',
  'kemkem-head', 'kem-kem-head',
];

// Pages that are not products (category pages, info pages, etc.)
var NOIKE_NON_PRODUCT_SLUGS = [
  'soft-baits', 'blade-bait', 'equipment',
  'home', 'news', 'about', 'contact', 'privacy-policy',
  'sample-page', 'category', 'product', 'products',
  'shop', 'cart', 'checkout', 'my-account',
  'update', 'blog-2', 'dealers',
  // Japanese slugs (URL-encoded in WP)
  '%e3%83%97%e3%83%a9%e3%82%a4%e3%83%90%e3%82%b7%e3%83%bc%e3%83%9d%e3%83%aa%e3%82%b7%e3%83%bc',
  '%e3%81%8a%e5%95%8f%e3%81%84%e5%90%88%e3%82%8f%e3%81%9b',
];

var THIRTYFOUR_EXCLUDED_NAMES = [
  'ロッド', 'ROD', 'リール', 'REEL',
  'ライン', 'LINE', 'ジグヘッド', 'JIG HEAD',
  'ケース', 'CASE', 'グッズ', 'GOODS',
  'アパレル', 'APPAREL', 'DVD', 'グリス',
  'キャリー', 'ハンドル',
];

// ---------------------------------------------------------------------------
// BAIT BREATH (baitbreath.net) — static HTML, HTTP-only
// ---------------------------------------------------------------------------

async function discoverBaitBreath(): Promise<DiscoveredProduct[]> {
  var results: DiscoveredProduct[] = [];
  var listUrl = 'http://www.baitbreath.net/products%20page.html';
  log('[baitbreath] Fetching product list from: ' + listUrl);

  var res = await fetch(listUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[baitbreath] HTTP ' + res.status);
  var html = await res.text();

  // Extract all .html links
  var linkRegex = /href="([^"]*\.html)"/gi;
  var match;
  var seen = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    // Skip non-product pages
    if (/products?\s*page|index|information|bass\.html|saltwater|one\.html|goods|blog|facebook|video|channel/i.test(href)) continue;
    if (href.indexOf('link') !== -1) continue;

    var fullUrl = 'http://www.baitbreath.net/' + href;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    // Extract name from link text (image alt or nearby text)
    var pName = decodeURIComponent(href).replace(/\.html$/i, '').replace(/\s+/g, ' ').trim();
    results.push({ url: fullUrl, name: pName, maker: 'baitbreath' });
  }

  log('[baitbreath] Discovered ' + results.length + ' products');
  return results;
}

var BAITBREATH_EXCLUDED_NAMES = [
  'シンカー', 'SINKER', 'Round Caro',
  'ジグヘッド', 'JIG HEAD', 'Pine Head',
  'フォーミュラ', 'FORMULA', 'MIX FORMULA', 'UV-COMBO', 'UV COMBO',
  'M-Shaker', 'M-シェイカー',
  'キジハタ', // hub page
];

var BAITBREATH_EXCLUDED_SLUGS = [
  'bysmixformula', 'uv%20combo', 'uv-combo',
  'round%20caro', 'roundcaro',
  'pinehead', 'pine%20head',
  'm-shaker', 'm%20shaker',
  'kijihata',
];

// ---------------------------------------------------------------------------
// Palms (palmsjapan.com) — static HTML, nginx
// ---------------------------------------------------------------------------

async function discoverPalms(): Promise<DiscoveredProduct[]> {
  var results: DiscoveredProduct[] = [];
  var listUrl = 'https://www.palmsjapan.com/lures/';
  log('[palms] Fetching product list from: ' + listUrl);

  var res = await fetch(listUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[palms] HTTP ' + res.status);
  var html = await res.text();

  // Extract product links: href="/lures/product/?name={slug}" or href="//product/?name={slug}"
  var linkRegex = /href="[^"]*product\/\?name=([^"&]+)"/gi;
  var match;
  var seen = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null) {
    var slug = match[1];
    if (seen.has(slug)) continue;
    seen.add(slug);

    var fullUrl = 'https://www.palmsjapan.com/lures/product/?name=' + slug;

    // Try to get name from nearby img alt or small text
    var pName = slug.replace(/-/g, ' ');
    results.push({ url: fullUrl, name: pName, maker: 'palms' });
  }

  log('[palms] Discovered ' + results.length + ' products');
  return results;
}

var PALMS_EXCLUDED_NAMES = [
  'フック', 'HOOK', 'hook',
  'ジグヘッド', 'JIG HEAD',
  'アシスト', 'ASSIST',
  'スペア', 'SPARE',
  'チラシ', 'チヌ針',
];

var PALMS_EXCLUDED_SLUGS = [
  // Hook products to exclude
  'shore-gun-evolv-treble',
  'shore-gun-evolv-single',
  'shore-gun-evolv-assist',
  'mini-game-assist',
  'the-micro-assist',
  'smelt-tg-flasher-assist-hook',
  'f-lead-flasher-hook',
  'jighead',
];

// ---------------------------------------------------------------------------
// MADNESS (madness.co.jp) — WordPress, fetch-only
// ---------------------------------------------------------------------------

async function discoverMadness(): Promise<DiscoveredProduct[]> {
  var results: DiscoveredProduct[] = [];
  var listUrl = 'https://www.madness.co.jp/category/products';
  log('[madness] Fetching product list from: ' + listUrl);

  var res = await fetch(listUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[madness] HTTP ' + res.status);
  var html = await res.text();

  // Extract product links: <a href="URL" title="PRODUCT NAME">
  var linkRegex = /<a[^>]*href="(https?:\/\/www\.madness\.co\.jp\/products\/[^"]+)"[^>]*title="([^"]*)"[^>]*>/gi;
  var match;
  var seen = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var pName = match[2].trim();
    if (seen.has(href)) continue;
    seen.add(href);

    results.push({ url: href, name: pName || href, maker: 'madness' });
  }

  // Also try gallery links (shiriten JIG 220 emperor links to /gallery/)
  var galleryRegex = /<a[^>]*href="(https?:\/\/www\.madness\.co\.jp\/gallery\/[^"]+)"[^>]*title="([^"]*)"[^>]*>/gi;
  while ((match = galleryRegex.exec(html)) !== null) {
    var href2 = match[1];
    var pName2 = match[2].trim();
    if (seen.has(href2)) continue;
    seen.add(href2);
    results.push({ url: href2, name: pName2 || href2, maker: 'madness' });
  }

  log('[madness] Discovered ' + results.length + ' products');
  return results;
}

var MADNESS_EXCLUDED_NAMES = [
  'ジグヘッド', 'JIG HEAD', 'HEAD',
  'フォーミュラ', 'FORMULA',
];

var MADNESS_EXCLUDED_SLUGS = [
  'bakuree-head',      // ジグヘッド
  'bakuru-formula',    // 集魚剤
];

// ---------------------------------------------------------------------------
// Forest — static HTML (forestjp.com)
// Category pages: /products/area-lure/ and /products/native-lure/
// ---------------------------------------------------------------------------

async function discoverForest(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  var categories = [
    'https://forestjp.com/products/area-lure/',
    'https://forestjp.com/products/native-lure/',
  ];

  for (var ci = 0; ci < categories.length; ci++) {
    var catUrl = categories[ci];
    log('[forest] Fetching category: ' + catUrl);
    var res = await fetch(catUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) { log('[forest] HTTP ' + res.status + ' for ' + catUrl); continue; }
    var html = await res.text();

    // Product links: <a href="https://forestjp.com/products/{area-lure|native-lure}/{slug}/" title="PRODUCT_NAME">
    var linkPattern = /<a\s+href="(https?:\/\/forestjp\.com\/products\/(?:area-lure|native-lure)\/[^"]+)"\s+title="([^"]+)"/gi;
    var match;
    while ((match = linkPattern.exec(html)) !== null) {
      var href = match[1];
      var pName = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code)); }).trim();
      if (!href.endsWith('/')) href += '/';
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({ url: href, name: pName });
    }

    await sleep(500);
  }

  log('[forest] Discovered ' + results.length + ' products');
  return results;
}

// ---------------------------------------------------------------------------
// HMKL — static HTML (hmklnet.com, Shift_JIS)
// Product listing at /products/, individual pages at /products/pickup/{name}/
// ---------------------------------------------------------------------------

async function discoverHmkl(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();
  var SKIP_PAGES = ['blankmodel', 'material', 'shoporiginal', '2021lb'];

  var listUrl = 'http://www.hmklnet.com/products/';
  log('[hmkl] Fetching products listing: ' + listUrl);
  var res = await fetch(listUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[hmkl] HTTP ' + res.status);
  var buffer = Buffer.from(await res.arrayBuffer());
  var decoder = new TextDecoder('shift_jis');
  var html = decoder.decode(buffer);

  // Extract all href="pickup/XXX" links
  var linkPattern = /href="pickup\/([^"]+)"/gi;
  var match;
  while ((match = linkPattern.exec(html)) !== null) {
    var pickupName = match[1].replace(/\/$/, '').replace(/\/index\.html?$/, '');
    if (SKIP_PAGES.indexOf(pickupName.toLowerCase()) !== -1) continue;
    if (seen.has(pickupName)) continue;
    seen.add(pickupName);

    var productUrl = 'http://www.hmklnet.com/products/pickup/' + pickupName + '/';
    var displayName = pickupName.replace(/\+/g, ' ');
    results.push({ url: productUrl, name: displayName });
  }

  log('[hmkl] Discovered ' + results.length + ' products');
  return results;
}

// ---------------------------------------------------------------------------
// HOTS — hardcoded product URLs from PRODUCTS constant
// ---------------------------------------------------------------------------

async function discoverHots(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var HOTS_PRODUCTS = [
    { name: 'NS JIG', page: 'lure-ns-jig.html' },
    { name: 'KALCHI SUPER LONG JIG', page: 'lure-Kalchi-jig.html' },
    { name: 'KEITAN JIG', page: 'lure-keitan.html' },
    { name: 'Drift tune', page: 'lure-drift-tune.html' },
    { name: 'DEBUTAN JIG', page: 'lure-debutan.html' },
    { name: 'KEITAN JIG STD.', page: 'lure-keitan-std.html' },
    { name: 'KEITAN JIG Aluminum', page: 'lure-keitan-jig-alumi.html' },
    { name: 'KS JIG', page: 'lure-ks-jig.html' },
    { name: 'Otoko JIG', page: 'lure-otoko-jig.html' },
    { name: 'R2 JIG', page: 'lure-r2-jig.html' },
    { name: 'Y2 JIG', page: 'lure-y2-jig.html' },
    { name: 'Conker', page: 'lure-conker.html' },
    { name: 'CHIBITAN', page: 'lure-chibitan.html' },
    { name: 'Skill Gamma', page: 'lure-skill-gamma.html' },
    { name: 'SLASH BLADE', page: 'lure-slash-blade.html' },
    { name: 'Bigfin', page: 'lure-big-fin.html' },
    { name: 'KEIKO OCEAN BULL', page: 'lure-keiko-bull.html' },
    { name: 'KEIKO OCEAN GATARO', page: 'lure-keiko-gataro.html' },
    { name: 'KEIKO OCEAN ATTUMA', page: 'lure-keiko-attuma.html' },
    { name: 'KEIKO OCEAN CHUGAYU', page: 'lure-keiko-chugayu.html' },
    { name: 'KEIKO OCEAN', page: 'lure-keiko-ocean.html' },
    { name: 'KEIKO OCEAN POPPER Rv.', page: 'lure-keiko-popper.html' },
    { name: 'IGOSSO', page: 'lure-igosso.html' },
    { name: 'Tide Bait.Sardine', page: 'lure-tidebait.html' },
    { name: 'Chug & MiniChag', page: 'lure-chug-mini.html' },
  ];

  var results: Array<{ url: string; name: string }> = [];
  for (var i = 0; i < HOTS_PRODUCTS.length; i++) {
    results.push({
      url: 'https://hots.co.jp/' + HOTS_PRODUCTS[i].page,
      name: HOTS_PRODUCTS[i].name,
    });
  }

  log('[hots] Discovered ' + results.length + ' products (hardcoded)');
  return results;
}

// ---------------------------------------------------------------------------
// JADO (邪道) — hardcoded product URLs from PRODUCTS constant
// All products on single page: https://ja-do.jp/products
// ---------------------------------------------------------------------------

async function discoverJado(_page: Page): Promise<Array<{ url: string; name: string }>> {
  // All JADO products are on one page, with per-product tabs.
  // The scraper uses the page URL for all products.
  var JADO_PRODUCTS = [
    { name: '乱牙65', slug: 'ranga-65' },
    { name: '乱牙75', slug: 'ranga-75' },
    { name: 'ERDA零イノベーター', slug: 'erda-zero-innovator' },
    { name: 'ERDA零999', slug: 'erda-zero-999' },
    { name: 'ERDA GARURU 132F', slug: 'erda-garuru-132f' },
    { name: 'ERDA TEUFEL 125F', slug: 'erda-teufel-125f' },
    { name: 'ERDA86', slug: 'erda-86' },
    { name: '冷音', slug: 'rein' },
    { name: '冷斬', slug: 'rezan' },
    { name: 'Envy', slug: 'envy' },
    { name: 'Yore Yore', slug: 'yore-yore' },
  ];

  var results: Array<{ url: string; name: string }> = [];
  for (var i = 0; i < JADO_PRODUCTS.length; i++) {
    results.push({
      url: 'https://ja-do.jp/products',
      name: JADO_PRODUCTS[i].name,
    });
  }

  log('[ja-do] Discovered ' + results.length + ' products (hardcoded)');
  return results;
}

// ---------------------------------------------------------------------------
// MC Works — static HTML (mcworks.jp)
// Category pages at /products/prodyct_category/{slug} (note typo in real URL)
// ---------------------------------------------------------------------------

async function discoverMcWorks(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  var categorySlugs = [
    'killer-jig', 'gutter-jig', 'bunchin', 'guttup', 'catup', 'gravel', 'tarmac',
  ];

  for (var ci = 0; ci < categorySlugs.length; ci++) {
    var catUrl = 'https://www.mcworks.jp/products/prodyct_category/' + categorySlugs[ci];
    log('[mc-works] Fetching category: ' + categorySlugs[ci]);
    try {
      var res = await fetch(catUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
      });
      if (!res.ok) { log('[mc-works] HTTP ' + res.status + ' for ' + catUrl); continue; }
      var html = await res.text();

      // Product links: <a ... href="https://www.mcworks.jp/products/{id}"><h3 class="content-title"><span>{name}</h3>
      var linkRegex = /<a[^>]+href="(https?:\/\/www\.mcworks\.jp\/products\/(\d+))"[^>]*>\s*<h3\s+class="content-title">(?:<span>)?([^<]+)/gi;
      var match;
      while ((match = linkRegex.exec(html)) !== null) {
        var href = match[1];
        var pName = match[3].trim();
        if (seen.has(href)) continue;
        seen.add(href);
        results.push({ url: href, name: pName });
      }

      await sleep(300);
    } catch (err) {
      log('[mc-works] Category fetch failed (' + categorySlugs[ci] + '): ' + (err instanceof Error ? err.message : err));
    }
  }

  log('[mc-works] Discovered ' + results.length + ' products');
  return results;
}

// ---------------------------------------------------------------------------
// MUKAI — WordPress REST API (mukai-fishing.jp)
// Posts with category=4 (lure products)
// ---------------------------------------------------------------------------

async function discoverMukai(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;

  log('[mukai] Fetching lure posts from WP REST API (categories=4)...');

  while (true) {
    var apiUrl = 'https://www.mukai-fishing.jp/wp-json/wp/v2/posts?categories=4&per_page=100&page=' + pageNum + '&_fields=id,title,link,slug';
    var res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) break;
    var posts: Array<{ id: number; link: string; title: { rendered: string }; slug: string }> = await res.json();
    if (posts.length === 0) break;

    for (var i = 0; i < posts.length; i++) {
      var p = posts[i];
      var pName = p.title.rendered
        .replace(/&#\d+;/g, function(m: string) { return String.fromCharCode(parseInt(m.slice(2, -1))); })
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
      results.push({ url: p.link, name: pName });
    }

    log('[mukai] Page ' + pageNum + ': ' + posts.length + ' posts, ' + results.length + ' total');
    if (posts.length < 100) break;
    pageNum++;
    await sleep(300);
  }

  log('[mukai] Discovered ' + results.length + ' lure products via WP REST API');
  return results;
}

var MUKAI_SKIP_POST_IDS = [
  2750, 2651, 2443, 2240, 2061, 1849, 318, 264, 203,
];

// ---------------------------------------------------------------------------
// Nature Boys — WordPress REST API (e-natureboys.com)
// Pages with categories 6 (IRON JIG) and 35 (LURE)
// ---------------------------------------------------------------------------

async function discoverNatureBoys(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<number>();
  var categories = [6, 35]; // 6=IRON JIG, 35=LURE
  var SKIP_TITLES_NB = ['REUSE JIG', 'IRONWILL', 'IRONHOOK', 'IRONFLICK', 'IRONRANGE', 'IRONCAT', 'NCO REACTOR', 'SPINNING KNOTTER'];

  log('[nature-boys] Fetching pages from WP REST API...');

  for (var ci = 0; ci < categories.length; ci++) {
    var catId = categories[ci];
    var apiUrl = 'https://www.e-natureboys.com/wp-json/wp/v2/pages?categories=' + catId + '&per_page=100&_fields=id,slug,title,link,categories';
    log('[nature-boys] Fetching category ' + catId + ': ' + apiUrl);

    var res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) { log('[nature-boys] HTTP ' + res.status + ' for category ' + catId); continue; }
    var pages: Array<{ id: number; slug: string; title: { rendered: string }; link: string; categories: number[] }> = await res.json();

    for (var i = 0; i < pages.length; i++) {
      var pg = pages[i];
      if (seenIds.has(pg.id)) continue;
      seenIds.add(pg.id);

      // Skip accessories/rods
      var titleText = pg.title.rendered.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim().toUpperCase();
      var skip = false;
      for (var si = 0; si < SKIP_TITLES_NB.length; si++) {
        if (titleText.indexOf(SKIP_TITLES_NB[si]) !== -1) { skip = true; break; }
      }
      if (skip) continue;

      var pName = pg.title.rendered
        .replace(/&#\d+;/g, function(m: string) { return String.fromCharCode(parseInt(m.slice(2, -1))); })
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
      results.push({ url: pg.link, name: pName });
    }

    await sleep(300);
  }

  log('[nature-boys] Discovered ' + results.length + ' products via WP REST API');
  return results;
}

// ---------------------------------------------------------------------------
// NORTH CRAFT — static HTML (rapala.co.jp/cn10/)
// Product links from top page lure section
// ---------------------------------------------------------------------------

async function discoverNorthCraft(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  var topUrl = 'https://rapala.co.jp/cn10/nrothcraft_top.html';
  log('[north-craft] Fetching top page: ' + topUrl);
  var res = await fetch(topUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[north-craft] HTTP ' + res.status);
  var html = await res.text();

  // Extract lure section (between northcraft_lure and northcraft_cap)
  var parts1 = html.split(/id\s*=\s*["']northcraft_lure["']/i);
  var lureSection = (parts1.length > 1 ? parts1[1] : '');
  var parts2 = lureSection.split(/id\s*=\s*["']northcraft_cap["']/i);
  lureSection = parts2[0] || '';

  // Match all .html links in the lure section
  var linkPattern = /href\s*=\s*["']([^"']+\.html)["']/gi;
  var match;
  while ((match = linkPattern.exec(lureSection)) !== null) {
    var href = match[1];
    if (href.indexOf('nrothcraft_top') !== -1) continue;
    if (href.indexOf('nc_') !== -1) continue;
    if (href.indexOf('javascript') !== -1) continue;
    if (href.indexOf('index.html') !== -1) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    // Resolve relative URL
    var fullUrl;
    if (href.indexOf('http') === 0) {
      fullUrl = href;
    } else {
      var clean = href.replace(/^\.\.\/cn10\//, '').replace(/^\.\.\//, '').replace(/^cn10\//, '');
      fullUrl = 'https://rapala.co.jp/cn10/' + clean;
    }

    // Extract name from filename
    var fname = fullUrl.split('/').pop() || '';
    var pName = fname.replace('.html', '').toUpperCase();

    results.push({ url: fullUrl, name: pName });
  }

  log('[north-craft] Discovered ' + results.length + ' products');
  return results;
}

// ---------------------------------------------------------------------------
// Valkein — static HTML (valkein.jp)
// Category pages: /products/spoons/, /products/hardbaits/, /products/metalvibe/
// ---------------------------------------------------------------------------

async function discoverValkein(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();

  var categories = [
    'https://valkein.jp/products/spoons/',
    'https://valkein.jp/products/hardbaits/',
    'https://valkein.jp/products/metalvibe/',
  ];

  for (var ci = 0; ci < categories.length; ci++) {
    var catUrl = categories[ci];
    log('[valkein] Fetching category: ' + catUrl);
    var res = await fetch(catUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) { log('[valkein] HTTP ' + res.status + ' for ' + catUrl); continue; }
    var html = await res.text();

    // Product links: <a href="https://valkein.jp/products/{category}/{slug}/">
    // with product name in nearby text/heading
    // Pattern: <a href="URL"><img ... /><h3>NAME</h3> or similar
    var linkPattern = /<a\s+href="(https?:\/\/valkein\.jp\/products\/(?:spoons|hardbaits|metalvibe)\/[^"]+\/?)"[^>]*>[\s\S]*?<(?:h[23]|p|span)[^>]*>([^<]+)/gi;
    var match;
    while ((match = linkPattern.exec(html)) !== null) {
      var href = match[1];
      if (!href.endsWith('/')) href += '/';
      if (seen.has(href)) continue;
      seen.add(href);

      var pName = match[2].replace(/&amp;/g, '&').replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code)); }).trim();
      if (pName) results.push({ url: href, name: pName });
    }

    // Fallback: simpler pattern for product links
    var simpleLinkPattern = /<a\s+href="(https?:\/\/valkein\.jp\/products\/(?:spoons|hardbaits|metalvibe)\/[^"]+\/?)"[^>]*>/gi;
    while ((match = simpleLinkPattern.exec(html)) !== null) {
      var href2 = match[1];
      if (!href2.endsWith('/')) href2 += '/';
      if (seen.has(href2)) continue;
      seen.add(href2);

      // Extract name from slug
      var slugMatch = href2.match(/\/products\/(?:spoons|hardbaits|metalvibe)\/([^/]+)\/?$/);
      var slug = slugMatch ? slugMatch[1] : '';
      var slugName = slug.replace(/-/g, ' ').replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });
      results.push({ url: href2, name: slugName });
    }

    await sleep(500);
  }

  log('[valkein] Discovered ' + results.length + ' products');
  return results;
}

// ---- beat (&beat) ----
// beat-jig.com — WordPress 6.5, WP REST API
// CPT: product-item, ~25 metal jigs + rods/accessories to skip
// Fetch-only, no Playwright

var BEAT_SKIP_SLUGS = new Set([
  'propagateblx', 'propagateblxboth58', 'propagatetypes',
  'silversword', 'goose',
]);

var BEAT_SKIP_TITLE_KEYWORDS = [
  'プロパゲート', 'シルバーソード', 'グース', 'サテル',
];

async function discoverBeat(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenSlugs = new Set<string>();
  var page2 = 1;
  var totalPages = 1;

  log('[beat] Fetching products from WP REST API (product-item)...');

  while (page2 <= totalPages) {
    var apiUrl = 'https://beat-jig.com/wp-json/wp/v2/product-item?per_page=100&_embed&page=' + page2;
    var res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      log('[beat] API error on page ' + page2 + ': ' + res.status);
      break;
    }

    if (page2 === 1) {
      var totalPagesHeader = res.headers.get('X-WP-TotalPages');
      if (totalPagesHeader) totalPages = parseInt(totalPagesHeader, 10);
      log('[beat] Total pages: ' + totalPages);
    }

    var posts: Array<{ id: number; slug: string; link: string; title: { rendered: string } }> = await res.json();

    for (var bi = 0; bi < posts.length; bi++) {
      var post = posts[bi];
      var postSlug = post.slug;
      var postName = post.title.rendered.replace(/<[^>]+>/g, '').trim();

      if (seenSlugs.has(postSlug)) continue;
      seenSlugs.add(postSlug);

      if (BEAT_SKIP_SLUGS.has(postSlug)) continue;

      var skipBeat = false;
      for (var bk = 0; bk < BEAT_SKIP_TITLE_KEYWORDS.length; bk++) {
        if (postName.indexOf(BEAT_SKIP_TITLE_KEYWORDS[bk]) !== -1) { skipBeat = true; break; }
      }
      if (skipBeat) continue;

      results.push({ url: post.link, name: postName });
    }

    page2++;
    if (page2 <= totalPages) await sleep(300);
  }

  log('[beat] Discovered ' + results.length + ' products');
  return results;
}

// ---- BOREAS ----
// flashpointonlineshop.com — Shopify JSON API
// Fetch-only, no Playwright

var BOREAS_EXCLUDE_HANDLES = new Set([
  'anostsinker', 'anostsinkertg', 'anostsinkerftb', 'anosttube',
]);

var BOREAS_EXCLUDE_TYPES_LOWER = ['cap', 'hat', 't-shirt', 'tee', 'apparel', 'sticker', 'wear', 'sinker'];
var BOREAS_EXCLUDE_TITLE_LOWER = ['キャップ', 'tシャツ', 'ステッカー', 'sinker', 'シンカー', 'tube', 'チューブ', 'デニム'];

async function discoverBoreas(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var shopBase = 'https://flashpointonlineshop.com';

  log('[boreas] Fetching Shopify products.json...');
  var res = await fetch(shopBase + '/products.json?limit=250', {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('[boreas] HTTP ' + res.status);
  var data: { products: Array<{ handle: string; title: string; product_type: string }> } = await res.json();

  for (var pi2 = 0; pi2 < data.products.length; pi2++) {
    var sp = data.products[pi2];
    if (BOREAS_EXCLUDE_HANDLES.has(sp.handle)) continue;

    var titleLower = sp.title.toLowerCase();
    var typeLower = (sp.product_type || '').toLowerCase();

    var skipBoreas = false;
    for (var ti = 0; ti < BOREAS_EXCLUDE_TYPES_LOWER.length; ti++) {
      if (typeLower.indexOf(BOREAS_EXCLUDE_TYPES_LOWER[ti]) !== -1) { skipBoreas = true; break; }
    }
    if (!skipBoreas) {
      for (var ti2 = 0; ti2 < BOREAS_EXCLUDE_TITLE_LOWER.length; ti2++) {
        if (titleLower.indexOf(BOREAS_EXCLUDE_TITLE_LOWER[ti2]) !== -1) { skipBoreas = true; break; }
      }
    }
    if (skipBoreas) continue;

    results.push({
      url: shopBase + '/products/' + sp.handle,
      name: sp.title,
    });
  }

  log('[boreas] Discovered ' + results.length + ' products');
  return results;
}

// ---- BOZLES (ボーズレス) ----
// bozles.com — Square Online SPA, hardcoded product list
// Fetch-only, no Playwright

var BOZLES_LURE_PAGES = [
  { route: 'page-1', slug: 'tg-taiko-hideyoshi', name: 'TG太閤ヒデヨシ' },
  { route: 'page-2', slug: 'tg-keiji', name: 'TG太閤ケイジ' },
  { route: 'page-3', slug: 'tg-ieyasu', name: 'TGイエヤス' },
  { route: 'page-4', slug: 'tg-ranmaru', name: 'TGランマル' },
  { route: 'page-5', slug: 'tg-nobunaga', name: 'TGノブナガ' },
  { route: 'page-6', slug: 'tg-nobunaga-neo', name: 'TGノブナガNeo' },
  { route: 'page-7', slug: 'tg-drop-k', name: 'TG DROP-K' },
  { route: 'page-8', slug: 'tg-hattori', name: 'TGハットリ' },
  { route: 'page-9', slug: 'gou', name: '剛' },
  { route: 'page-10', slug: 'nobunaga-light', name: 'ノブナガライト' },
  { route: 'page-11', slug: 'yukimura', name: 'ユキムラ' },
  { route: 'page-13', slug: 'toukichirou-lead', name: 'トウキチロウ鉛' },
  { route: 'page-18', slug: 'kurama-tengu', name: '鞍馬天狗' },
  { route: 'page-19', slug: 'yukimura-slim', name: 'ユキムラスリム' },
];

async function discoverBozles(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.bozles.com';

  for (var bzi = 0; bzi < BOZLES_LURE_PAGES.length; bzi++) {
    var bp = BOZLES_LURE_PAGES[bzi];
    results.push({
      url: siteBase + '/' + bp.route,
      name: bp.name,
    });
  }

  log('[bozles] Discovered ' + results.length + ' products (hardcoded)');
  return results;
}

// ---- Carpenter ----
// carpenter.ne.jp — 100% static HTML, hardcoded product list
// Fetch-only, no Playwright

var CARPENTER_PRODUCTS = [
  { name: 'Blue Fish', pageUrl: 'product.index-lure-blue.fish/product.index-lure-blue.fish.html' },
  { name: 'Gamma', pageUrl: 'product.index-lure-gamma-n/product.index-lure-gamma-n.html' },
  { name: 'Gamma Super-L', pageUrl: 'product.index-lure-gamma-super-l/product.index-lure-gamma-super-l.html' },
  { name: 'Gamma-L', pageUrl: 'product.index-lure-gamma-l/product.index-lure-gamma-l.html' },
  { name: 'Gamma-H', pageUrl: 'product.index-lure-gamma-h/product.index-lure-gamma-h.html' },
  { name: 'Maihime', pageUrl: 'p-l-maihime/p-l-maihime.html' },
  { name: 'Gen-ei', pageUrl: 'p-l-genei/p-l-genei.html' },
  { name: 'Strike Eagle', pageUrl: 'p-l-strike.eagle/p-l-strike.eagle.html' },
  { name: 'Carpenter Hayabusa', pageUrl: 'p-l-hayabusa/p-l-hayabusa.html' },
  { name: 'Mini Eel', pageUrl: 'p-l-mini.eel/p-l-mini.eel.html' },
  { name: 'Utahime', pageUrl: 'p-l-utahime/p-l-utahime.html' },
  { name: 'BC Popper', pageUrl: 'p-l-bcp/p-l-bcp.html' },
  { name: 'Damsel Original', pageUrl: 'p-l-ds90g-o/p-l-ds90g-o.html' },
  { name: 'Damsel', pageUrl: 'p-l-damsel/p-l-damsel.html' },
  { name: 'Pandora', pageUrl: 'product.index-lure-pandora/product.index-lure-pandora.html' },
  { name: 'Zeus', pageUrl: 'product.index-lure-zeus/product.index-lure-zeus.html' },
  { name: 'Metal Jig 1501', pageUrl: 'product.index-jig-1501a-150g/product.index-jig-1501a-150g.html' },
  { name: 'Metal Jig 1505', pageUrl: 'product.index-jig-1505a-150g/product.index-jig-1505a-150g.html' },
  { name: 'Metal Jig 1506', pageUrl: 'product.index-jig-1506a-150g/product.index-jig-1506a-150g.html' },
  { name: 'Metal Jig 1510', pageUrl: 'product.index-jig-1510a-150g/product.index-jig-1510a-150g.html' },
  { name: 'Metal Jig 1515', pageUrl: 'product.index-jig-1515a-150g/product.index-jig-1515a-150g.html' },
];

async function discoverCarpenter(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'http://www.carpenter.ne.jp';

  for (var ci = 0; ci < CARPENTER_PRODUCTS.length; ci++) {
    var cp = CARPENTER_PRODUCTS[ci];
    results.push({
      url: siteBase + '/' + cp.pageUrl,
      name: cp.name,
    });
  }

  log('[carpenter] Discovered ' + results.length + ' products (hardcoded)');
  return results;
}

// ---- CB ONE ----
// cb-one.co.jp — WordPress, WP REST API
// /wp-json/wp/v2/products?per_page=100
// Fetch-only, no Playwright

var CB_ONE_SKIP_SLUGS = new Set([
  'standuptuna', 'progress', 'enfinity',  // rods
  'ssr', 'diverdown', 'braver', 'hrm',     // rods
  'hook', 'metal-parts', 'gear',            // goods
]);

async function discoverCbOne(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://cb-one.co.jp';

  log('[cb-one] Fetching products from WP REST API...');
  var apiUrl = siteBase + '/wp-json/wp/v2/products?per_page=100';
  var res = await fetch(apiUrl, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[cb-one] HTTP ' + res.status);

  var CASTING_PLUG_CAT = 23;
  var METAL_JIG_CAT = 24;

  var posts: Array<{ slug: string; link: string; title: { rendered: string }; 'products-category': number[] }> = await res.json();

  for (var cbi = 0; cbi < posts.length; cbi++) {
    var cbp = posts[cbi];
    if (CB_ONE_SKIP_SLUGS.has(cbp.slug)) continue;

    var cats = cbp['products-category'] || [];
    if (!cats.includes(CASTING_PLUG_CAT) && !cats.includes(METAL_JIG_CAT)) continue;

    var cbName = cbp.title.rendered.replace(/<[^>]+>/g, '').trim();
    var cbUrl = cbp.link || (siteBase + '/products/' + cbp.slug + '/');

    results.push({ url: cbUrl, name: cbName });
  }

  log('[cb-one] Discovered ' + results.length + ' products');
  return results;
}

// ---- Crazy Ocean ----
// crazy-ocean.com — WordPress, WP REST API
// CPT: itemlist, categories for lure subcategories
// Fetch-only, no Playwright

var CRAZY_OCEAN_LURE_CATEGORY_IDS = [364, 368, 367, 402, 366, 369];

var CRAZY_OCEAN_SKIP_PATTERNS = [
  /スペアネクタイ/,
  /絡め手フック/,
  /替えフック/,
  /シンカー(?!.*エギ)/,
  /アシスト/,
];

async function discoverCrazyOcean(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenIds = new Set<string>();

  log('[crazy-ocean] Fetching products from WP REST API (itemlist)...');

  for (var catIdx = 0; catIdx < CRAZY_OCEAN_LURE_CATEGORY_IDS.length; catIdx++) {
    var catId = CRAZY_OCEAN_LURE_CATEGORY_IDS[catIdx];
    var coPage = 1;
    var coTotalPages = 1;

    while (coPage <= coTotalPages) {
      var coApiUrl = 'https://crazy-ocean.com/wp-json/wp/v2/itemlist?per_page=100&_embed&itemlist_category=' + catId + '&page=' + coPage;
      var coRes = await fetch(coApiUrl, { headers: { 'Accept': 'application/json' } });
      if (!coRes.ok) {
        if (coRes.status === 400) break; // No items in this category
        log('[crazy-ocean] API error cat=' + catId + ' page=' + coPage + ': ' + coRes.status);
        break;
      }

      if (coPage === 1) {
        var coTotalPagesHeader = coRes.headers.get('X-WP-TotalPages');
        if (coTotalPagesHeader) coTotalPages = parseInt(coTotalPagesHeader, 10);
      }

      var coPosts: Array<{ id: number; slug: string; link: string; title: { rendered: string } }> = await coRes.json();

      for (var coi = 0; coi < coPosts.length; coi++) {
        var coPost = coPosts[coi];
        var coId = String(coPost.id);
        if (seenIds.has(coId)) continue;
        seenIds.add(coId);

        var coName = coPost.title.rendered.replace(/<[^>]+>/g, '').trim();

        // Skip accessories/hooks
        var skipCo = false;
        for (var ski = 0; ski < CRAZY_OCEAN_SKIP_PATTERNS.length; ski++) {
          if (CRAZY_OCEAN_SKIP_PATTERNS[ski].test(coName)) { skipCo = true; break; }
        }
        if (skipCo) continue;

        results.push({ url: coPost.link, name: coName });
      }

      coPage++;
      if (coPage <= coTotalPages) await sleep(300);
    }

    await sleep(200);
  }

  log('[crazy-ocean] Discovered ' + results.length + ' products');
  return results;
}

// ---- D-Claw ----
// d-claw.jp — 100% static HTML, hardcoded product list
// Fetch-only, no Playwright

var DCLAW_PRODUCTS = [
  { name: 'Beacon NEO 200', page: 'offshore_beaconneo200.html' },
  { name: "SWIMMING PENCIL D'abs230", page: 'offshore_dabs230.html' },
  { name: 'MARINO300 SLIM', page: 'offshore_marino300slim.html' },
  { name: 'MARINO250 SLIM', page: 'offshore_marino250slim.html' },
  { name: 'MARINO200 SLIM', page: 'offshore_marino200slim.html' },
  { name: 'MARINO280 MESSAMAGNUM', page: 'offshore_marino280mm.html' },
  { name: 'MARINO230 MAGNUM', page: 'offshore_marino230.html' },
  { name: 'MARINO210', page: 'offshore_marino210.html' },
  { name: 'MARINO180', page: 'offshore_marino180.html' },
  { name: 'MARINO160', page: 'offshore_marino160.html' },
  { name: 'Bubbles250GT', page: 'offshore_bubbles250gt.html' },
  { name: 'Bubbles250', page: 'offshore_bubbles250.html' },
  { name: 'Bubbles215', page: 'offshore_bubbles215.html' },
  { name: 'Bubbles190', page: 'offshore_bubbles190.html' },
  { name: 'Bubbles160', page: 'offshore_bubbles160.html' },
  { name: 'Beacon210', page: 'offshore_beacon210.html' },
  { name: 'Beacon180', page: 'offshore_beacon180.html' },
  { name: 'Beacon180 HIRAMASA TUNE', page: 'offshore_beacon180hiramasatune.html' },
  { name: 'Beacon140', page: 'offshore_beacon140.html' },
  { name: 'Beacon120', page: 'offshore_beacon120.html' },
  { name: '円舞 Type-K', page: 'offshore_enbu_typek.html' },
  { name: '水面CHOP!-TG', page: 'offshore_suimenchop_tg.html' },
  { name: 'GOKUUSU 泳', page: 'offshore_gokuusu_swim.html' },
  { name: 'GOKUUSU 跳', page: 'offshore_gokuusu_tobi.html' },
];

async function discoverDClaw(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://d-claw.jp';

  for (var dci = 0; dci < DCLAW_PRODUCTS.length; dci++) {
    var dp = DCLAW_PRODUCTS[dci];
    results.push({
      url: siteBase + '/' + dp.page,
      name: dp.name,
    });
  }

  log('[d-claw] Discovered ' + results.length + ' products (hardcoded)');
  return results;
}

// ---- Deep Liner ----
// deepliner.com — static HTML listing at /item.html
// Discovers jig links matching jig/{slug}.html
// Fetch-only, no Playwright

var DEEPLINER_BROKEN_SLUGS = new Set(['mega_spindle']);

async function discoverDeepliner(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.deepliner.com';

  log('[deepliner] Fetching item listing page...');
  var res = await fetch(siteBase + '/item.html', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[deepliner] HTTP ' + res.status);
  var html = await res.text();

  // Find all links to jig pages: href="jig/{slug}.html"
  var jigLinkRegex = /<a\s+href="(jig\/([^"]+)\.html)"[^>]*>/gi;
  var jigMatch: RegExpExecArray | null;
  var seenSlugs = new Set<string>();

  while ((jigMatch = jigLinkRegex.exec(html)) !== null) {
    var relPath = jigMatch[1];
    var dlSlug = jigMatch[2];

    if (DEEPLINER_BROKEN_SLUGS.has(dlSlug)) continue;
    if (seenSlugs.has(dlSlug)) continue;
    seenSlugs.add(dlSlug);

    // Convert slug to a name (e.g. "slowskip_vb" -> "Slowskip Vb")
    var dlName = dlSlug
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });

    results.push({
      url: siteBase + '/' + relPath,
      name: dlName,
    });
  }

  log('[deepliner] Discovered ' + results.length + ' products');
  return results;
}

// ---- DRT (Division Rebel Tackles) ----
// divisionrebeltackles.com — WordPress custom theme
// Multiple category pages: /products/bait/, /products/soft-bait/, /products/jig/
// Fetch-only, no Playwright

var DRT_CATEGORY_PAGES = [
  'https://www.divisionrebeltackles.com/products/bait/',
  'https://www.divisionrebeltackles.com/products/soft-bait/',
  'https://www.divisionrebeltackles.com/products/jig/',
];

async function discoverDrt(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenUrls = new Set<string>();

  for (var drtCi = 0; drtCi < DRT_CATEGORY_PAGES.length; drtCi++) {
    var catUrl = DRT_CATEGORY_PAGES[drtCi];
    log('[drt] Fetching category: ' + catUrl);

    var drtRes = await fetch(catUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!drtRes.ok) {
      log('[drt] HTTP ' + drtRes.status + ' for ' + catUrl);
      continue;
    }
    var drtHtml = await drtRes.text();

    // Product links: href="https://www.divisionrebeltackles.com/products/(bait|soft-bait|jig)/NNNN/"
    var drtLinkRegex = /<a[^>]*href="(https:\/\/www\.divisionrebeltackles\.com\/products\/(?:bait|soft-bait|jig)\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/gi;
    var drtMatch: RegExpExecArray | null;

    while ((drtMatch = drtLinkRegex.exec(drtHtml)) !== null) {
      var drtUrl = drtMatch[1];
      if (seenUrls.has(drtUrl)) continue;
      seenUrls.add(drtUrl);

      // Extract name from link content (strip tags) or img alt
      var linkContent = drtMatch[2];
      var drtName = linkContent.replace(/<[^>]+>/g, '').trim();
      if (!drtName || drtName.length < 2) {
        var altMatch = linkContent.match(/alt="([^"]+)"/i);
        if (altMatch) drtName = altMatch[1];
      }
      if (!drtName || drtName.length < 2) {
        var idMatch = drtUrl.match(/\/(\d+)\/$/);
        drtName = 'Product ' + (idMatch ? idMatch[1] : 'unknown');
      }

      results.push({ url: drtUrl, name: drtName });
    }

    await sleep(500);
  }

  log('[drt] Discovered ' + results.length + ' products');
  return results;
}

// ---- Flash Union ----
// flash-union.jp — custom PHP site, listing at /product/
// Product links: {slug}.php with <img alt="Japanese Name">
// Fetch-only, no Playwright

var FLASH_UNION_SKIP_SLUGS = new Set([
  'covercontacthook', 'tg_finesse_rattler',
  'cutting_sticker', 'flat_brim_cap', 'mesh_cap_type_a', 'long_t_01',
]);

async function discoverFlashUnion(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.flash-union.jp';
  var seenSlugs = new Set<string>();

  log('[flash-union] Fetching product listing page...');
  var fuRes = await fetch(siteBase + '/product/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!fuRes.ok) throw new Error('[flash-union] HTTP ' + fuRes.status);
  var fuHtml = await fuRes.text();

  // Find main content section (starts at first <h2> for "Hard Lures")
  var mainStart = fuHtml.search(/<h2[^>]*>\s*Hard Lures\s*<\/h2>/i);
  if (mainStart === -1) {
    log('[flash-union] Could not find main listing section, scanning whole page');
    mainStart = 0;
  }

  // Find sidebar boundary
  var sidebarStart = fuHtml.indexOf('list-group-item', mainStart);
  var mainSection = sidebarStart > 0 ? fuHtml.substring(mainStart, sidebarStart) : fuHtml.substring(mainStart);

  // Skip non-lure categories
  var fuParts = mainSection.split(/<h2[^>]*>/i);
  var fuCurrentSkip = false;

  for (var fuPi = 0; fuPi < fuParts.length; fuPi++) {
    var fuPart = fuParts[fuPi];
    var headingEnd = fuPart.indexOf('</h2>');
    if (headingEnd > 0) {
      var heading = fuPart.substring(0, headingEnd).toLowerCase().trim();
      fuCurrentSkip = heading.indexOf('accessor') !== -1 || heading.indexOf('apparel') !== -1;
    }
    if (fuCurrentSkip) continue;

    // Product links: <a href="slug.php"><img ... alt="Japanese Name" ...>
    var fuLinkRegex = /<a\s+href="([a-z0-9_]+)\.php"[^>]*>\s*<img[^>]*alt="([^"]*)"[^>]*>/gi;
    var fuMatch: RegExpExecArray | null;

    while ((fuMatch = fuLinkRegex.exec(fuPart)) !== null) {
      var phpSlug = fuMatch[1];
      if (seenSlugs.has(phpSlug)) continue;
      if (FLASH_UNION_SKIP_SLUGS.has(phpSlug)) continue;
      seenSlugs.add(phpSlug);

      var fuName = fuMatch[2].trim() || phpSlug.replace(/_/g, ' ');

      results.push({
        url: siteBase + '/product/' + phpSlug + '.php',
        name: fuName,
      });
    }
  }

  log('[flash-union] Discovered ' + results.length + ' products');
  return results;
}

// ---- BREADEN ----
// breaden.net — Static HTML
// Product listing at /product/Lure/lure.html
// Fetch-only, no Playwright

async function discoverBreaden(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://breaden.net';

  log('[breaden] Fetching product listing page...');
  var res = await fetch(siteBase + '/product/Lure/lure.html', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[breaden] HTTP ' + res.status);
  var html = await res.text();

  var linkRegex = /<a\s+href="([^"]+\.html)"[^>]*>([^<]+)/gi;
  var match: RegExpExecArray | null;
  var seenUrls = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    if (!linkName) continue;
    // Skip the listing page itself and non-product links
    if (href === 'lure.html' || href.indexOf('/') !== -1 && !href.startsWith('http')) continue;

    var fullUrl: string;
    if (href.startsWith('http')) {
      fullUrl = href;
    } else {
      fullUrl = siteBase + '/product/Lure/' + href;
    }

    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    results.push({ url: fullUrl, name: linkName });
  }

  log('[breaden] Discovered ' + results.length + ' products');
  return results;
}

// ---- DRANCKRAZY ----
// dranckrazy.com — WooCommerce
// Product listing at /shop/ (paginated)
// Fetch-only, no Playwright

async function discoverDranckrazy(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://dranckrazy.com';
  var seenUrls = new Set<string>();
  var pageNum = 1;

  log('[dranckrazy] Fetching WooCommerce product pages...');

  while (true) {
    var listUrl = pageNum === 1
      ? siteBase + '/shop/'
      : siteBase + '/shop/page/' + pageNum + '/';

    var res = await fetch(listUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) break;
    var html = await res.text();

    var productRegex = /<a\s+href="(https?:\/\/dranckrazy\.com\/product\/[^"]+\/)"[^>]*class="[^"]*woocommerce-LoopProduct-link[^"]*"[^>]*>/gi;
    var match2: RegExpExecArray | null;
    var foundOnPage = 0;

    while ((match2 = productRegex.exec(html)) !== null) {
      var productUrl = match2[1];
      if (seenUrls.has(productUrl)) continue;
      seenUrls.add(productUrl);
      foundOnPage++;

      // Extract name from the slug
      var slugMatch = productUrl.match(/\/product\/([^/]+)\/?$/);
      var productName = slugMatch
        ? decodeURIComponent(slugMatch[1]).replace(/-/g, ' ')
        : '';

      results.push({ url: productUrl, name: productName });
    }

    // Also try a more general product link pattern
    if (foundOnPage === 0) {
      var altRegex = /<a\s+href="(https?:\/\/dranckrazy\.com\/product\/[^"]+\/)"[^>]*>/gi;
      var altMatch: RegExpExecArray | null;

      while ((altMatch = altRegex.exec(html)) !== null) {
        var altUrl = altMatch[1];
        if (seenUrls.has(altUrl)) continue;
        seenUrls.add(altUrl);
        foundOnPage++;

        var altSlugMatch = altUrl.match(/\/product\/([^/]+)\/?$/);
        var altName = altSlugMatch
          ? decodeURIComponent(altSlugMatch[1]).replace(/-/g, ' ')
          : '';

        results.push({ url: altUrl, name: altName });
      }
    }

    if (foundOnPage === 0) break;

    // Check for next page link
    if (html.indexOf('/shop/page/' + (pageNum + 1)) === -1) break;
    pageNum++;
  }

  log('[dranckrazy] Discovered ' + results.length + ' products');
  return results;
}

// ---- HARIMITSU (ハリミツ) ----
// harimitsu.co.jp — WordPress
// Product categories under /category/item/
// Paginated (20 per page)
// Fetch-only, no Playwright

var HARIMITSU_CATEGORY_PAGES = [
  'https://harimitsu.co.jp/category/item/itemgenre/sumizoku/',
];

async function discoverHarimitsu(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenUrls = new Set<string>();

  log('[harimitsu] Fetching product category pages...');

  for (var ci = 0; ci < HARIMITSU_CATEGORY_PAGES.length; ci++) {
    var catBase = HARIMITSU_CATEGORY_PAGES[ci];
    var pageNum = 1;

    while (true) {
      var listUrl = pageNum === 1
        ? catBase
        : catBase + 'page/' + pageNum + '/';

      var res = await fetch(listUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
      });
      if (!res.ok) break;
      var html = await res.text();

      var linkRegex = /<a\s+href="(https?:\/\/harimitsu\.co\.jp\/(\d+)\/)"[^>]*>/gi;
      var match3: RegExpExecArray | null;
      var foundOnPage = 0;

      while ((match3 = linkRegex.exec(html)) !== null) {
        var productUrl = match3[1];
        if (seenUrls.has(productUrl)) continue;
        seenUrls.add(productUrl);
        foundOnPage++;

        results.push({ url: productUrl, name: '' });
      }

      // Also extract product names from article titles
      var titleRegex = /<a\s+href="(https?:\/\/harimitsu\.co\.jp\/\d+\/)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)/gi;
      var titleMatch: RegExpExecArray | null;

      while ((titleMatch = titleRegex.exec(html)) !== null) {
        var titleUrl = titleMatch[1];
        var titleName = titleMatch[2].trim();
        if (!titleName) continue;

        // Update existing entry with name
        for (var ri = 0; ri < results.length; ri++) {
          if (results[ri].url === titleUrl && !results[ri].name) {
            results[ri].name = titleName;
            break;
          }
        }
      }

      if (foundOnPage === 0) break;
      if (html.indexOf('page/' + (pageNum + 1)) === -1) break;
      pageNum++;
    }
  }

  log('[harimitsu] Discovered ' + results.length + ' products');
  return results;
}

// ---- HAYABUSA (ハヤブサ) ----
// hayabusa.co.jp — WordPress, WP REST API
// CPT: products, per_page=100
// Fetch-only, no Playwright

async function discoverHayabusa(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;

  log('[hayabusa] Fetching products from WP REST API...');

  while (true) {
    var apiUrl = 'https://www.hayabusa.co.jp/hayabusa/wp-json/wp/v2/products?per_page=100&page=' + pageNum;
    var res = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;

    for (var pi = 0; pi < posts.length; pi++) {
      var p = posts[pi];
      var hayaName = p.title.rendered
        .replace(/&#\d+;/g, function(m: string) { return String.fromCharCode(parseInt(m.slice(2, -1))); })
        .replace(/<[^>]+>/g, '')
        .trim();

      results.push({ url: p.link, name: hayaName });
    }

    if (posts.length < 100) break;
    pageNum++;
  }

  log('[hayabusa] Discovered ' + results.length + ' products');
  return results;
}

// ---- LONGIN ----
// longin.jp — Static HTML
// Product listing at /products.html
// Fetch-only, no Playwright

async function discoverLongin(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.longin.jp';

  log('[longin] Fetching product listing page...');
  var res = await fetch(siteBase + '/products.html', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[longin] HTTP ' + res.status);
  var html = await res.text();

  var linkRegex = /<a\s+href="(products_[^"]+\.html)"[^>]*>([^<]*)/gi;
  var match4: RegExpExecArray | null;
  var seenUrls = new Set<string>();

  while ((match4 = linkRegex.exec(html)) !== null) {
    var href = match4[1];
    var linkName = match4[2].trim();

    var fullUrl = siteBase + '/' + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    // If name not in the link text, derive from filename
    if (!linkName) {
      linkName = href
        .replace('products_', '')
        .replace('.html', '')
        .replace(/_/g, ' ');
    }

    results.push({ url: fullUrl, name: linkName });
  }

  log('[longin] Discovered ' + results.length + ' products');
  return results;
}

// ---- SEAFLOOR CONTROL (シーフロアコントロール) ----
// seafloor-control.com — WordPress
// Product listing at /ja/items/
// Fetch-only, no Playwright

async function discoverSeafloorControl(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://seafloor-control.com';
  var seenUrls = new Set<string>();

  log('[seafloor-control] Fetching product listing page...');
  var res = await fetch(siteBase + '/ja/items/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[seafloor-control] HTTP ' + res.status);
  var html = await res.text();

  // Match product links under /ja/items/{slug}/
  var linkRegex = /<a\s+href="((?:https?:\/\/seafloor-control\.com)?\/ja\/items\/([^"/]+)\/)"[^>]*>/gi;
  var match5: RegExpExecArray | null;

  while ((match5 = linkRegex.exec(html)) !== null) {
    var href = match5[1];
    var slug = match5[2];

    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    // Derive name from slug
    var sfName = decodeURIComponent(slug)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });

    results.push({ url: fullUrl, name: sfName });
  }

  // Also try to extract names from title/heading elements near the links
  var titleRegex = /<a\s+href="(?:https?:\/\/seafloor-control\.com)?\/ja\/items\/([^"/]+)\/"[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)/gi;
  var titleMatch2: RegExpExecArray | null;

  while ((titleMatch2 = titleRegex.exec(html)) !== null) {
    var tSlug = titleMatch2[1];
    var tName = titleMatch2[2].trim();
    if (!tName) continue;

    var tUrl = siteBase + '/ja/items/' + tSlug + '/';
    for (var ri2 = 0; ri2 < results.length; ri2++) {
      if (results[ri2].url === tUrl && results[ri2].name !== tName) {
        // Prefer extracted text name over slug-derived name
        if (tName.length > 1) {
          results[ri2].name = tName;
        }
        break;
      }
    }
  }

  log('[seafloor-control] Discovered ' + results.length + ' products');
  return results;
}

// ---- XESTA ----
// xesta.jp — WordPress
// Multiple category pages
// Fetch-only, no Playwright

var XESTA_CATEGORY_PAGES = [
  'https://xesta.jp/xesta-shore-jigging',
  'https://xesta.jp/xesta-light-game',
  'https://xesta.jp/xesta-offshore',
  'https://xesta.jp/xesta-squid-game',
];

async function discoverXesta(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenUrls = new Set<string>();

  log('[xesta] Fetching category pages...');

  for (var ci2 = 0; ci2 < XESTA_CATEGORY_PAGES.length; ci2++) {
    var catUrl = XESTA_CATEGORY_PAGES[ci2];

    var res = await fetch(catUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) {
      log('[xesta] HTTP ' + res.status + ' for ' + catUrl + ', skipping');
      continue;
    }
    var html = await res.text();

    // Match product links: href="https://xesta.jp/{slug}/" or href="https://xesta.jp/products/metaljig/{slug}/"
    var linkRegex = /<a\s+href="(https?:\/\/xesta\.jp\/(?:products\/[^"]*\/)?([^"/]+)\/)"[^>]*>([^<]*)/gi;
    var match6: RegExpExecArray | null;

    while ((match6 = linkRegex.exec(html)) !== null) {
      var productUrl = match6[1];
      var slug2 = match6[2];
      var linkName = match6[3].trim();

      // Skip category pages and non-product pages
      if (slug2 === 'xesta-shore-jigging' || slug2 === 'xesta-light-game' ||
          slug2 === 'xesta-offshore' || slug2 === 'xesta-squid-game' ||
          slug2 === 'wp-content' || slug2 === 'wp-admin' ||
          slug2 === 'contact' || slug2 === 'company' || slug2 === 'news') continue;

      if (seenUrls.has(productUrl)) continue;
      seenUrls.add(productUrl);

      if (!linkName) {
        linkName = decodeURIComponent(slug2).replace(/-/g, ' ');
      }

      results.push({ url: productUrl, name: linkName });
    }
  }

  log('[xesta] Discovered ' + results.length + ' products');
  return results;
}

// ---- ZEAKE (ジーク) ----
// zeake.jp — WordPress/Cocoon
// Product listing at /product/
// Fetch-only, no Playwright

async function discoverZeake(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://zeake.jp';
  var seenUrls = new Set<string>();

  log('[zeake] Fetching product listing page...');
  var res = await fetch(siteBase + '/product/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[zeake] HTTP ' + res.status);
  var html = await res.text();

  // Match product links: href="https://zeake.jp/items/{slug}/"
  var linkRegex = /<a\s+href="((?:https?:\/\/zeake\.jp)?\/items\/([^"/]+)\/)"[^>]*>/gi;
  var match7: RegExpExecArray | null;

  while ((match7 = linkRegex.exec(html)) !== null) {
    var href = match7[1];
    var slug3 = match7[2];

    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    var zName = decodeURIComponent(slug3)
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });

    results.push({ url: fullUrl, name: zName });
  }

  // Also try to extract product names from heading/title elements
  var titleRegex = /<a\s+href="(?:https?:\/\/zeake\.jp)?\/items\/([^"/]+)\/"[^>]*>\s*(?:<[^>]+>\s*)*([^<]+)/gi;
  var titleMatch3: RegExpExecArray | null;

  while ((titleMatch3 = titleRegex.exec(html)) !== null) {
    var tSlug2 = titleMatch3[1];
    var tName2 = titleMatch3[2].trim();
    if (!tName2) continue;

    var tUrl2 = siteBase + '/items/' + tSlug2 + '/';
    for (var ri3 = 0; ri3 < results.length; ri3++) {
      if (results[ri3].url === tUrl2 && tName2.length > 1) {
        results[ri3].name = tName2;
        break;
      }
    }
  }

  log('[zeake] Discovered ' + results.length + ' products');
  return results;
}

// ---- ATTIC ----
// attic.ne.jp — static HTML
// Product URLs: https://www.attic.ne.jp/{slug}.html
// Fetch-only, no Playwright

async function discoverAttic(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.attic.ne.jp';
  var seenUrls = new Set<string>();

  // The /products/ page is paginated — fetch up to 10 pages
  for (var pageNum = 1; pageNum <= 10; pageNum++) {
    var pageUrl = pageNum === 1 ? siteBase + '/products/' : siteBase + '/products/page/' + pageNum + '/';
    log('[attic] Fetching product page ' + pageNum + '...');
    var res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) break; // No more pages
    var html = await res.text();

    // Match product links: /products/{slug}/
    var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/(?:www\.)?attic\.ne\.jp)?\/products\/[^"]+)"[^>]*>([^<]*)/gi;
    var match: RegExpExecArray | null;
    var foundOnPage = 0;

    while ((match = linkRegex.exec(html)) !== null) {
      var href = match[1];
      var linkName = match[2].trim();
      // Skip the /products/ index and pagination links
      if (/\/products\/?$/.test(href)) continue;
      if (/\/products\/page\//.test(href)) continue;
      var fullUrl = href.startsWith('http') ? href : siteBase + href;
      // Normalize trailing slash
      fullUrl = fullUrl.replace(/\/$/, '') + '/';
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);
      if (!linkName) {
        linkName = href.replace(/.*\/products\//, '').replace(/\/$/, '').replace(/-/g, ' ');
      }
      results.push({ url: fullUrl, name: linkName });
      foundOnPage++;
    }

    if (foundOnPage === 0) break;
  }

  log('[attic] Discovered ' + results.length + ' products');
  return results;
}

// ---- DAMIKI JAPAN ----
// damiki-japan.com — WordPress
// Product URLs: https://damiki-japan.com/products/{slug}/
// WP REST API or fetch, no Playwright

async function discoverDamiki(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;
  while (true) {
    var res = await fetch('https://damiki-japan.com/wp-json/wp/v2/posts?per_page=100&page=' + pageNum);
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;
    for (var p of posts) {
      results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
    }
    if (posts.length < 100) break;
    pageNum++;
  }
  log('[damiki] Discovered ' + results.length + ' products');
  return results;
}

// ---- DreemUp ----
// dreem-up.com — WordPress
// Product URLs: https://dreem-up.com/{slug}/
// WP REST API or fetch, no Playwright

async function discoverDreemup(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seenUrls = new Set<string>();

  // DreemUp uses WP custom post types:
  // - "service" endpoint = items (soft lures, hard lures, jig heads, gears) at /item/
  // - "company" endpoint = rods at /rod/
  // The "posts" endpoint only returns blog articles, not products
  var endpoints = [
    'https://dreem-up.com/wp-json/wp/v2/service?per_page=100',
    'https://dreem-up.com/wp-json/wp/v2/company?per_page=100',
  ];

  for (var endpoint of endpoints) {
    var pageNum = 1;
    while (true) {
      var url = endpoint + '&page=' + pageNum;
      log('[dreemup] Fetching ' + url);
      var res = await fetch(url);
      if (!res.ok) break;
      var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
      if (posts.length === 0) break;
      for (var p of posts) {
        if (seenUrls.has(p.link)) continue;
        seenUrls.add(p.link);
        results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
      }
      if (posts.length < 100) break;
      pageNum++;
    }
  }

  log('[dreemup] Discovered ' + results.length + ' products');
  return results;
}

// ---- GOD HANDS ----
// god-hands.jp — static/WordPress
// Product URLs: https://god-hands.jp/products/{slug}/
// Fetch listing page, no Playwright

async function discoverGodHands(page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://god-hands.jp';
  var seenUrls = new Set<string>();

  log('[god-hands] Site uses STUDIO.design SPA — using Playwright...');

  // The site is built with STUDIO.design (Nuxt/Vue SPA), no WP API.
  // Sitemap lists pages: /, /1, /1-2, /1-3, /1-5, /1-6, /1-7, /1-8, /1-10, /2
  // We need Playwright to render the SPA and extract product information.
  try {
    await page.goto(siteBase + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Extract all internal links and text content
    var links = await page.evaluate(function() {
      var anchors = document.querySelectorAll('a[href]');
      var found: Array<{ url: string; name: string }> = [];
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i] as HTMLAnchorElement;
        var href = a.href;
        if (href && href.includes('god-hands.jp') && !href.includes('#') &&
            !href.includes('privacy') && href !== 'https://god-hands.jp/') {
          var name = (a.textContent || '').trim().split('\n')[0].trim().substring(0, 100);
          if (name) found.push({ url: href, name: name });
        }
      }
      return found;
    });

    for (var link of links) {
      if (!seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        results.push(link);
      }
    }

    // Also visit numbered pages from sitemap to find product content
    var sitemapPages = ['/1', '/1-2', '/1-3', '/1-5', '/1-6', '/1-7', '/1-8', '/1-10', '/2'];
    for (var sp of sitemapPages) {
      try {
        await page.goto(siteBase + sp, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
        var pageTitle = await page.title();
        var pageUrl = siteBase + sp;
        if (pageTitle && !seenUrls.has(pageUrl) && !/GOD HANDS|privacy/i.test(pageTitle)) {
          seenUrls.add(pageUrl);
          results.push({ url: pageUrl, name: pageTitle.replace(/\s*[|–-]\s*GOD HANDS.*$/i, '').trim() || 'Product ' + sp });
        }
      } catch (_e) {
        // skip pages that fail to load
      }
    }
  } catch (err) {
    log('[god-hands] Playwright discovery error: ' + (err instanceof Error ? err.message : String(err)));
  }

  log('[god-hands] Discovered ' + results.length + ' products');
  return results;
}

// ---- GRASS ROOTS ----
// grassroots-kms.com — static/WordPress
// Fetch-only, no Playwright

async function discoverGrassroots(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://grassroots-kms.com';
  var seenUrls = new Set<string>();

  log('[grassroots] Fetching product listing page...');

  // Products are on static HTML pages under /product/
  var res = await fetch(siteBase + '/product/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[grassroots] HTTP ' + res.status);
  var html = await res.text();

  // The HTML structure uses <li><a href="..."><img alt="..."><p>Name</p></a></li>
  // Split HTML by </a> boundaries and extract content AFTER the <a> tag
  var blocks = html.split('</a>');
  for (var block of blocks) {
    var hrefMatch = /<a\s+[^>]*href="((?:https?:\/\/(?:www\.)?grassroots-kms\.com)?\/product\/[^"]+\.html)"[^>]*>/.exec(block);
    if (!hrefMatch) continue;
    var href = hrefMatch[1];
    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    // Get only content AFTER the <a> opening tag
    var afterAnchor = block.slice(hrefMatch.index + hrefMatch[0].length);

    // Prefer name from <p> tag (image alt texts are often duplicated/wrong)
    var linkName = '';
    var pMatch = /<p[^>]*>■?([^<]+)/i.exec(afterAnchor);
    if (pMatch) {
      linkName = pMatch[1].replace(/^■\s*/, '').trim();
    }
    // Try h4 tag
    if (!linkName) {
      var h4Match = /<h[2-4][^>]*>■?([^<]+)/i.exec(afterAnchor);
      if (h4Match) linkName = h4Match[1].replace(/^■\s*/, '').trim();
    }
    // Try img alt
    if (!linkName) {
      var altMatch = /<img[^>]*alt="■?([^"]+)"[^>]*>/i.exec(afterAnchor);
      if (altMatch) linkName = altMatch[1].replace(/^■\s*/, '').trim();
    }
    // Last fallback: slug from URL
    if (!linkName) {
      linkName = href.replace(/.*\/product\//, '').replace(/\.html$/, '').replace(/[-_]/g, ' ');
    }
    results.push({ url: fullUrl, name: linkName });
  }

  log('[grassroots] Discovered ' + results.length + ' products');
  return results;
}

// ---- ITO.CRAFT ----
// itocraft.com — static/WordPress
// Products on single page: https://itocraft.com/products/lurelist/
// Fetch-only, no Playwright

async function discoverItocraft(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://itocraft.com';
  var seenUrls = new Set<string>();

  log('[itocraft] Fetching lure list page...');
  var res = await fetch(siteBase + '/products/lurelist/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[itocraft] HTTP ' + res.status);
  var html = await res.text();

  // Match product links or anchor sections with product names
  var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/itocraft\.com)?\/products\/[^"]+)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) linkName = href.replace(/.*\/([^/]+)\/?$/, '$1').replace(/-/g, ' ');
    results.push({ url: fullUrl, name: linkName });
  }

  // Also match h2/h3 anchor IDs on lurelist page as product entries
  var anchorRegex = /<(?:h[23]|div)\s+[^>]*id="([^"]+)"[^>]*>([^<]*)/gi;
  while ((match = anchorRegex.exec(html)) !== null) {
    var anchorId = match[1];
    var anchorName = match[2].trim();
    if (!anchorName || /menu|nav|header|footer|sidebar/i.test(anchorId)) continue;
    var anchorUrl = siteBase + '/products/lurelist/#' + anchorId;
    if (seenUrls.has(anchorUrl)) continue;
    seenUrls.add(anchorUrl);
    results.push({ url: anchorUrl, name: anchorName });
  }

  log('[itocraft] Discovered ' + results.length + ' products');
  return results;
}

// ---- IVY LINE ----
// ivyline.jp — WordPress/SWELL
// Product URLs: https://www.ivyline.jp/products/{slug}/
// WP REST API, no Playwright

async function discoverIvyLine(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;
  while (true) {
    var res = await fetch('https://www.ivyline.jp/wp-json/wp/v2/posts?per_page=100&page=' + pageNum);
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;
    for (var p of posts) {
      results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
    }
    if (posts.length < 100) break;
    pageNum++;
  }
  log('[ivy-line] Discovered ' + results.length + ' products');
  return results;
}

// ---- JAZZ ----
// jazz-lure.com — WordPress
// Product URLs: https://www.jazz-lure.com/product/{slug}
// WP REST API, no Playwright

async function discoverJazz(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.jazz-lure.com';
  var seenUrls = new Set<string>();

  log('[jazz] Fetching product listing page...');
  var res = await fetch(siteBase + '/product/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[jazz] HTTP ' + res.status);
  var html = await res.text();

  var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/www\.jazz-lure\.com)?\/product\/[^"]+)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    if (href === '/product/' || href === siteBase + '/product/') continue;
    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) linkName = href.replace(/.*\/([^/]+)\/?$/, '$1').replace(/[-_]/g, ' ');
    results.push({ url: fullUrl, name: linkName });
  }

  log('[jazz] Discovered ' + results.length + ' products');
  return results;
}

// ---- Jungle Gym ----
// junglegym-world.net — WordPress
// Product URLs: https://junglegym-world.net/{product-slug}/
// WP REST API, no Playwright

async function discoverJungleGym(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://junglegym-world.net';
  var seenUrls = new Set<string>();

  // Products are in sub-category pages: /category/item/itemgenre/{type}/
  var subcategories = [
    '/category/item/itemgenre/lurewarm/',
    '/category/item/itemgenre/jighead/',
    '/category/item/itemgenre/hook/',
    '/category/item/itemgenre/sinker/',
    '/category/item/itemgenre/parts/',
    '/category/item/itemgenre/goods/',
  ];

  for (var subcat of subcategories) {
    log('[jungle-gym] Fetching ' + subcat);
    var res = await fetch(siteBase + subcat, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) {
      log('[jungle-gym] Failed to fetch ' + subcat + ': HTTP ' + res.status);
      continue;
    }
    var html = await res.text();

    // Match product links: https://junglegym-world.net/NNNN/ (numeric post ID pages)
    var linkRegex = /<a\s+[^>]*href="(https?:\/\/junglegym-world\.net\/\d+\/)"[^>]*>([^<]*)/gi;
    var match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      var href = match[1];
      var linkName = match[2].trim();
      if (seenUrls.has(href)) continue;
      seenUrls.add(href);
      if (linkName && linkName.length > 1) {
        results.push({ url: href, name: linkName });
      }
    }
  }

  // Filter out items without useful names
  results = results.filter(function(r) { return r.name && r.name.length > 1; });

  log('[jungle-gym] Discovered ' + results.length + ' products');
  return results;
}

// ---- Mibro ----
// mibro.jp — Wix site (NOT WordPress)
// Product URLs: dynamic (Wix SPA, requires Playwright)
// Playwright-based discovery — navigates to the site and extracts product links

async function discoverMibro(page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var seen = new Set<string>();
  try {
    // Wix site — SPA that requires full JS rendering
    await page.goto('https://www.mibro.jp/', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(5000);

    // First, log navigation items for debugging
    try {
      var navLinks = await page.evaluate(function() {
        var all = document.querySelectorAll('a[href], [role="link"], [data-testid*="link"]');
        var navItems: string[] = [];
        for (var i = 0; i < all.length; i++) {
          var text = (all[i].textContent || '').trim().toLowerCase();
          navItems.push(text + ' -> ' + ((all[i] as HTMLAnchorElement).href || ''));
        }
        return navItems;
      });
      log('[mibro] Found nav items: ' + navLinks.slice(0, 10).join(', '));
    } catch (_e) { /* ignore */ }

    // Extract all internal links
    var links = await page.evaluate(function() {
      var anchors = document.querySelectorAll('a[href]');
      var found: Array<{ url: string; name: string }> = [];
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i] as HTMLAnchorElement;
        var href = a.href;
        if (href && href.includes('mibro.jp') && !href.includes('#') &&
            href !== 'https://www.mibro.jp/' && href !== 'https://mibro.jp/') {
          var name = (a.textContent || '').trim().split('\n')[0].trim().substring(0, 100);
          if (name) found.push({ url: href, name: name });
        }
      }
      return found;
    });
    for (var link of links) {
      if (!seen.has(link.url)) {
        seen.add(link.url);
        results.push(link);
      }
    }

    // If we found very few links, try scrolling down to trigger lazy loading
    if (results.length < 5) {
      log('[mibro] Few links found, scrolling to load more content...');
      for (var scrollIdx = 0; scrollIdx < 5; scrollIdx++) {
        await page.evaluate('window.scrollBy(0, window.innerHeight)');
        await page.waitForTimeout(2000);
      }
      // Re-extract links after scrolling
      var moreLinks = await page.evaluate(function() {
        var anchors = document.querySelectorAll('a[href]');
        var found: Array<{ url: string; name: string }> = [];
        for (var i = 0; i < anchors.length; i++) {
          var a = anchors[i] as HTMLAnchorElement;
          var href = a.href;
          if (href && href.includes('mibro.jp') && !href.includes('#') &&
              href !== 'https://www.mibro.jp/' && href !== 'https://mibro.jp/') {
            var name = (a.textContent || '').trim().split('\n')[0].trim().substring(0, 100);
            if (name) found.push({ url: href, name: name });
          }
        }
        return found;
      });
      for (var mLink of moreLinks) {
        if (!seen.has(mLink.url)) {
          seen.add(mLink.url);
          results.push(mLink);
        }
      }
    }
  } catch (err) {
    log('[mibro] Playwright discovery error: ' + (err instanceof Error ? err.message : String(err)));
  }
  log('[mibro] Discovered ' + results.length + ' products');
  return results;
}

// ---- O.bass Live ----
// obasslive.com — WordPress
// Product URLs: https://obasslive.com/{product-slug}/
// WP REST API, no Playwright

async function discoverObasslive(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://obasslive.com';
  var seenUrls = new Set<string>();

  log('[obasslive] Fetching main page for product links...');
  var res = await fetch(siteBase + '/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[obasslive] HTTP ' + res.status);
  var html = await res.text();

  // Links are relative: hardbait/winbee/, softbaiat/i-f-ankar-3/, martline/big-mofu/
  // Match relative or absolute product links for hardbait, softbaiat, martline categories
  var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/obasslive\.com\/)?(?:\/)?(?:hardbait|softbaiat|martline)\/[^"]+)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    // Normalize to absolute URL
    var fullUrl: string;
    if (href.startsWith('http')) {
      fullUrl = href;
    } else if (href.startsWith('/')) {
      fullUrl = siteBase + href;
    } else {
      fullUrl = siteBase + '/' + href;
    }
    // Skip category index pages and non-product URLs
    var path = fullUrl.replace(siteBase, '');
    if (/^\/(hardbait|softbaiat|martline)\/?$/.test(path)) continue;
    // Skip deep nested paths (e.g., /hardbait/winbee/hello/index.html)
    if (/\.(html|php|asp)/.test(path)) continue;
    // Normalize URL
    fullUrl = fullUrl.replace(/\/$/, '');
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) {
      linkName = fullUrl.replace(/.*\/([^/]+)$/, '$1').replace(/-/g, ' ');
    }
    results.push({ url: fullUrl + '/', name: linkName });
  }

  log('[obasslive] Discovered ' + results.length + ' products');
  return results;
}

// ---- PHAT LAB ----
// phatlab.jp — custom/WordPress
// Product URLs: https://phatlab.jp/{product-slug}/
// WP REST API or fetch, no Playwright

async function discoverPhatLab(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;
  while (true) {
    var res = await fetch('https://phatlab.jp/wp-json/wp/v2/posts?per_page=100&page=' + pageNum);
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;
    for (var p of posts) {
      results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
    }
    if (posts.length < 100) break;
    pageNum++;
  }
  log('[phat-lab] Discovered ' + results.length + ' products');
  return results;
}

// ---- PICKUP ----
// pickup-m.jp — WordPress (WP REST API returns 401, use sitemap instead)
// Product URLs: https://pickup-m.jp/product/{id}/
// Sitemap-based discovery, no Playwright

async function discoverPickup(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var sitemapRes = await fetch('https://pickup-m.jp/product-sitemap.xml', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!sitemapRes.ok) {
    log('[pickup] Sitemap fetch failed: HTTP ' + sitemapRes.status);
    return results;
  }
  var xml = await sitemapRes.text();
  var locRegex = /<loc>(https:\/\/pickup-m\.jp\/product\/[^<]+)<\/loc>/g;
  var match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    var url = match[1];
    // Skip the listing page itself
    if (url === 'https://pickup-m.jp/product/' || url === 'https://pickup-m.jp/product') continue;
    results.push({ url: url, name: url.replace(/.*\/product\/([^/]+)\/?$/, '$1').replace(/-/g, ' ') });
  }
  log('[pickup] Discovered ' + results.length + ' products');
  return results;
}

// ---- POZIDRIVE GARAGE ----
// pdg.co.jp — WordPress
// WP REST API, no Playwright

async function discoverPozidriveGarage(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://pdg.co.jp';
  var seenUrls = new Set<string>();

  log('[pozidrive-garage] Fetching product listing page...');

  // WP REST API only returns the default "Hello world!" post.
  // Products are on the /product/ page with links to /product/{slug}/
  var res = await fetch(siteBase + '/product/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[pozidrive-garage] HTTP ' + res.status);
  var html = await res.text();

  // Match product links: /product/{slug}/
  var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/pdg\.co\.jp)?\/product\/[^"]+\/)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    // Skip the /product/ index page itself
    if (/\/product\/?$/.test(href)) continue;
    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) {
      linkName = href.replace(/.*\/product\//, '').replace(/\/$/, '').replace(/-/g, ' ').toUpperCase();
    }
    results.push({ url: fullUrl, name: linkName });
  }

  // Also try image alt text for better product names
  var imgRegex = /<a\s+[^>]*href="((?:https?:\/\/pdg\.co\.jp)?\/product\/[^"]+\/)"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"[^>]*>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    var href2 = match[1];
    var altName = match[2].trim();
    var fullUrl2 = href2.startsWith('http') ? href2 : siteBase + href2;
    if (altName && altName.length > 1) {
      var existing = results.find(function(r) { return r.url === fullUrl2; });
      if (existing && (!existing.name || existing.name.length < 2)) {
        existing.name = altName;
      }
    }
  }

  log('[pozidrive-garage] Discovered ' + results.length + ' products');
  return results;
}

// ---- SEA FALCON ----
// seafalcon.jp — WordPress
// WP REST API, no Playwright

async function discoverSeaFalcon(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;
  while (true) {
    var res = await fetch('https://seafalcon.jp/wp-json/wp/v2/posts?per_page=100&page=' + pageNum);
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;
    for (var p of posts) {
      results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
    }
    if (posts.length < 100) break;
    pageNum++;
  }
  log('[sea-falcon] Discovered ' + results.length + ' products');
  return results;
}

// ---- SHOUT! ----
// shout-net.com — static HTML
// Product listing pages
// Fetch-only, no Playwright

async function discoverShout(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://shout-net.com';
  var seenUrls = new Set<string>();

  log('[shout] Fetching product listing page...');
  var res = await fetch(siteBase + '/products/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[shout] HTTP ' + res.status);
  var html = await res.text();

  // Product links use /item/{id}/ pattern
  var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/shout-net\.com)?\/item\/[^"]+)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    var fullUrl = href.startsWith('http') ? href : siteBase + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) linkName = 'Product ' + href.replace(/\D/g, '');
    results.push({ url: fullUrl, name: linkName });
  }

  log('[shout] Discovered ' + results.length + ' products');
  return results;
}

// ---- SIGNAL ----
// signal-lure.com — static HTML
// Product URLs: http://www.signal-lure.com/products/item{N}.html
// Fetch-only, no Playwright

async function discoverSignal(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'http://www.signal-lure.com';
  var seenUrls = new Set<string>();

  log('[signal] Fetching product listing page...');
  var res = await fetch(siteBase + '/products/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[signal] HTTP ' + res.status);
  var html = await res.text();

  // Match product links: item{N}.html
  var linkRegex = /<a\s+[^>]*href="([^"]*item\d+\.html)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    var fullUrl: string;
    if (href.startsWith('http')) {
      fullUrl = href;
    } else if (href.startsWith('/')) {
      fullUrl = siteBase + href;
    } else {
      fullUrl = siteBase + '/products/' + href;
    }
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) linkName = 'Product ' + href.replace(/\D/g, '');
    results.push({ url: fullUrl, name: linkName });
  }

  log('[signal] Discovered ' + results.length + ' products');
  return results;
}

// ---- Skagit Designs ----
// skagitwebshop.com — Shopify
// Shopify products.json API, no Playwright

async function discoverSkagit(page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://skagitwebshop.com';
  var seenUrls = new Set<string>();

  log('[skagit] STORES.jp site blocks non-browser requests — using Playwright...');

  try {
    // STORES.jp uses Cloudflare protection, must use Playwright
    await page.goto(siteBase + '/?all_items=true', { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Wait for items to render
    await page.waitForTimeout(5000);

    var pageNum = 1;
    while (pageNum <= 10) {
      var html = await page.content();

      // Extract product links and names using evaluate for better SPA support
      var pageLinks = await page.evaluate(function() {
        var items: Array<{ url: string; name: string }> = [];
        // Look for item links
        var links = document.querySelectorAll('a[href*="/items/"]');
        for (var i = 0; i < links.length; i++) {
          var a = links[i] as HTMLAnchorElement;
          var href = a.href;
          // Get name from nearby text content
          var nameEl = a.querySelector('[class*="item-name"], [class*="ItemName"], p, h3, h4, span');
          var name = nameEl ? (nameEl.textContent || '').trim() : (a.textContent || '').trim().split('\n')[0].trim();
          if (href && name && name.length > 1) {
            items.push({ url: href, name: name.substring(0, 100) });
          }
        }
        return items;
      });

      var foundOnPage = 0;
      for (var link of pageLinks) {
        if (!seenUrls.has(link.url)) {
          seenUrls.add(link.url);
          results.push(link);
          foundOnPage++;
        }
      }

      if (foundOnPage === 0) break;
      pageNum++;

      // Navigate to next page
      try {
        await page.goto(siteBase + '/?all_items=true&page=' + (pageNum), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
      } catch (_e) {
        break;
      }
    }
  } catch (err) {
    log('[skagit] Playwright discovery error: ' + (err instanceof Error ? err.message : String(err)));
  }

  log('[skagit] Discovered ' + results.length + ' products');
  return results;
}

// ---- SOULS ----
// souls.jp — WordPress
// Product listings at /products/trout-lure/
// WP REST API or fetch, no Playwright

async function discoverSouls(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://souls.jp';
  var seenNames = new Set<string>();

  var categories = ['/products/salt-lure/', '/products/trout-lure/'];

  for (var cat of categories) {
    log('[souls] Fetching category page: ' + cat);
    var res = await fetch(siteBase + cat, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) {
      log('[souls] Failed to fetch ' + cat + ': HTTP ' + res.status);
      continue;
    }
    var html = await res.text();

    // Products are in slider blocks with <p class="pd-slide-ttl">ProductName</p>
    var titleRegex = /<p\s+class="pd-slide-ttl">([^<]+)<\/p>/gi;
    var match: RegExpExecArray | null;
    while ((match = titleRegex.exec(html)) !== null) {
      var name = match[1].trim();
      if (name.length < 2 || seenNames.has(name)) continue;
      seenNames.add(name);
      results.push({ url: siteBase + cat, name: name });
    }
  }

  log('[souls] Discovered ' + results.length + ' products');
  return results;
}

// ---- TH tackle ----
// t-hamada.com — WordPress
// WP REST API or fetch, no Playwright

async function discoverThTackle(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;
  while (true) {
    var res = await fetch('https://t-hamada.com/wp-json/wp/v2/posts?per_page=100&page=' + pageNum);
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;
    for (var p of posts) {
      results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
    }
    if (posts.length < 100) break;
    pageNum++;
  }
  log('[th-tackle] Discovered ' + results.length + ' products');
  return results;
}

// ---- VIVA ----
// vivanet.co.jp/viva/ — WordPress
// Product URLs: https://vivanet.co.jp/viva/{product-slug}/
// WP REST API, no Playwright

async function discoverViva(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var pageNum = 1;
  var seenUrls = new Set<string>();
  while (true) {
    var res = await fetch('https://vivanet.co.jp/wp-json/wp/v2/pages?per_page=100&page=' + pageNum);
    if (!res.ok) break;
    var posts: Array<{ link: string; title: { rendered: string } }> = await res.json();
    if (posts.length === 0) break;
    for (var p of posts) {
      // Only include product pages under /viva/ or /aquawave/
      if (!/\/(viva|aquawave)\//.test(p.link)) continue;
      // Skip category/archive pages (no slug after brand prefix)
      if (/\/(viva|aquawave)\/?$/.test(p.link)) continue;
      if (seenUrls.has(p.link)) continue;
      seenUrls.add(p.link);
      results.push({ url: p.link, name: p.title.rendered.replace(/&#\d+;/g, function(m) { return String.fromCharCode(parseInt(m.slice(2, -1))); }) });
    }
    if (posts.length < 100) break;
    pageNum++;
  }
  log('[viva] Discovered ' + results.length + ' products');
  return results;
}

// ---- Yarie ----
// etanba.co.jp — WordPress
// WP REST API, no Playwright

async function discoverYarie(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://www.etanba.co.jp';
  var seenUrls = new Set<string>();

  log('[yarie] Fetching item listing page...');
  var res = await fetch(siteBase + '/item.html', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[yarie] HTTP ' + res.status);
  var html = await res.text();

  // Match product links: href="NNN.html" or href="NNNxx.html" (product code pages)
  var linkRegex = /<a\s+[^>]*href="(\d+\w*\.html)"[^>]*>([^<]*)/gi;
  var match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    var href = match[1];
    var linkName = match[2].trim();
    var fullUrl = siteBase + '/' + href;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    if (!linkName) linkName = 'Yarie No.' + href.replace(/\.html$/, '');
    results.push({ url: fullUrl, name: linkName });
  }

  log('[yarie] Discovered ' + results.length + ' products');
  return results;
}

// ---- ZERO DRAGON ----
// zero-dragon.com — Shop-Pro (Color Me Shop)
// Product URLs: https://zero-dragon.com/?pid={PRODUCT_ID}
// Fetch-only, no Playwright

async function discoverZeroDragon(_page: Page): Promise<Array<{ url: string; name: string }>> {
  var results: Array<{ url: string; name: string }> = [];
  var siteBase = 'https://zero-dragon.com';
  var seenUrls = new Set<string>();

  // Rod model patterns: EJ632, EJ5113HP, ESJ633, SH753, UMV-, ZL- etc.
  var rodPattern = /\b(EJ\d|ESJ\d|SH\d|UMV|ZL\d)/i;

  log('[zero-dragon] Fetching product listing pages...');

  // Shop-Pro typically has a product list page, paginated
  var pageNum = 1;
  while (pageNum <= 10) {
    var listUrl = siteBase + '/?mode=srh&sort=n&page=' + pageNum;
    var res = await fetch(listUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
    });
    if (!res.ok) break;
    var html = await res.text();

    // Match product links: href="/?pid=NNNNN" or href="https://zero-dragon.com/?pid=NNNNN"
    var linkRegex = /<a\s+[^>]*href="((?:https?:\/\/zero-dragon\.com)?\/?[?&]pid=(\d+))"[^>]*>([^<]*)/gi;
    var match: RegExpExecArray | null;
    var foundOnPage = 0;

    while ((match = linkRegex.exec(html)) !== null) {
      var href = match[1];
      var pid = match[2];
      var linkName = match[3].trim();
      var fullUrl = siteBase + '/?pid=' + pid;
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);
      if (!linkName) linkName = 'Product ' + pid;
      // Skip rod products (model numbers like EJ632, ESJ633, SH753, UMV, ZL)
      if (rodPattern.test(linkName)) continue;
      results.push({ url: fullUrl, name: linkName });
      foundOnPage++;
    }

    if (foundOnPage === 0) break;
    pageNum++;
    await sleep(500);
  }

  log('[zero-dragon] Discovered ' + results.length + ' products');
  return results;
}

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
    excludedNameKeywords: ['ワーム', 'WORM', 'ソフトルアー', 'SOFT LURE', 'フック', 'HOOK', '替えフック'],
  },
  {
    slug: 'shimano',
    name: 'SHIMANO',
    discover: discoverShimano,
    excludedNameKeywords: ['ワーム', 'WORM', 'ソフトルアー', 'SOFT LURE', 'パーツ', 'PARTS'],
    requiresHeadedBrowser: true,
  },
  {
    slug: 'ima',
    name: 'ima',
    discover: discoverIma,
    excludedNameKeywords: [],
  },
  {
    slug: 'duo',
    name: 'DUO',
    discover: discoverDuo,
    excludedNameKeywords: [
      'ワーム', 'WORM', 'ソフトベイト', 'SOFT',
      'フック', 'HOOK', 'シャツ', 'Tシャツ', 'キャップ', 'バッグ',
      'ステッカー', 'タオル', 'ジャケット', 'パンツ', 'グローブ',
      'ベルト', 'チラシ', '交換用', 'パーツ', 'PARTS',
      'ポーチ', 'POUCH', 'ボックス', 'BOX', 'ケース', 'CASE',
      'メジャー', 'セット', 'ZEXUS', 'バチコン仕掛',
    ],
  },
  {
    slug: 'deps',
    name: 'deps',
    discover: discoverDeps,
    excludedNameKeywords: [],
    // Category-level filtering is handled in discoverDeps() itself.
    // SOFT BAIT, SUPER BIG WORM SERIES, JIGHEAD/HOOK are excluded at crawl time.
  },
  {
    slug: 'jackall',
    name: 'JACKALL',
    discover: discoverJackall,
    excludedNameKeywords: [],
    // Category/URL/name-level filtering is handled in discoverJackall() itself.
    // Non-lure items (rods, reels, accessories, hooks, parts) are excluded at crawl time.
  },
  {
    slug: 'evergreen',
    name: 'EVERGREEN INTERNATIONAL',
    discover: discoverEvergreen,
    excludedNameKeywords: ['フック', 'パーツ', 'リペアキット'],
  },
  {
    slug: 'apia',
    name: 'APIA',
    discover: discoverApia,
    excludedNameKeywords: ['ルアーパーツ', 'パーツ', 'フック', 'HOOK', 'スペア', 'SPARE'],
  },
  {
    slug: 'coreman',
    name: 'COREMAN',
    discover: discoverCoreman,
    excludedNameKeywords: ['パーツ', 'PARTS', 'スペア', 'SPARE', 'シルバークロー', 'SILVER CLAW'],
  },
  {
    slug: 'pazdesign',
    name: 'Pazdesign',
    discover: discoverPazdesign,
    excludedNameKeywords: ['フック', 'HOOK', 'スカート', 'ネクタイ', 'パーツ', 'PARTS', 'スペア', 'SPARE', 'アシストフック'],
    // URL-level slug exclusions are handled in discoverPazdesign() itself.
  },
  {
    slug: 'osp',
    name: 'O.S.P',
    discover: discoverOsp,
    excludedNameKeywords: ['ネクタイ', 'アシストフック', 'フックセット', 'HOOK SET', 'パーツ', 'PARTS', 'スペア', 'SPARE'],
    // URL-level slug exclusions (tairubber accessories) are handled in discoverOsp() itself.
  },
  {
    slug: 'gancraft',
    name: 'GANCRAFT',
    discover: discoverGancraft,
    excludedNameKeywords: ['ロッド', 'ROD', 'リール', 'REEL', 'グッズ', 'GOODS', 'バッグ', 'BAG', 'アパレル', 'APPAREL'],
  },
  {
    slug: 'luckycraft',
    name: 'LUCKY CRAFT',
    discover: discoverLuckyCraft,
    excludedNameKeywords: [],
  },
  {
    slug: 'duel',
    name: 'DUEL',
    discover: discoverDuel,
    excludedNameKeywords: [],
  },
  {
    slug: 'tacklehouse',
    name: 'Tackle House',
    discover: discoverTacklehouse,
    excludedNameKeywords: ['フック', 'HOOK', 'パーツ', 'PARTS', 'ロッド', 'ROD', 'リール', 'REEL', 'スペア', 'SPARE', 'トローリング'],
    excludedUrlSlugs: ['mlh', 'nts', 'tsuno', 'saltia'],
  },
  {
    slug: 'zipbaits',
    name: 'ZIPBAITS',
    discover: discoverZipbaits,
    excludedNameKeywords: [],  // ルアー専業のため除外不要
  },
  {
    slug: 'smith',
    name: 'SMITH',
    discover: discoverSmith,
    excludedNameKeywords: [],
    // URL-level exclusions (rods, accessories, tools) are handled in discoverSmith() itself.
  },
  {
    slug: 'tiemco',
    name: 'TIEMCO',
    discover: discoverTiemco,
    excludedNameKeywords: [],
    // Category-based filtering (rods, accessories, apparel) is handled in discoverTiemco() itself.
  },
  {
    slug: 'raid',
    name: 'RAID JAPAN',
    discover: discoverRaid,
    excludedNameKeywords: [],
    // All products on Lures + Backyard pages are lures. No filtering needed.
  },
  {
    slug: 'nories',
    name: 'Nories',
    discover: discoverNories,
    excludedNameKeywords: [],
    // Category/slug filtering is handled inside discoverNories() itself.
  },
  {
    slug: 'rapala',
    name: 'Rapala',
    discover: discoverRapala,
    excludedNameKeywords: [],
    // URL-level filtering (non-lure pages, top pages) is handled in discoverRapala() itself.
  },
  {
    slug: 'maria',
    name: 'Maria',
    discover: discoverMaria,
    excludedNameKeywords: [],
    // All products on /maria/product/gm/plug are lures. No filtering needed.
  },
  {
    slug: 'bassday',
    name: 'Bassday',
    discover: discoverBassday,
    excludedNameKeywords: [],
    // All 6 categories contain only lures. No filtering needed.
  },
  {
    slug: 'jackson',
    name: 'Jackson',
    discover: discoverJackson,
    excludedNameKeywords: [],
    excludedUrlSlugs: ['maccheroni-spare-parts-kit'],
    // Rod filtering done in discover function via tag detection.
  },
  {
    slug: 'gamakatsu',
    name: 'がまかつ',
    discover: discoverGamakatsu,
    excludedNameKeywords: [],
    // Filtering done in discover function via GAMAKATSU_EXCLUDE_PATTERNS.
  },
  {
    slug: 'gary-yamamoto',
    name: 'Gary Yamamoto',
    discover: discoverGaryYamamoto,
    excludedNameKeywords: ['フック', 'HOOK', 'シンカー', 'SINKER', 'アパレル', 'ステッカー', 'DVD'],
    // URL-level filtering done in discover function.
  },
  {
    slug: 'issei',
    name: 'issei',
    discover: discoverIssei,
    excludedNameKeywords: [],
    // issei sitemaps contain only lure/soft bait products (green_cray_fish + umitaro CPTs).
    // No filtering needed — rods/accessories are separate CPTs not in these sitemaps.
  },
  {
    slug: 'valleyhill',
    name: 'ValleyHill',
    discover: discoverValleyhill,
    excludedNameKeywords: [
      'フック', 'HOOK', 'ハサミ', '斬鋏', 'プライヤー',
      'リング', 'スナップ', 'スイベル', 'シンカー', 'オモリ',
      'リーダー', 'ロッド', 'リール', 'バッグ', 'ケース',
      'ホルダー', 'ランヤード', 'カラビナ', 'ツール', 'ギャフ',
      'タモ', 'ネット', 'グローブ', 'フィッシュグリップ', 'ストリンガー',
      'ワイヤー', 'ライヴワイア', 'LIVE WIRE', 'アシスト', 'ASSIST',
    ],
    // ValleyHill has no usable sitemap — must crawl 17 category pages.
    // Category pages contain lures + accessories mixed together.
    // Name-based keyword exclusion filters out non-lure products.
  },
  {
    slug: 'majorcraft',
    name: 'Major Craft',
    discover: discoverMajorcraft,
    excludedNameKeywords: [],
    // Major Craft /lure/ page lists all lure products (jigs, plugs, soft baits, etc.).
    // Hook/blade/jig-head/rig products are lure accessories and SHOULD be included.
    // No URL-level or name-level filtering needed.
  },
  {
    slug: 'yamashita',
    name: 'YAMASHITA',
    discover: discoverYamashita,
    excludedNameKeywords: [
      'フック', 'HOOK', 'スナップ', 'リーダー', 'ライン',
      'ロッド', 'リール', 'バッグ', 'ケース', 'グローブ',
      'ギャフ', 'タモ', 'ネット', 'ツール', 'プライヤー',
    ],
    // YAMASHITA has 8 category pages with pagination (12 items/page).
    // Some categories (other) may include non-lure accessories.
    // ワーム, スッテ, エギ, タコベイト are all lures — do NOT exclude them.
  },
  {
    slug: 'imakatsu',
    name: 'IMAKATSU',
    discover: discoverImakatsu,
    excludedNameKeywords: [],
    // IMAKATSU has 3 category pages (hard-lure, soft-lure, other-lure), no pagination.
    // Legacy www2 links are skipped in discover function.
    // All products are lures — no filtering needed.
    // "ワームもルアーやろ？" — soft lures are included.
  },
  {
    slug: 'bottomup',
    name: 'BOTTOMUP',
    discover: discoverBottomup,
    excludedNameKeywords: [],
    // BOTTOMUP has a single /products/ page with 3 sections: hardlure, softlure, accessory.
    // Accessories are filtered out in the discover function.
    // All remaining products are bass lures.
    // "ワームもルアーやろ？" — soft lures (including PORK) are included.
  },
  {
    slug: 'fisharrow',
    name: 'Fish Arrow',
    discover: discoverFisharrow,
    excludedNameKeywords: [],
    // Fish Arrow uses WP REST API (/wp-json/wp/v2/product?per_page=100).
    // 49 products total. Categories 6(Bass) + 7(Salt) = lures only.
    // Categories 8(Sinker & Item) + 9(Others) = excluded in discover function.
    // data-type attribute: soft-lure, hard-lure (included), sinker/rod/other (excluded by category).
    // "ワームもルアーやろ？" — soft lures are included.
  },
  {
    slug: 'keitech',
    name: 'Keitech',
    discover: discoverKeitech,
    excludedNameKeywords: [],
    // Keitech uses custom CMS (NOT WordPress). No REST API, no sitemap.
    // Product listing at /pages/636/ with links to /pages/{ID}/.
    // 54 products total. Excluded: Custom Rods (4) + Terminal Tackle/Jig Heads (7).
    // Remaining ~43 products are all bass lures (ワーム, ラバージグ, バズベイト, etc.).
    // "ワームもルアーやろ？" — soft lures are included.
  },
  {
    slug: 'sawamura',
    name: 'Sawamura',
    discover: discoverSawamura,
    excludedNameKeywords: [],
    // Sawamura lures sold through karil.co.jp (Welcart e-commerce on WordPress).
    // WP REST API disabled. Products discovered via subcategory pages.
    // 10 Sawamura subcategories (lures), 2 excluded (jig heads: cat=47,48).
    // ~50 lure products. All are bass lures.
    // "ワームもルアーやろ？" — soft lures are included.
  },
  {
    slug: 'dstyle',
    name: 'DSTYLE',
    discover: discoverDstyle,
    excludedNameKeywords: [],
    // dstyle-lure.co.jp — WordPress custom theme, custom post type "products"
    // /products/ lists all: soft-lure(59), hard-lure(13), jackalldstyle(11), jigs(8)
    // Exclude: rod(6), accessory(41). ~91 lure products.
    // All products are bass lures. "ワームもルアーやろ？"
  },
  {
    slug: 'ecogear',
    name: 'Ecogear',
    discover: discoverEcogear,
    excludedNameKeywords: [
      'ヘッド', 'テンヤ', 'オイル', 'リキッド', 'パウダー', 'ボトル',
      'ストッカー', 'キーパー', 'キャップ', 'コバリ', '孫針',
      'ポケットイン', 'リグ', 'コンビ',
    ],
    // ecogear.jp — WordPress, REST API available. Two CPTs: ecogear (76) + fishleague (7)
    // Exclude: jig heads, tenya, accessories, sets, oil/powder/liquid.
    // ~53 lure products (worms, soft baits, hard baits, metal jigs, egi).
  },
  {
    slug: 'geecrack',
    name: 'GEECRACK',
    discover: discoverGeecrack,
    excludedNameKeywords: [],
    // www.geecrack.com — Custom PHP (Xserver), no REST API
    // 10 lure categories: bass(hard_lure, soft_lure, wire_bait, jig) + saltwater(ika, aji, aomono, tai, seabass, rockfish)
    // Excluded categories: rod, sinker_hook, accessories (not scraped)
    // All products in lure categories are actual lures. "ワームもルアーやろ？"
  },
  {
    slug: 'reins',
    name: 'REINS',
    discover: discoverReins,
    excludedNameKeywords: [],
    // reinsfishing.com — WordPress + WooCommerce + Flatsome theme
    // WC Store API: /wp-json/wc/store/products (no auth required)
    // Lure categories: soft-baits, worms, craws-creatures, swimbaits
    // Non-lure: tungsten-weights, hooks, accessories — filtered by pa_color attribute
    // All REINS lures are soft baits (ワーム). "ワームもルアーやろ？"
    // Japanese site (reinjp.com) unreachable. USD pricing stored as 0.
  },
  {
    slug: 'berkley',
    name: 'Berkley',
    discover: discoverBerkley,
    excludedNameKeywords: ['fireline', 'vanish', 'trilene', 'x5 ', 'x9 ', 'messenger bag', 'mesh cap', 'jacket', 'cutter', 'clipper', 'plier', 'net', 'scale', 'stringer'],
    excludedUrlSlugs: ['/line/', '/acse/', '/bag/'],
    // purefishing.jp — Movable Type CMS, no REST API
    // Sitemap: /sitemap.xml → filter /product/berkley/*.html
    // Static HTML pages — fetch-only, no Playwright needed
    // Two spec table layouts: soft bait (no weight) vs hard bait (with weight/length)
    // Colors: spec table rows + swatch images (.productColorValidationArea)
    // Price: ¥{amount} in spec table (税抜)
  },
  {
    slug: 'engine',
    name: 'ENGINE',
    discover: discoverEngine,
    excludedNameKeywords: [],
    excludedUrlSlugs: [],
    // engine.rings-fishing.jp — WordPress 6.2.2, product CPT at /page2/{slug}/
    // Category pages: /syouhin/soft-bait/, /syouhin/hard-bait/, /syouhin/loops/, /syouhin/collaboration/
    // Fetch-only, no Playwright needed. All products target ブラックバス.
    // Soft bait detection: "入数" in spec text → ワーム
  },
  {
    slug: 'hideup',
    name: 'HIDEUP',
    discover: discoverHideup,
    excludedNameKeywords: [],
    excludedUrlSlugs: HIDEUP_EXCLUDED_SLUGS,
    // hideup.jp — Custom PHP + Bootstrap 5.3.3, no CMS/API/sitemap
    // Single product listing at /product/, products at /product/{slug}.php
    // Fetch-only, no Playwright needed. Primary target: ブラックバス, some saltwater.
    // Soft bait detection: "入数" in spec text (but jig name takes priority)
  },
  {
    slug: 'littlejack',
    name: 'Little Jack',
    discover: discoverLittleJack,
    excludedNameKeywords: LITTLEJACK_EXCLUDED_NAMES,
    excludedUrlSlugs: [],
    // www.little-jack-lure.com — WordPress 6.6.4 + TCD Falcon theme
    // WP REST API: /wp-json/wp/v2/pages?template=page-lp.php (LP pages = product pages)
    // URL pattern: /?page_id={ID}. Fetch-only, no Playwright needed.
    // Primary target: ソルトウォーター全般（シーバス、青物、根魚、イカ等）
    // Colors: WordPress gallery (dl.gallery-item), JAN CODE table fallback
    // "ワームもルアーやろ？" — soft lures are included.
  },
  {
    slug: 'jumprize',
    name: 'Jumprize',
    discover: discoverJumprize,
    excludedNameKeywords: JUMPRIZE_EXCLUDED_NAMES,
    excludedUrlSlugs: [],
    // jumprize.com — Jimdo Creator, sitemap.xml discovery
    // Product pages: /lure/series{N}/{slug}/
    // Fetch-only, no Playwright. Salt専門（シーバス・ヒラメ・青物）
  },
  {
    slug: 'thirtyfour',
    name: '34',
    discover: discoverThirtyfour,
    excludedNameKeywords: THIRTYFOUR_EXCLUDED_NAMES,
    excludedUrlSlugs: [],
    // 34net.jp — WordPress + custom theme, WP REST API
    // Products: /products/worm/{slug}/ — ワーム専門
    // Fetch-only, no Playwright. アジング専門（アジ・メバル）
    // "ワームもルアーやろ？" — worms are included.
  },
  {
    slug: 'tict',
    name: 'TICT',
    discover: discoverTict,
    excludedNameKeywords: TICT_EXCLUDED_NAMES,
    excludedUrlSlugs: TICT_EXCLUDED_SLUGS,
    // tict-net.com — static HTML, Shift_JIS, nginx
    // Product pages: /product/{slug}.html
    // Fetch-only, no Playwright. ライトゲーム専門（アジ・メバル）
  },
  {
    slug: 'noike',
    name: 'NOIKE',
    discover: discoverNoike,
    excludedNameKeywords: NOIKE_EXCLUDED_NAMES,
    excludedUrlSlugs: NOIKE_EXCLUDED_SLUGS,
    // noike-m.com — WordPress 6.9, Lightning theme, WP REST API
    // Product pages: /{slug}/
    // Fetch-only, no Playwright. バス釣り専門（ブラックバス）
    // "ワームもルアーやろ？" — worms are included.
  },
  {
    slug: 'baitbreath',
    name: 'BAIT BREATH',
    discover: discoverBaitBreath,
    excludedNameKeywords: BAITBREATH_EXCLUDED_NAMES,
    excludedUrlSlugs: BAITBREATH_EXCLUDED_SLUGS,
    // baitbreath.net — static HTML, HTTP-only, Apache
    // Product pages: /{slug}.html
    // Fetch-only, no Playwright. ワーム中心メーカー
    // "ワームもルアーやろ？" — worms are included.
  },
  {
    slug: 'palms',
    name: 'Palms',
    discover: discoverPalms,
    excludedNameKeywords: PALMS_EXCLUDED_NAMES,
    excludedUrlSlugs: PALMS_EXCLUDED_SLUGS,
    // palmsjapan.com — static HTML, nginx, Bootstrap
    // Product pages: /lures/product/?name={slug}
    // Fetch-only, no Playwright. ソルト・トラウト向けハードルアー
  },
  {
    slug: 'madness',
    name: 'MADNESS',
    discover: discoverMadness,
    excludedNameKeywords: MADNESS_EXCLUDED_NAMES,
    excludedUrlSlugs: MADNESS_EXCLUDED_SLUGS,
    // madness.co.jp — WordPress, fetch-only
    // Product pages: /products/{category}/{slug}
    // シーバス・バス向け。ワーム含む。
    // "ワームもルアーやろ？" — worms are included.
  },
  {
    slug: 'forest',
    name: 'Forest',
    discover: discoverForest,
    excludedNameKeywords: [],
    // forestjp.com — WordPress (MH Magazine theme), fetch-only
    // Category pages: /products/area-lure/, /products/native-lure/
    // トラウト用スプーン・プラグメーカー
  },
  {
    slug: 'hmkl',
    name: 'HMKL',
    discover: discoverHmkl,
    excludedNameKeywords: [],
    // hmklnet.com — static HTML (Shift_JIS), fetch-only
    // Product listing: /products/, individual pages: /products/pickup/{name}/
    // トラウト・バス用ハンドメイドルアー
  },
  {
    slug: 'hots',
    name: 'HOTS',
    discover: discoverHots,
    excludedNameKeywords: [],
    // hots.co.jp — static HTML (jQuery+Bootstrap), fetch-only
    // Product pages: /lure-{name}.html
    // オフショアジギング・キャスティング専門
  },
  {
    slug: 'ja-do',
    name: 'JADO',
    discover: discoverJado,
    excludedNameKeywords: [],
    // ja-do.jp — WordPress + Elementor, single page (/products)
    // All products on toggle accordion panels
    // シーバス用ルアーメーカー
  },
  {
    slug: 'mc-works',
    name: 'MC Works',
    discover: discoverMcWorks,
    excludedNameKeywords: [],
    // mcworks.jp — WordPress, fetch-only
    // Category pages: /products/prodyct_category/{slug} (typo in URL is real)
    // オフショアジギング専門メタルジグ
  },
  {
    slug: 'mukai',
    name: 'MUKAI',
    discover: discoverMukai,
    excludedNameKeywords: [],
    // mukai-fishing.jp — WordPress REST API (posts, categories=4)
    // Product pages: /{slug}/
    // エリアトラウト用スプーン・クランク・ミノー
  },
  {
    slug: 'nature-boys',
    name: 'Nature Boys',
    discover: discoverNatureBoys,
    excludedNameKeywords: [],
    // e-natureboys.com — WordPress REST API (pages, categories 6,35)
    // Product pages: /{slug}/
    // オフショアジギング用メタルジグ・プラグ
  },
  {
    slug: 'north-craft',
    name: 'NORTH CRAFT',
    discover: discoverNorthCraft,
    excludedNameKeywords: [],
    // rapala.co.jp/cn10/ — static HTML (BiND CMS), fetch-only
    // Product pages: /cn10/{name}.html
    // シーバス・ヒラスズキ用ミノー
  },
  {
    slug: 'valkein',
    name: 'Valkein',
    discover: discoverValkein,
    excludedNameKeywords: [],
    // valkein.jp — WordPress, fetch-only
    // Category pages: /products/spoons/, /products/hardbaits/, /products/metalvibe/
    // エリアトラウト用スプーン・プラグ
  },
  {
    slug: 'beat',
    name: 'beat',
    discover: discoverBeat,
    excludedNameKeywords: BEAT_SKIP_TITLE_KEYWORDS,
    // beat-jig.com — WordPress, WP REST API, fetch-only
    // CPT: product-item, メタルジグ専門
  },
  {
    slug: 'boreas',
    name: 'BOREAS',
    discover: discoverBoreas,
    excludedNameKeywords: BOREAS_EXCLUDE_TITLE_LOWER,
    // flashpointonlineshop.com — Shopify JSON API, fetch-only
    // バス用ワーム・ラバージグ中心
  },
  {
    slug: 'bozles',
    name: 'BOZLES',
    discover: discoverBozles,
    excludedNameKeywords: [],
    // bozles.com — Square Online SPA, hardcoded product list
    // TGメタルジグ専門（ジギング・タイラバ）
  },
  {
    slug: 'carpenter',
    name: 'Carpenter',
    discover: discoverCarpenter,
    excludedNameKeywords: [],
    // carpenter.ne.jp — static HTML, hardcoded product list
    // オフショアキャスティング用プラグ・メタルジグ
  },
  {
    slug: 'cb-one',
    name: 'CB ONE',
    discover: discoverCbOne,
    excludedNameKeywords: [],
    excludedUrlSlugs: Array.from(CB_ONE_SKIP_SLUGS),
    // cb-one.co.jp — WordPress, WP REST API, fetch-only
    // キャスティングプラグ・メタルジグ
  },
  {
    slug: 'crazy-ocean',
    name: 'CRAZY OCEAN',
    discover: discoverCrazyOcean,
    excludedNameKeywords: ['スペアネクタイ', '絡め手フック', '替えフック', 'アシスト'],
    // crazy-ocean.com — WordPress, WP REST API, fetch-only
    // CPT: itemlist, メタルジグ・エギ・タイラバ・ワーム
  },
  {
    slug: 'd-claw',
    name: 'D-Claw',
    discover: discoverDClaw,
    excludedNameKeywords: [],
    // d-claw.jp — static HTML, hardcoded product list
    // オフショアキャスティング用ダイビングペンシル・ポッパー・メタルジグ
  },
  {
    slug: 'deepliner',
    name: 'Deep Liner',
    discover: discoverDeepliner,
    excludedNameKeywords: [],
    excludedUrlSlugs: Array.from(DEEPLINER_BROKEN_SLUGS),
    // deepliner.com — static HTML, item.html listing
    // スロージギング用メタルジグ専門
  },
  {
    slug: 'drt',
    name: 'DRT',
    discover: discoverDrt,
    excludedNameKeywords: [],
    // divisionrebeltackles.com — WordPress, fetch-only
    // Category pages: /products/bait/, /products/soft-bait/, /products/jig/
    // ビッグベイト・ワーム・ラバージグ
  },
  {
    slug: 'flash-union',
    name: 'Flash Union',
    discover: discoverFlashUnion,
    excludedNameKeywords: [],
    excludedUrlSlugs: Array.from(FLASH_UNION_SKIP_SLUGS),
    // flash-union.jp — custom PHP, fetch-only
    // Product listing at /product/, バス用ハード・ソフトルアー
  },
  {
    slug: 'breaden',
    name: 'BREADEN',
    discover: discoverBreaden,
    excludedNameKeywords: [],
    // breaden.net — Static HTML, fetch-only
    // ライトゲーム系ルアー（メバル・アジ・チヌ）
  },
  {
    slug: 'dranckrazy',
    name: 'DRANCKRAZY',
    discover: discoverDranckrazy,
    excludedNameKeywords: [],
    // dranckrazy.com — WooCommerce, fetch-only
    // ハンドメイドルアー
  },
  {
    slug: 'harimitsu',
    name: 'HARIMITSU',
    discover: discoverHarimitsu,
    excludedNameKeywords: [],
    // harimitsu.co.jp — WordPress, fetch-only
    // エギ・墨族シリーズ
  },
  {
    slug: 'hayabusa',
    name: 'Hayabusa',
    discover: discoverHayabusa,
    excludedNameKeywords: [],
    // hayabusa.co.jp — WordPress, WP REST API, fetch-only
    // メタルジグ・仕掛け・ジグヘッド
  },
  {
    slug: 'longin',
    name: 'LONGIN',
    discover: discoverLongin,
    excludedNameKeywords: [],
    // longin.jp — Static HTML, fetch-only
    // シーバス・青物用ミノー・シンペン
  },
  {
    slug: 'seafloor-control',
    name: 'SEAFLOOR CONTROL',
    discover: discoverSeafloorControl,
    excludedNameKeywords: [],
    // seafloor-control.com — WordPress, fetch-only
    // スロージギング用メタルジグ
  },
  {
    slug: 'xesta',
    name: 'XESTA',
    discover: discoverXesta,
    excludedNameKeywords: [],
    // xesta.jp — WordPress, fetch-only
    // ショアジギング・ライトゲーム・オフショア・エギ
  },
  {
    slug: 'zeake',
    name: 'ZEAKE',
    discover: discoverZeake,
    excludedNameKeywords: [],
    // zeake.jp — WordPress/Cocoon, fetch-only
    // メタルジグ・ブレードジグ
  },
  {
    slug: 'attic',
    name: 'ATTIC',
    discover: discoverAttic,
    excludedNameKeywords: [],
    // attic.ne.jp — static HTML, fetch-only
    // シーバスルアー
  },
  {
    slug: 'damiki',
    name: 'DAMIKI JAPAN',
    discover: discoverDamiki,
    excludedNameKeywords: [],
    // damiki-japan.com — WordPress, WP REST API
    // バス用ルアー
  },
  {
    slug: 'dreemup',
    name: 'DreemUp',
    discover: discoverDreemup,
    excludedNameKeywords: [],
    // dreem-up.com — WordPress, WP REST API
    // シーバス・ライトゲーム
  },
  {
    slug: 'god-hands',
    name: 'GOD HANDS',
    discover: discoverGodHands,
    excludedNameKeywords: [],
    // god-hands.jp — static/WordPress, fetch-only
    // トラウト用スプーン・プラグ
  },
  {
    slug: 'grassroots',
    name: 'GRASS ROOTS',
    discover: discoverGrassroots,
    excludedNameKeywords: [],
    // grassroots-kms.com — static/WordPress, fetch-only
    // メタルジグ・オフショアルアー
  },
  {
    slug: 'itocraft',
    name: 'ITO.CRAFT',
    discover: discoverItocraft,
    excludedNameKeywords: [],
    // itocraft.com — static/WordPress, fetch-only
    // トラウト用ミノー・スプーン
  },
  {
    slug: 'ivy-line',
    name: 'IVY LINE',
    discover: discoverIvyLine,
    excludedNameKeywords: [],
    // ivyline.jp — WordPress/SWELL, WP REST API
    // トラウト用スプーン・プラグ
  },
  {
    slug: 'jazz',
    name: 'JAZZ',
    discover: discoverJazz,
    excludedNameKeywords: [],
    // jazz-lure.com — WordPress, WP REST API
    // アジ・メバル用ジグヘッド・ワーム
  },
  {
    slug: 'jungle-gym',
    name: 'Jungle Gym',
    discover: discoverJungleGym,
    excludedNameKeywords: [],
    // junglegym-world.net — WordPress, WP REST API
    // アジ・メバル用ジグヘッド
  },
  {
    slug: 'mibro',
    name: 'Mibro',
    discover: discoverMibro,
    excludedNameKeywords: [],
    // mibro.jp — Wix site, Playwright-based discovery
    // バス用ルアー全般
  },
  {
    slug: 'obasslive',
    name: 'O.bass Live',
    discover: discoverObasslive,
    excludedNameKeywords: [],
    // obasslive.com — WordPress, WP REST API
    // バス用ルアー全般
  },
  {
    slug: 'phat-lab',
    name: 'PHAT LAB',
    discover: discoverPhatLab,
    excludedNameKeywords: [],
    // phatlab.jp — custom/WordPress, WP REST API
    // ビッグベイト
  },
  {
    slug: 'pickup',
    name: 'PICKUP',
    discover: discoverPickup,
    excludedNameKeywords: [],
    // pickup-m.jp — WordPress, sitemap-based discovery
  },
  {
    slug: 'pozidrive-garage',
    name: 'POZIDRIVE GARAGE',
    discover: discoverPozidriveGarage,
    excludedNameKeywords: [],
    // pdg.co.jp — WordPress, WP REST API
  },
  {
    slug: 'sea-falcon',
    name: 'SEA FALCON',
    discover: discoverSeaFalcon,
    excludedNameKeywords: [],
    // seafalcon.jp — WordPress, WP REST API
    // メタルジグ・オフショアルアー
  },
  {
    slug: 'shout',
    name: 'SHOUT!',
    discover: discoverShout,
    excludedNameKeywords: [],
    // shout-net.com — static HTML, fetch-only
    // フック・アシストフック・メタルジグ
  },
  {
    slug: 'signal',
    name: 'SIGNAL',
    discover: discoverSignal,
    excludedNameKeywords: [],
    // signal-lure.com — static HTML, fetch-only
    // バス用ルアー
  },
  {
    slug: 'skagit',
    name: 'Skagit Designs',
    discover: discoverSkagit,
    excludedNameKeywords: [],
    // skagitwebshop.com — Shopify, products.json API
    // シーバス・ライトゲーム
  },
  {
    slug: 'souls',
    name: 'SOULS',
    discover: discoverSouls,
    excludedNameKeywords: [],
    // souls.jp — WordPress, WP REST API
    // トラウト用ルアー
  },
  {
    slug: 'th-tackle',
    name: 'TH tackle',
    discover: discoverThTackle,
    excludedNameKeywords: [],
    // t-hamada.com — WordPress, WP REST API
    // バス用ビッグベイト
  },
  {
    slug: 'viva',
    name: 'VIVA',
    discover: discoverViva,
    excludedNameKeywords: [],
    // vivanet.co.jp — WordPress, WP REST API
    // バス・ソルト用ルアー
  },
  {
    slug: 'yarie',
    name: 'Yarie',
    discover: discoverYarie,
    excludedNameKeywords: [],
    // etanba.co.jp — WordPress, WP REST API
    // トラウト用スプーン
  },
  {
    slug: 'zero-dragon',
    name: 'ZERO DRAGON',
    discover: discoverZeroDragon,
    excludedNameKeywords: [],
    // zero-dragon.com — Shop-Pro, fetch-only
    // タイラバ・メタルジグ
  },
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
  log('Launching browser (headless)...');
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
        if (mfg.requiresHeadedBrowser) {
          // Some sites (e.g. Shimano) block headless browsers via WAF.
          // Launch a separate headed browser with a real User-Agent.
          log(`[${mfg.slug}] Launching headed browser (WAF workaround)...`);
          const headedBrowser = await chromium.launch({ headless: false });
          try {
            const ctx = await headedBrowser.newContext({
              userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            });
            const headedPage = await ctx.newPage();
            discovered = await mfg.discover(headedPage);
            await headedPage.close();
            await ctx.close();
          } finally {
            await headedBrowser.close();
            log(`[${mfg.slug}] Headed browser closed`);
          }
        } else {
          discovered = await mfg.discover(page);
        }
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
        if (existingUrls.has(normalizeUrl(url))) continue;

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
