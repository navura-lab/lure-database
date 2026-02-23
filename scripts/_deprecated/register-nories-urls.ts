// One-shot script: register all Nories lure product URLs into Airtable
// Run: npx tsx scripts/register-nories-urls.ts [--dry-run]
//
// Strategy:
//   1. Bass: WP REST API → filter out rods (id=7) and accessories (id=11)
//   2. Salt: Sitemap → only oyster-minnow-92 (the only salt lure)
//   3. Trout: Listing page → LURES section only (exclude rods/accessories)
//   4. Register all to Airtable

import { chromium } from 'playwright';

var AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
var AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
var AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

var DRY_RUN = process.argv.includes('--dry-run');

// Bass categories to EXCLUDE (IDs from WP REST API /wp-json/wp/v2/basscate)
var BASS_EXCLUDE_CATEGORY_IDS = [7, 11]; // rods, accessories

// Bass slugs to EXCLUDE (miscategorized non-lure products)
var BASS_EXCLUDE_SLUGS = [
  'black-performance-treble-hooks', // hooks, not lures (miscategorized as hard-baits)
  'aging-bass-liquid',              // bait liquid (miscategorized as soft-baits)
  'bitepowder-ebi',                 // bait powder (miscategorized as soft-baits)
  'bitebass-liquid',                // bait liquid (miscategorized as soft-baits)
];

// Known salt lure slugs (everything else is rods/jigheads)
var SALT_LURE_SLUGS = ['oyster-minnow-92'];

// Trout products to EXCLUDE (rods + accessories)
var TROUT_EXCLUDE_SLUGS = [
  'spike-arrow', 'escloser', 'ambitious-craque', // rods
  'fish-releaser-ns-01', 'trout-tackle-storage-ns-01_pa', // accessories
  'feed', // not a lure product (feed/news)
];

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [register-nories] ${msg}`);
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
    `filterByFormula=${encodeURIComponent('{Slug}="nories"')}`
  );
  if (data.records.length > 0) {
    log(`Maker exists: ${data.records[0].id}`);
    return data.records[0].id;
  }
  log('Creating maker record...');
  var created = await airtablePost(AIRTABLE_MAKER_TABLE_ID, [
    { fields: { 'メーカー名': 'Nories', 'Slug': 'nories' } },
  ]);
  log(`Maker created: ${created.records[0].id}`);
  return created.records[0].id;
}

// ---------------------------------------------------------------------------
// URL collection functions
// ---------------------------------------------------------------------------

async function collectBassUrls(): Promise<string[]> {
  log('Collecting bass lure URLs via WP REST API...');
  var urls: string[] = [];
  var page = 1;
  var perPage = 100;

  while (true) {
    var apiUrl = `https://nories.com/wp-json/wp/v2/bass?per_page=${perPage}&page=${page}&_fields=slug,basscate,link`;
    var res = await fetch(apiUrl);
    if (!res.ok) {
      if (res.status === 400) break; // No more pages
      throw new Error(`WP API ${res.status}: ${await res.text()}`);
    }
    var products: any[] = await res.json();
    if (products.length === 0) break;

    for (var p of products) {
      // Skip excluded categories
      var categories: number[] = p.basscate || [];
      var excluded = categories.some(function (c: number) {
        return BASS_EXCLUDE_CATEGORY_IDS.includes(c);
      });
      if (excluded) {
        log(`  Skip (rod/accessory): ${p.slug}`);
        continue;
      }
      // Slug-based exclusion for miscategorized items
      if (BASS_EXCLUDE_SLUGS.includes(p.slug)) {
        log(`  Skip (not lure): ${p.slug}`);
        continue;
      }
      urls.push(p.link);
    }

    log(`  API page ${page}: ${products.length} items, ${urls.length} lures so far`);
    page++;
    await sleep(200);
  }

  log(`Bass lures: ${urls.length}`);
  return urls;
}

async function collectSaltUrls(): Promise<string[]> {
  log('Collecting salt lure URLs...');
  var urls: string[] = [];
  for (var slug of SALT_LURE_SLUGS) {
    urls.push(`https://nories.com/salt/${slug}/`);
  }
  log(`Salt lures: ${urls.length}`);
  return urls;
}

async function collectTroutUrls(): Promise<string[]> {
  log('Collecting trout lure URLs via listing page...');
  var browser = await chromium.launch({ headless: true });
  var context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  var page = await context.newPage();
  await page.goto('https://trout.nories.com/products/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  var allLinks = await page.evaluate(function () {
    // Find all product links under the LURES section
    var h2s = document.querySelectorAll('h2');
    var luresH2: HTMLElement | null = null;
    var accessoriesH2: HTMLElement | null = null;

    for (var i = 0; i < h2s.length; i++) {
      var text = (h2s[i].textContent || '').trim();
      if (text === 'LURES') luresH2 = h2s[i] as HTMLElement;
      if (text === 'ACCESSORIES') accessoriesH2 = h2s[i] as HTMLElement;
    }

    if (!luresH2) return [];

    // Collect all links between LURES and ACCESSORIES headings
    var links: string[] = [];
    var current: Node | null = luresH2.nextSibling;
    while (current) {
      if (current === accessoriesH2) break;
      if (current instanceof HTMLElement) {
        // If we hit another h2, stop
        if (current.tagName === 'H2') break;
        var anchors = current.querySelectorAll('a[href*="/products/"]');
        for (var j = 0; j < anchors.length; j++) {
          var href = (anchors[j] as HTMLAnchorElement).href;
          if (href.includes('/products/') && !href.endsWith('/products/')) {
            links.push(href);
          }
        }
      }
      current = current.nextSibling;
    }
    return links;
  });

  await browser.close();

  // Deduplicate and filter
  var seen = new Set<string>();
  var urls: string[] = [];
  for (var link of allLinks) {
    // Extract slug
    var match = link.match(/\/products\/([^/]+)\/?$/);
    if (!match) continue;
    var slug = match[1];
    if (TROUT_EXCLUDE_SLUGS.includes(slug)) {
      log(`  Skip (excluded): ${slug}`);
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    urls.push(`https://trout.nories.com/products/${slug}/`);
  }

  log(`Trout lures: ${urls.length}`);
  return urls;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  // 1. Collect all lure URLs
  var bassUrls = await collectBassUrls();
  var saltUrls = await collectSaltUrls();
  var troutUrls = await collectTroutUrls();

  var allUrls = [...bassUrls, ...saltUrls, ...troutUrls];
  log(`\nTotal lure URLs: ${allUrls.length} (bass: ${bassUrls.length}, salt: ${saltUrls.length}, trout: ${troutUrls.length})`);

  if (DRY_RUN) {
    log(`\n=== DRY RUN RESULTS ===`);
    log(`Total URLs to register: ${allUrls.length}`);
    for (var u of allUrls) console.log(`  ${u}`);
    return;
  }

  // 2. Register to Airtable
  var makerId = await findOrCreateMaker();

  var registered = 0;
  for (var i = 0; i < allUrls.length; i += 10) {
    var batch = allUrls.slice(i, i + 10);
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
    log(`Registered ${registered}/${allUrls.length}`);

    if (i + 10 < allUrls.length) await sleep(250);
  }

  log(`\n=== REGISTRATION COMPLETE ===`);
  log(`Maker: Nories (${makerId})`);
  log(`URLs registered: ${registered}`);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
