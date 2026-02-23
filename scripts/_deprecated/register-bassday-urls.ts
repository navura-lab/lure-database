// scripts/register-bassday-urls.ts
// Discovers and registers all Bassday lure URLs from bassday.co.jp
//
// 6 category pages (no pagination — all products on one page):
//   c=1 (ネイティブトラウト), c=2 (エリア/フレッシュ), c=4 (ソルト),
//   c=5 (ライトソルト), c=6 (オフショア), c=7 (バス)
//
// Product detail: /item/?i={ID}
// JS rendering required (Playwright).
// IDs may appear in multiple categories — dedup by ID.
//
// Usage:
//   npx tsx scripts/register-bassday-urls.ts --dry-run   # preview
//   npx tsx scripts/register-bassday-urls.ts              # register

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

// Category listing pages — all 6 categories
var CATEGORIES = [
  { url: 'https://www.bassday.co.jp/item/?c=1', name: 'ネイティブトラウト' },
  { url: 'https://www.bassday.co.jp/item/?c=2', name: 'エリア/フレッシュウォーター' },
  { url: 'https://www.bassday.co.jp/item/?c=4', name: 'ソルトウォーター' },
  { url: 'https://www.bassday.co.jp/item/?c=5', name: 'ライトソルト' },
  { url: 'https://www.bassday.co.jp/item/?c=6', name: 'オフショア' },
  { url: 'https://www.bassday.co.jp/item/?c=7', name: 'バス' },
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
    console.log(`  Registered batch ${Math.floor(i / 10) + 1} (total: ${registered})`);
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

  // Collect all product IDs across categories (dedup by ID)
  var seenIds: Record<string, boolean> = {};
  var allUrls: string[] = [];

  for (var cat of CATEGORIES) {
    console.log(`\nCategory: ${cat.name} (${cat.url})`);
    await page.goto(cat.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS rendering — wait for content
    await page.waitForTimeout(3000);

    var ids: string[] = await page.evaluate(function () {
      // Links: <a href="./?i=79">
      var anchors = document.querySelectorAll('a[href*="?i="]');
      var results: string[] = [];
      for (var j = 0; j < anchors.length; j++) {
        var href = (anchors[j] as HTMLAnchorElement).getAttribute('href') || '';
        var match = href.match(/[?&]i=(\d+)/);
        if (match && results.indexOf(match[1]) === -1) {
          results.push(match[1]);
        }
      }
      return results;
    });

    console.log(`  Found: ${ids.length} product IDs`);

    var newCount = 0;
    for (var id of ids) {
      if (!seenIds[id]) {
        seenIds[id] = true;
        allUrls.push('https://www.bassday.co.jp/item/?i=' + id);
        newCount++;
      }
    }
    console.log(`  New (after dedup): ${newCount}`);
  }

  await browser.close();

  console.log(`\nTotal unique URLs: ${allUrls.length}`);

  if (DRY_RUN) {
    console.log('\nAll URLs:');
    for (var u of allUrls) {
      console.log(`  ${u}`);
    }
    console.log('\nDry run complete. No records created.');
    return;
  }

  // Get or create maker record
  var makerId: string;
  try {
    makerId = await findMakerRecordId('Bassday');
    console.log('Found existing Bassday maker:', makerId);
  } catch {
    makerId = await createMakerRecord('Bassday', 'bassday');
    console.log('Created new Bassday maker:', makerId);
  }

  // Register URLs
  var count = await registerUrls(allUrls, makerId);
  console.log(`\nRegistered ${count} URLs in Airtable.`);
}

main().catch(console.error);
