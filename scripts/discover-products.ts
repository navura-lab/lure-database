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
// Manufacturer configurations
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
