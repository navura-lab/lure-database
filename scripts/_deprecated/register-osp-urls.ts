// scripts/register-osp-urls.ts
// One-time script to register all O.S.P product URLs in Airtable.
// Crawls 13 category pages (bass/salt/trout/ayu hardlure/softlure/wirebait/jig/metal/frog/metaljig/tairubber).
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-osp-urls.ts              # normal run
//   npx tsx scripts/register-osp-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OSP_BASE_URL = 'https://www.o-s-p.net';

// All category pages to crawl
const CATEGORY_PAGES = [
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

// Products with these exact slugs are excluded (parts/hooks/accessories)
const EXCLUDED_SLUGS = new Set([
  'tie_asym',
  'tie_double',
  'tie_str',
  'tie_unit',
]);

// Products with these keywords in their name are excluded
const EXCLUDED_NAME_KEYWORDS = [
  'ネクタイ',
  'アシストフック',
  'フックセット',
  'HOOK SET',
  'パーツ',
  'PARTS',
  'スペア',
  'SPARE',
];

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const PAGE_LOAD_DELAY_MS = 2000;
const DRY_RUN = process.argv.includes('--dry-run');
const AIRTABLE_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [register-osp] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-osp] ERROR: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function fetchOrCreateOspRecordId(): Promise<string> {
  const filter = encodeURIComponent("{Slug}='osp'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing O.S.P maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  log('O.S.P maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create O.S.P maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'O.S.P',
        'Slug': 'osp',
      },
    }),
  });

  log(`Created O.S.P maker record: ${created.id}`);
  return created.id;
}

async function createAirtableRecords(
  records: Array<{ name: string; url: string }>,
  makerId: string,
): Promise<{ registered: number; errors: number }> {
  let registered = 0;
  let errors = 0;
  const today = new Date().toISOString().split('T')[0];

  for (let i = 0; i < records.length; i += AIRTABLE_BATCH_SIZE) {
    const batch = records.slice(i, i + AIRTABLE_BATCH_SIZE);

    try {
      await airtableFetch(
        AIRTABLE_LURE_URL_TABLE_ID,
        '',
        {
          method: 'POST',
          body: JSON.stringify({
            records: batch.map(r => ({
              fields: {
                'ルアー名': r.name,
                'URL': r.url,
                'メーカー': [makerId],
                'ステータス': '未処理',
                '備考': `初回一括登録 (${today})`,
              },
            })),
          }),
        },
      );
      registered += batch.length;
      log(`  Registered batch ${Math.floor(i / AIRTABLE_BATCH_SIZE) + 1}: ${batch.length} records`);
    } catch (err) {
      errors += batch.length;
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`  Batch ${Math.floor(i / AIRTABLE_BATCH_SIZE) + 1} failed: ${errMsg}`);
    }

    await sleep(250);
  }

  return { registered, errors };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}

function extractSlug(url: string): string {
  const match = url.match(/\/products\/([^/?#]+)/);
  return match ? match[1].toLowerCase().replace(/\/$/, '') : '';
}

function isExcludedBySlug(slug: string): boolean {
  return EXCLUDED_SLUGS.has(slug);
}

function isExcludedByName(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_NAME_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
  category: string;
}

async function discoverProductsFromCategory(
  page: Page,
  categoryPath: string,
): Promise<DiscoveredProduct[]> {
  const categoryUrl = `${OSP_BASE_URL}${categoryPath}`;
  log(`Crawling: ${categoryUrl}`);

  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const products = await page.evaluate((baseUrl: string) => {
    const results: Array<{ url: string; name: string }> = [];
    // Product cards are in .pbox containers or similar
    const links = document.querySelectorAll('a[href*="/products/"]');

    for (const link of links) {
      const href = link.getAttribute('href') || '';
      // Match /products/{slug}/ pattern
      const match = href.match(/\/products\/([a-zA-Z0-9_-]+)\/?$/);
      if (!match) continue;

      const slug = match[1];
      // Skip category/listing pages
      if (slug === 'products' || slug === 'products-list') continue;

      const fullUrl = `${baseUrl}/products/${slug}/`;

      // Get product name
      let name = '';
      const nameEl = link.querySelector('h4, h3, p, span');
      if (nameEl) name = nameEl.textContent?.trim() || '';
      if (!name) name = link.textContent?.trim()?.split('\n')[0]?.trim() || '';
      name = name.substring(0, 100);

      results.push({ url: fullUrl, name: name || slug });
    }

    return results;
  }, OSP_BASE_URL);

  log(`  Found ${products.length} product links in ${categoryPath}`);

  return products.map(p => ({
    url: p.url,
    name: p.name,
    category: categoryPath,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`=== O.S.P URL Registration Script ===`);
  if (DRY_RUN) log('*** DRY RUN MODE — no writes ***');

  let browser: Browser | null = null;

  try {
    // 1. Discover products from all category pages
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const allRaw: DiscoveredProduct[] = [];
    for (const catPath of CATEGORY_PAGES) {
      const products = await discoverProductsFromCategory(page, catPath);
      allRaw.push(...products);
      await sleep(500); // Be polite between pages
    }

    await browser.close();
    browser = null;

    log(`\nTotal raw product links: ${allRaw.length}`);

    // 2. Deduplicate by URL (same product can appear in multiple categories)
    const seen = new Map<string, DiscoveredProduct>();
    for (const p of allRaw) {
      const normalized = normalizeUrl(p.url);
      if (!seen.has(normalized)) {
        seen.set(normalized, p);
      }
    }
    const allProducts = [...seen.values()];
    log(`After deduplication: ${allProducts.length} unique products`);

    // 3. Apply exclusion rules
    const included: DiscoveredProduct[] = [];
    const excluded: DiscoveredProduct[] = [];
    for (const p of allProducts) {
      const slug = extractSlug(p.url);
      if (isExcludedBySlug(slug) || isExcludedByName(p.name)) {
        excluded.push(p);
      } else {
        included.push(p);
      }
    }

    log(`\nDiscovery results:`);
    log(`  Total unique: ${allProducts.length}`);
    log(`  Excluded:     ${excluded.length}`);
    excluded.forEach(p => log(`    - ${p.name} (${p.url})`));
    log(`  Included:     ${included.length}`);

    // 4. Fetch existing Airtable URLs to deduplicate
    const existingUrls = await fetchExistingAirtableUrls();

    const newProducts = included.filter(p => !existingUrls.has(normalizeUrl(p.url)));
    const duplicates = included.length - newProducts.length;

    log(`\nDeduplication with Airtable:`);
    log(`  Already in Airtable: ${duplicates}`);
    log(`  New products:        ${newProducts.length}`);

    if (newProducts.length === 0) {
      log('\nNo new products to register. Done!');
      return;
    }

    // 5. List new products
    log(`\nNew products to register:`);
    newProducts.forEach((p, i) => log(`  ${i + 1}. ${p.name} — ${p.url}`));

    if (DRY_RUN) {
      log(`\nDRY RUN complete. Would register ${newProducts.length} products.`);
      return;
    }

    // 6. Get/create O.S.P maker record
    const makerId = await fetchOrCreateOspRecordId();

    // 7. Register products in Airtable
    log(`\nRegistering ${newProducts.length} products in Airtable...`);
    const { registered, errors } = await createAirtableRecords(newProducts, makerId);

    log(`\n=== Registration Complete ===`);
    log(`  Registered: ${registered}`);
    log(`  Errors:     ${errors}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`Fatal error: ${errMsg}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();
