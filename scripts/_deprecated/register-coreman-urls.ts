// scripts/register-coreman-urls.ts
// One-time script to register all COREMAN product URLs in Airtable.
// Crawls the lure listing page at /product_lure/ (single page, no pagination).
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-coreman-urls.ts              # normal run
//   npx tsx scripts/register-coreman-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COREMAN_BASE_URL = 'https://www.coreman.jp';
const COREMAN_LURE_LIST_URL = `${COREMAN_BASE_URL}/product_lure/`;

// Products with these keywords in their name are excluded
// Note: COREMAN's "on HOOK" products are lure sets (e.g., CZ-30 ZETTAI on Hook)
// so we only exclude items that ARE hooks themselves (シルバークロー / SILVER CLAW)
const EXCLUDED_NAME_KEYWORDS = [
  'パーツ',
  'PARTS',
  'スペア',
  'SPARE',
  'シルバークロー',    // COREMAN's hook product
  'SILVER CLAW',
];

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const PAGE_LOAD_DELAY_MS = 3000;
const DRY_RUN = process.argv.includes('--dry-run');

const AIRTABLE_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [register-coreman] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-coreman] ERROR: ${message}`);
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

async function fetchOrCreateCoremanRecordId(): Promise<string> {
  const filter = encodeURIComponent("{Slug}='coreman'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing COREMAN maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  log('COREMAN maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create COREMAN maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'COREMAN',
        'Slug': 'coreman',
      },
    }),
  });

  log(`Created COREMAN maker record: ${created.id}`);
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
  let normalized = url.trim();
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}

function isExcluded(name: string, url: string): boolean {
  const lower = name.toLowerCase();
  const urlLower = url.toLowerCase();

  // Keyword exclusion
  if (EXCLUDED_NAME_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) return true;

  // External link exclusion (DUO collaboration products)
  if (!urlLower.includes('coreman.jp')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
}

async function discoverProducts(page: Page): Promise<DiscoveredProduct[]> {
  log(`Crawling COREMAN lure listing: ${COREMAN_LURE_LIST_URL}`);

  await page.goto(COREMAN_LURE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const productData = await page.evaluate((baseUrl: string) => {
    const links = document.querySelectorAll('a[href]');
    const products: Array<{ url: string; text: string }> = [];
    const seen = new Set<string>();

    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') || '';

      // Match: /product_lure/{slug} or full URL with product_lure/{slug}
      if (!/\/product_lure\/[^/?#]+/.test(href)) continue;

      // Skip the listing page itself
      if (href === '/product_lure/' || href.endsWith('/product_lure')) continue;
      const cleanHref = href.replace(/\/$/, '');
      if (cleanHref === '/product_lure' || cleanHref.endsWith('/product_lure')) continue;

      const fullUrl = href.startsWith('http')
        ? href
        : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

      // Normalize
      const normalized = fullUrl.endsWith('/') ? fullUrl : fullUrl + '/';
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Get product name from link text
      const text = link.textContent?.trim()?.split('\n')[0]?.trim() || '';
      products.push({ url: normalized, text: text.substring(0, 100) });
    }

    return products;
  }, COREMAN_BASE_URL);

  const products: DiscoveredProduct[] = productData.map(p => ({
    url: p.url,
    name: p.text || '(名前取得失敗)',
  }));

  log(`Discovered ${products.length} product links`);
  return products;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`=== COREMAN URL Registration Script ===`);
  if (DRY_RUN) log('*** DRY RUN MODE — no writes ***');

  let browser: Browser | null = null;

  try {
    // 1. Discover products from COREMAN website
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    const allProducts = await discoverProducts(page);
    await browser.close();
    browser = null;

    // 2. Apply exclusion rules
    const included: DiscoveredProduct[] = [];
    const excluded: DiscoveredProduct[] = [];
    for (const p of allProducts) {
      if (isExcluded(p.name, p.url)) {
        excluded.push(p);
      } else {
        included.push(p);
      }
    }

    log(`\nDiscovery results:`);
    log(`  Total found: ${allProducts.length}`);
    log(`  Excluded:    ${excluded.length}`);
    excluded.forEach(p => log(`    - ${p.name} (${p.url})`));
    log(`  Included:    ${included.length}`);

    // 3. Fetch existing Airtable URLs to deduplicate
    const existingUrls = await fetchExistingAirtableUrls();

    const newProducts = included.filter(p => !existingUrls.has(normalizeUrl(p.url)));
    const duplicates = included.length - newProducts.length;

    log(`\nDeduplication:`);
    log(`  Already in Airtable: ${duplicates}`);
    log(`  New products:        ${newProducts.length}`);

    if (newProducts.length === 0) {
      log('\nNo new products to register. Done!');
      return;
    }

    // 4. List new products
    log(`\nNew products to register:`);
    newProducts.forEach((p, i) => log(`  ${i + 1}. ${p.name} — ${p.url}`));

    if (DRY_RUN) {
      log(`\nDRY RUN complete. Would register ${newProducts.length} products.`);
      return;
    }

    // 5. Get/create COREMAN maker record
    const makerId = await fetchOrCreateCoremanRecordId();

    // 6. Register products in Airtable
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
