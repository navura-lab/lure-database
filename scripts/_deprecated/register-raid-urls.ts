// One-shot script: register all RAID JAPAN lure product URLs into Airtable
// Run: npx tsx scripts/register-raid-urls.ts [--dry-run]
//
// Strategy:
//   1. Fetch Lures page (page_id=43) — main product listing
//   2. Fetch Backyard page (page_id=14122) — additional products
//   3. Extract ?product=slug links, deduplicate
//   4. Verify each URL returns 200 (not 404)
//   5. Register to Airtable

import { chromium } from 'playwright';

var RAID_BASE = 'http://raidjapan.com';

var AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
var AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
var AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

var DRY_RUN = process.argv.includes('--dry-run');

// Pages containing lure product links
var LISTING_PAGES = [
  { url: `${RAID_BASE}/?page_id=43`, label: 'Lures' },
  { url: `${RAID_BASE}/?page_id=14122`, label: 'Backyard' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [register-raid] ${msg}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableGet(tableId: string, params: string = ''): Promise<any> {
  var url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}${params ? '?' + params : ''}`;
  var res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });
  if (!res.ok) throw new Error(`Airtable GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function airtablePost(tableId: string, records: any[]): Promise<any> {
  var url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`;
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records }),
  });
  if (!res.ok) throw new Error(`Airtable POST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findOrCreateMaker(): Promise<string> {
  var data = await airtableGet(
    AIRTABLE_MAKER_TABLE_ID,
    `filterByFormula=${encodeURIComponent('{Slug}="raid"')}`
  );
  if (data.records.length > 0) {
    log(`Maker exists: ${data.records[0].id}`);
    return data.records[0].id;
  }
  log('Creating maker record...');
  var created = await airtablePost(AIRTABLE_MAKER_TABLE_ID, [
    { fields: { 'メーカー名': 'RAID JAPAN', 'Slug': 'raid' } },
  ]);
  log(`Maker created: ${created.records[0].id}`);
  return created.records[0].id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // 1. Discover product URLs from listing pages
  var browser = await chromium.launch({ headless: true });
  var context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  var allSlugs = new Set<string>();

  for (var config of LISTING_PAGES) {
    var page = await context.newPage();
    log(`Fetching ${config.label}: ${config.url}`);
    await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    var slugs = await page.evaluate(function () {
      var links = document.querySelectorAll('a[href*="?product="]');
      var results: string[] = [];
      for (var i = 0; i < links.length; i++) {
        var href = (links[i] as HTMLAnchorElement).href;
        var match = href.match(/[?&]product=([^&#]+)/);
        if (match) results.push(match[1]);
      }
      return results;
    });

    for (var s of slugs) allSlugs.add(s);
    log(`${config.label}: found ${slugs.length} product links (${allSlugs.size} unique total)`);
    await page.close();
  }

  await browser.close();

  var slugList = Array.from(allSlugs).sort();
  log(`Total unique products: ${slugList.length}`);

  // 2. Build URLs and verify (spot check first 5 for 404)
  var urls: string[] = [];
  var errors404: string[] = [];

  for (var slug of slugList) {
    var productUrl = `${RAID_BASE}/?product=${slug}`;
    urls.push(productUrl);
  }

  // Spot-check for 404s (first 5 + last 5)
  var checkIndices = [...Array(Math.min(5, urls.length)).keys()];
  for (var ci = Math.max(0, urls.length - 5); ci < urls.length; ci++) {
    if (!checkIndices.includes(ci)) checkIndices.push(ci);
  }

  for (var idx of checkIndices) {
    try {
      var resp = await fetch(urls[idx], {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      if (resp.status === 404) {
        errors404.push(urls[idx]);
        log(`404: ${urls[idx]}`);
      }
    } catch (e: any) {
      log(`Check error for ${urls[idx]}: ${e.message}`);
    }
  }

  log(`Verified ${checkIndices.length} URLs, ${errors404.length} 404s`);

  if (DRY_RUN) {
    log(`\n=== DRY RUN RESULTS ===`);
    log(`Total URLs to register: ${urls.length}`);
    log(`404 errors: ${errors404.length}`);
    for (var u of urls) console.log(`  ${u}`);
    return;
  }

  // 3. Register to Airtable
  var makerId = await findOrCreateMaker();

  // Register in batches of 10
  var registered = 0;
  for (var i = 0; i < urls.length; i += 10) {
    var batch = urls.slice(i, i + 10);
    var records = batch.map(function (url) {
      return {
        fields: {
          URL: url,
          'メーカー': [makerId],
          'ステータス': '未処理',
        },
      };
    });

    await airtablePost(AIRTABLE_TABLE_ID, records);
    registered += batch.length;
    log(`Registered ${registered}/${urls.length}`);

    if (i + 10 < urls.length) await sleep(250);
  }

  log(`\n=== REGISTRATION COMPLETE ===`);
  log(`Maker: RAID JAPAN (${makerId})`);
  log(`URLs registered: ${registered}`);
  log(`404 errors: ${errors404.length}`);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
