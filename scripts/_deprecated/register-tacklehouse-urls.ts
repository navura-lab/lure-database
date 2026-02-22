// One-shot script: register all Tackle House product URLs into Airtable
// Run: npx tsx scripts/register-tacklehouse-urls.ts [--dry-run]

import { chromium } from 'playwright';

const TH_BASE = 'https://tacklehouse.co.jp';
const PRODUCTS_URL = `${TH_BASE}/product/`;

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const DRY_RUN = process.argv.includes('--dry-run');

// Excluded page slugs (not lure products: overview pages, accessories)
const EXCLUDED_SLUGS = [
  'index', 'datasheet',
  'kten', 'contact', 'shores', 'elfin',  // series overview pages (not individual products)
  'k2', 'twinkle', 'buffet', 'resistance', 'rb', 'pj', 'bo', 'cruise', 'shibuki',  // sub-series overview pages
  'mlh',    // マグネットルアーホルダー (accessory)
  'nts',    // ノントラブルスティック (accessory)
  'tsuno',  // tool/accessory
  'saltia', // tool/accessory
];

// Excluded name keywords (accessories, not lures)
// NOTE: Don't use 'リング' — it matches inside 'ローリング' (Rolling Bait)
const EXCLUDED_KEYWORDS = ['フック', 'HOOK', 'パーツ', 'PARTS', 'ロッド', 'ROD', 'リール', 'REEL', 'スペア', 'SPARE', 'トローリング'];

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
  if (!created.records || created.records.length === 0) {
    console.error('Failed to create maker:', JSON.stringify(created));
    throw new Error('Failed to create maker record');
  }
  const id = created.records[0].id;
  console.log(`Maker created: ${name} (${id})`);
  return id;
}

// ---------------------------------------------------------------------------
// Crawl all product URLs from the single catalog page
// ---------------------------------------------------------------------------

async function crawlProductUrls(): Promise<{ url: string; name: string }[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Crawling catalog: ${PRODUCTS_URL}`);
  await page.goto(PRODUCTS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const products = await page.evaluate(function () {
    var results: { url: string; name: string }[] = [];
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

  await browser.close();

  // Deduplicate and filter
  const seen = new Set<string>();
  const filtered: { url: string; name: string }[] = [];

  for (const p of products) {
    // Extract slug
    const slugMatch = p.url.match(/\/product\/([^/]+)\.html/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];

    // Skip excluded slugs
    if (EXCLUDED_SLUGS.includes(slug)) continue;

    // Skip duplicates
    if (seen.has(slug)) continue;
    seen.add(slug);

    // Skip excluded keywords in name
    const nameUpper = p.name.toUpperCase();
    let excluded = false;
    for (const kw of EXCLUDED_KEYWORDS) {
      if (nameUpper.includes(kw.toUpperCase())) {
        excluded = true;
        break;
      }
    }
    if (excluded) {
      console.log(`  Excluded: ${p.name} (${slug})`);
      continue;
    }

    // Normalize URL
    const normalizedUrl = `${TH_BASE}/product/${slug}.html`;
    filtered.push({ url: normalizedUrl, name: p.name || slug });
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Register URLs to Airtable
// ---------------------------------------------------------------------------

async function registerUrls(urls: { url: string; name: string }[], makerId: string): Promise<void> {
  console.log(`\nRegistering ${urls.length} URLs to Airtable...`);

  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const records = batch.map((item) => ({
      fields: {
        URL: item.url,
        'ルアー名': item.name,
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

  const products = await crawlProductUrls();
  console.log(`\nTotal unique product URLs: ${products.length}`);

  if (products.length === 0) {
    console.log('No URLs found. Exiting.');
    process.exit(1);
  }

  products.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} → ${p.url}`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would register all URLs above.');
    process.exit(0);
  }

  // Maker record already exists (created manually), use known ID
  const makerId = 'recXaa8gnO0iamZZV';
  console.log(`Using maker ID: ${makerId}`);
  await registerUrls(products, makerId);

  console.log('\nDone!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
