// One-shot script: register all ZIPBAITS product URLs into Airtable
// Run: npx tsx scripts/register-zipbaits-urls.ts [--dry-run]

import { chromium } from 'playwright';

const ZB_BASE = 'https://www.zipbaits.com';

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const DRY_RUN = process.argv.includes('--dry-run');

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
  // Search existing
  const formula = encodeURIComponent(`{Slug}="${slug}"`);
  const data = await airtableFetch(`${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=${formula}`);
  if (data.records && data.records.length > 0) {
    console.log(`Maker found: ${name} (${data.records[0].id})`);
    return data.records[0].id;
  }
  // Create
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
// Crawl all product URLs from category pages
// ---------------------------------------------------------------------------

async function crawlProductUrls(): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const allUrls: string[] = [];
  const seenIds = new Set<string>();

  // ZIPBAITS categories: c=1 TROUT, c=2 SEA BASS, c=3 KURODAI, c=4 LIGHT SALT, c=5 BASS
  const categories = [1, 2, 3, 4, 5];

  for (const cat of categories) {
    const url = `${ZB_BASE}/item/?c=${cat}`;
    console.log(`Crawling category ${cat}: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for product links to appear
    await page.waitForSelector('a[href*="?i="]', { timeout: 10000 }).catch(() => {
      console.log(`  Warning: no product links found in category ${cat}`);
    });

    const links = await page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="?i="]');
      var urls: string[] = [];
      for (var i = 0; i < anchors.length; i++) {
        var href = (anchors[i] as HTMLAnchorElement).href;
        if (href && urls.indexOf(href) === -1) {
          urls.push(href);
        }
      }
      return urls;
    });

    console.log(`  Found ${links.length} products in category ${cat}`);

    for (const link of links) {
      // Extract ID for deduplication
      const idMatch = link.match(/[?&]i=(\d+)/);
      if (idMatch) {
        const id = idMatch[1];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allUrls.push(link);
        }
      }
    }
  }

  await browser.close();
  return allUrls;
}

// ---------------------------------------------------------------------------
// Register URLs to Airtable
// ---------------------------------------------------------------------------

async function registerUrls(urls: string[], makerId: string): Promise<void> {
  console.log(`\nRegistering ${urls.length} URLs to Airtable...`);

  // Batch in groups of 10
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

    // Rate limit
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

  // Print all URLs
  urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would register all URLs above.');
    process.exit(0);
  }

  // 2. Find or create maker
  const makerId = await findOrCreateMaker('ZIPBAITS', 'zipbaits');

  // 3. Register
  await registerUrls(urls, makerId);

  console.log('\nDone!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
