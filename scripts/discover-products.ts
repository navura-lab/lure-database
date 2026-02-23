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
