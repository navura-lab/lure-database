// scripts/register-rapala-urls.ts
// Discovers and registers all Rapala brand lure URLs from rapala.co.jp
// Covers: Rapala, Storm, Blue Fox, Luhr-Jensen, North Craft
//
// Usage:
//   npx tsx scripts/register-rapala-urls.ts --dry-run   # preview
//   npx tsx scripts/register-rapala-urls.ts              # register

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

// Brand listing pages
var BRAND_LISTINGS = [
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

  for (var brand of BRAND_LISTINGS) {
    console.log(`\n--- ${brand.name} ---`);
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

    // Filter
    var productUrls = links.filter(function (l) {
      if (l.indexOf(brand.filterPrefix) === -1) return false;
      for (var kw of brand.excludeKeywords) {
        if (l.indexOf(kw) >= 0) return false;
      }
      return true;
    });

    // Deduplicate
    var unique = [...new Set(productUrls)];
    console.log(`  Found: ${unique.length} product URLs`);
    allUrls.push(...unique);
  }

  await browser.close();

  // Deduplicate across brands
  var uniqueAll = [...new Set(allUrls)];
  console.log(`\nTotal unique URLs: ${uniqueAll.length}`);

  if (DRY_RUN) {
    console.log('\nAll URLs:');
    for (var u of uniqueAll) {
      console.log(`  ${u}`);
    }
    console.log('\nDry run complete. No records created.');
    return;
  }

  // Get or create maker record
  var makerId: string;
  try {
    makerId = await findMakerRecordId('Rapala');
    console.log('Found existing Rapala maker:', makerId);
  } catch {
    makerId = await createMakerRecord('Rapala', 'rapala');
    console.log('Created new Rapala maker:', makerId);
  }

  // Register URLs
  var count = await registerUrls(uniqueAll, makerId);
  console.log(`\nRegistered ${count} URLs in Airtable.`);
}

main().catch(console.error);
