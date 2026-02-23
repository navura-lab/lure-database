// scripts/register-maria-urls.ts
// Discovers and registers all Maria lure URLs from yamaria.co.jp
//
// Product listing: /maria/product/gm/plug (36 products, 3 pages, 12/page)
// Product detail: /maria/product/detail/{ID}
//
// Usage:
//   npx tsx scripts/register-maria-urls.ts --dry-run   # preview
//   npx tsx scripts/register-maria-urls.ts              # register

import 'dotenv/config';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
var AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
var AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
var AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

var DRY_RUN = process.argv.includes('--dry-run');

// Listing pages — plug category only (36 products, 3 pages)
var LISTING_PAGES = [
  'https://www.yamaria.co.jp/maria/product/gm/plug',
  'https://www.yamaria.co.jp/maria/product/gm/plug?absolutepage=2',
  'https://www.yamaria.co.jp/maria/product/gm/plug?absolutepage=3',
];

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function findMakerRecordId(makerName: string): Promise<string> {
  var url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_MAKER_TABLE_ID}?filterByFormula={メーカー名}="${makerName}"&maxRecords=1`;
  var res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
  var json = (await res.json()) as any;
  if (json.records && json.records.length > 0) return json.records[0].id;
  throw new Error(`Maker "${makerName}" not found`);
}

async function createMakerRecord(name: string, slug: string): Promise<string> {
  var url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_MAKER_TABLE_ID}`;
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: { 'メーカー名': name, 'Slug': slug } }),
  });
  var json = (await res.json()) as any;
  return json.id;
}

async function registerUrls(urls: string[], makerRecordId: string): Promise<number> {
  var registered = 0;
  // Airtable batch: max 10 per request
  for (var i = 0; i < urls.length; i += 10) {
    var batch = urls.slice(i, i + 10);
    var records = batch.map(function (u) {
      return {
        fields: {
          URL: u,
          'メーカー': [makerRecordId],
          'ステータス': '未処理',
        },
      };
    });
    var res = await fetch(
      `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records }),
      },
    );
    if (!res.ok) {
      var errText = await res.text();
      throw new Error(`Airtable error: ${res.status} ${errText}`);
    }
    registered += batch.length;
    if (i + 10 < urls.length) {
      await new Promise(function (r) { setTimeout(r, 250); }); // rate limit
    }
  }
  return registered;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  var browser = await chromium.launch({ headless: true });
  var ctx = await browser.newContext();
  var page = await ctx.newPage();

  var allUrls: string[] = [];

  for (var i = 0; i < LISTING_PAGES.length; i++) {
    var listUrl = LISTING_PAGES[i];
    console.log(`\nPage ${i + 1}/${LISTING_PAGES.length}: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    var links: string[] = await page.evaluate(function () {
      var anchors = document.querySelectorAll('a[href*="/product/detail/"]');
      var results: string[] = [];
      for (var j = 0; j < anchors.length; j++) {
        var href = (anchors[j] as HTMLAnchorElement).href;
        if (results.indexOf(href) === -1) results.push(href);
      }
      return results;
    });

    console.log(`  Found: ${links.length} product links`);
    allUrls.push(...links);
  }

  await browser.close();

  // Deduplicate
  var unique = [...new Set(allUrls)];
  console.log(`\nTotal unique URLs: ${unique.length}`);

  if (DRY_RUN) {
    console.log('\nAll URLs:');
    for (var u of unique) {
      console.log(`  ${u}`);
    }
    console.log('\nDry run complete. No records created.');
    return;
  }

  // Get or create maker record
  var makerId: string;
  try {
    makerId = await findMakerRecordId('Maria');
    console.log('Found existing Maria maker:', makerId);
  } catch {
    makerId = await createMakerRecord('Maria', 'maria');
    console.log('Created new Maria maker:', makerId);
  }

  // Register URLs
  var count = await registerUrls(unique, makerId);
  console.log(`\nRegistered ${count} URLs in Airtable.`);
}

main().catch(console.error);
