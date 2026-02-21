// scripts/register-apia-urls.ts
// One-time script to register all APIA product URLs in Airtable.
// Crawls the lure listing page at /product/lure/ (single page, no pagination).
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-apia-urls.ts              # normal run
//   npx tsx scripts/register-apia-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const APIA_BASE_URL = 'https://www.apiajapan.com';
const APIA_LURE_LIST_URL = `${APIA_BASE_URL}/product/lure/`;

// Products with these keywords in their name or type are excluded
const EXCLUDED_NAME_KEYWORDS = [
  'ルアーパーツ',
  'パーツ',
  'フック',
  'HOOK',
  'スペア',
  'SPARE',
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
  console.log(`[${timestamp()}] [register-apia] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-apia] ERROR: ${message}`);
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

async function fetchOrCreateApiaRecordId(): Promise<string> {
  const filter = encodeURIComponent("{Slug}='apia'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing APIA maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  log('APIA maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create APIA maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'APIA',
        'Slug': 'apia',
      },
    }),
  });

  log(`Created APIA maker record: ${created.id}`);
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
  // Ensure trailing slash for consistency
  let normalized = url.trim();
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}

function isExcluded(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_NAME_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Web scraping
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
}

async function discoverProducts(page: Page): Promise<DiscoveredProduct[]> {
  log(`Crawling APIA lure listing: ${APIA_LURE_LIST_URL}`);

  await page.goto(APIA_LURE_LIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const productData = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href]');
    const products: Array<{ url: string; text: string }> = [];
    const seen = new Set<string>();

    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') || '';
      // Match: /product/lure/{slug}/ but NOT /product/lure/ itself
      if (!/\/product\/lure\/[^/?#]+/.test(href)) continue;
      if (href === '/product/lure/' || href.endsWith('/product/lure')) continue;

      const fullUrl = href.startsWith('http')
        ? href
        : window.location.origin + (href.startsWith('/') ? '' : '/') + href;

      // Normalize: ensure trailing slash
      const normalized = fullUrl.endsWith('/') ? fullUrl : fullUrl + '/';
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Get product name from link or h2 child
      const h2 = link.querySelector('h2');
      const text = h2?.textContent?.trim() || link.textContent?.trim()?.split('\n')[0]?.trim() || '';

      products.push({ url: normalized, text: text.substring(0, 100) });
    }

    return products;
  });

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
  log(`=== APIA URL Registration Script ===`);
  if (DRY_RUN) log('*** DRY RUN MODE — no writes ***');

  let browser: Browser | null = null;

  try {
    // 1. Discover products from APIA website
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
      if (isExcluded(p.name)) {
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

    // 5. Get/create APIA maker record
    const makerId = await fetchOrCreateApiaRecordId();

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
