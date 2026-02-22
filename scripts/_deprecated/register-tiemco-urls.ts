// One-shot script: register all TIEMCO lure product URLs into Airtable
// Run: npx tsx scripts/register-tiemco-urls.ts [--dry-run]
//
// Strategy:
//   1. Fetch 3 main lure category pages with dpcnt=-1 (all on one page)
//   2. Additionally search for ayu/snakehead/small fish lures
//   3. Extract ProductDetail.aspx links, deduplicate by pid
//   4. Filter: only include lure categories (002001003, 002001004, 002002004, 002004*, 002005*)
//   5. Register to Airtable

import { chromium } from 'playwright';

const TIEMCO_BASE = 'https://www.tiemco.co.jp';

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Category pages to crawl
// ---------------------------------------------------------------------------

// Main lure categories — paginate with dpcnt=40, iterate pno until fewer than dpcnt items
const CATEGORY_CONFIGS = [
  { cat: '002001003', label: 'Bass Hard Lures', expected: 69 },
  { cat: '002001004', label: 'Bass Soft Lures', expected: 38 },
  { cat: '002002004', label: 'Trout Hard Lures', expected: 35 },
];

// Search-based pages for smaller categories
const SEARCH_PAGES = [
  '/Form/Product/ProductList.aspx?swrd=%E9%AE%8E%E3%83%AB%E3%82%A2%E3%83%BC&bid=lurefishing&dpcnt=40&pno=1',   // 鮎ルアー
  '/Form/Product/ProductList.aspx?swrd=%E9%9B%B7%E9%AD%9A&bid=lurefishing&dpcnt=40&pno=1',                      // 雷魚
  '/Form/Product/ProductList.aspx?swrd=%E5%B0%8F%E7%89%A9%E9%87%A3%E3%82%8A&bid=lurefishing&dpcnt=40&pno=1',   // 小物釣り
];

// Valid lure category prefixes (cat parameter in product URLs)
const LURE_CAT_PREFIXES = [
  '002001003',  // Bass Hard Lures
  '002001004',  // Bass Soft Lures
  '002002004',  // Trout Hard Lures
  '002004',     // Ayu
  '002005',     // Snakehead
  '002006',     // Small Fish
];

// Excluded category prefixes (rods, accessories, apparel, etc.)
const EXCLUDED_CAT_PREFIXES = [
  '002001001',  // Bass Rods (baitcasting)
  '002001002',  // Bass Rods (spinning)
  '002001005',  // Bass Accessories
  '002001006',  // Bass Line
  '002001007',  // Bass Apparel
  '002002001',  // Trout Rods
  '002002002',  // Trout Rods
  '002002003',  // Trout Rods
  '002002005',  // Trout Accessories
  '001',        // Fly Fishing
  '003',        // Foxfire
];

function isLureCategory(catCode: string): boolean {
  // Check excluded first
  for (var i = 0; i < EXCLUDED_CAT_PREFIXES.length; i++) {
    if (catCode.startsWith(EXCLUDED_CAT_PREFIXES[i])) return false;
  }
  // Check included
  for (var j = 0; j < LURE_CAT_PREFIXES.length; j++) {
    if (catCode.startsWith(LURE_CAT_PREFIXES[j])) return true;
  }
  // If no cat code or unknown, need manual check
  return false;
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch(path: string, options: any = {}) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json() as any;
}

async function findOrCreateMaker(name: string, slug: string): Promise<string> {
  const formula = encodeURIComponent(`{Slug}="${slug}"`);
  const data = await airtableFetch(`${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=${formula}`);
  if (data.records && data.records.length > 0) {
    console.log(`Maker found: ${name} (${data.records[0].id})`);
    return data.records[0].id;
  }
  const created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields: { 'メーカー名': name, 'Slug': slug } }],
    }),
  });
  const id = created.records[0].id;
  console.log(`Maker created: ${name} (${id})`);
  return id;
}

// ---------------------------------------------------------------------------
// Crawl all product URLs
// ---------------------------------------------------------------------------

async function crawlProductUrls(): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const seenPids = new Set<string>();
  const allUrls: string[] = [];

  // Helper to extract product links from a page
  async function extractProductLinks(): Promise<string[]> {
    return page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="ProductDetail.aspx"]');
      var results: string[] = [];
      for (var i = 0; i < anchors.length; i++) {
        var href = (anchors[i] as HTMLAnchorElement).href;
        if (href && results.indexOf(href) === -1) {
          results.push(href);
        }
      }
      return results;
    });
  }

  function processLinks(links: string[]): void {
    for (const link of links) {
      var pidMatch = link.match(/[?&]pid=(\d+)/);
      if (!pidMatch) continue;
      var pid = pidMatch[1];

      var catMatch = link.match(/[?&]cat=(\d+)/);
      var catCode = catMatch ? catMatch[1] : '';

      // Filter: only lure categories
      if (catCode && !isLureCategory(catCode)) continue;

      if (seenPids.has(pid)) continue;
      seenPids.add(pid);

      allUrls.push(link);
    }
  }

  // 1. Crawl main category pages with pagination
  for (const config of CATEGORY_CONFIGS) {
    console.log(`\nCrawling: ${config.label} (cat=${config.cat})...`);
    let pno = 1;
    let totalFromCategory = 0;

    while (true) {
      const catUrl = `${TIEMCO_BASE}/Form/Product/ProductList.aspx?cat=${config.cat}&bid=lurefishing&dpcnt=40&pno=${pno}`;
      console.log(`  Page ${pno}: ${catUrl}`);

      try {
        await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('a[href*="ProductDetail.aspx"]', { timeout: 10000 }).catch(function () {});

        const links = await extractProductLinks();
        console.log(`    Found ${links.length} product links`);

        if (links.length === 0) break;

        const beforeCount = allUrls.length;
        processLinks(links);
        const added = allUrls.length - beforeCount;
        totalFromCategory += added;

        // If fewer than 40 links, we've reached the last page
        if (links.length < 40) break;

        pno++;
        await new Promise(function (r) { setTimeout(r, 1000); });
      } catch (err) {
        console.error(`    Error: ${err}`);
        break;
      }
    }
    console.log(`  Total from ${config.label}: ${totalFromCategory} unique URLs`);
  }

  // 2. Crawl search-based pages (no pagination needed, small results)
  for (const searchPath of SEARCH_PAGES) {
    const searchUrl = TIEMCO_BASE + searchPath;
    console.log(`\nCrawling search: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('a[href*="ProductDetail.aspx"]', { timeout: 10000 }).catch(function () {
        console.log('  Warning: no product links found');
      });

      const links = await extractProductLinks();
      console.log(`  Found ${links.length} product links`);
      processLinks(links);
    } catch (err) {
      console.error(`  Error: ${err}`);
    }

    await new Promise(function (r) { setTimeout(r, 1000); });
  }

  await browser.close();
  return allUrls;
}

// ---------------------------------------------------------------------------
// Verify URLs (check for 404s)
// ---------------------------------------------------------------------------

async function verifyUrls(urls: string[]): Promise<string[]> {
  console.log(`\nVerifying ${urls.length} URLs for 404s...`);
  const valid: string[] = [];
  let notFound = 0;

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { method: 'HEAD', redirect: 'follow' });
      if (res.ok) {
        valid.push(urls[i]);
      } else {
        console.log(`  ❌ ${res.status}: ${urls[i]}`);
        notFound++;
      }
    } catch {
      console.log(`  ❌ Error: ${urls[i]}`);
      notFound++;
    }

    // Rate limit
    if (i % 20 === 19) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`  Valid: ${valid.length}, Not Found: ${notFound}`);
  return valid;
}

// ---------------------------------------------------------------------------
// Register URLs to Airtable
// ---------------------------------------------------------------------------

async function registerUrls(urls: string[], makerId: string): Promise<void> {
  console.log(`\nRegistering ${urls.length} URLs to Airtable...`);

  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const records = batch.map((url) => ({
      fields: {
        URL: url,
        'メーカー': [makerId],
        'ステータス': '未処理',
      },
    }));

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would register batch ${Math.floor(i / 10) + 1}: ${batch.length} URLs`);
      continue;
    }

    const result = await airtableFetch(AIRTABLE_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify({ records }),
    });

    if (result.error) {
      console.error(`Error at batch ${Math.floor(i / 10) + 1}:`, result.error);
    } else {
      console.log(`Registered batch ${Math.floor(i / 10) + 1}: ${result.records.length} URLs`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // 1. Crawl all product URLs
  const urls = await crawlProductUrls();
  console.log(`\nTotal unique product URLs: ${urls.length}`);

  if (urls.length === 0) {
    console.log('No URLs found. Exiting.');
    process.exit(1);
  }

  // 2. Verify (filter 404s)
  const validUrls = await verifyUrls(urls);
  console.log(`\nValid product URLs: ${validUrls.length}`);

  // Print all URLs
  validUrls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would register all URLs above.');
    process.exit(0);
  }

  // 3. Find or create maker
  const makerId = await findOrCreateMaker('TIEMCO', 'tiemco');

  // 4. Register
  await registerUrls(validUrls, makerId);

  console.log('\nDone!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
