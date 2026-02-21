// scripts/register-pazdesign-urls.ts
// One-time script to register all Pazdesign reed product URLs in Airtable.
// Crawls the product listing page at /products/reed/ (single page, client-side pagination).
//
// After initial run, move this to scripts/_deprecated/.
//
// Usage:
//   npx tsx scripts/register-pazdesign-urls.ts              # normal run
//   npx tsx scripts/register-pazdesign-urls.ts --dry-run    # preview only, no writes

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PAZDESIGN_BASE_URL = 'https://pazdesign.co.jp';
const PAZDESIGN_LURE_LIST_URL = `${PAZDESIGN_BASE_URL}/products/reed/`;

// Products with these keywords in their slug are excluded (parts/hooks/accessories)
const EXCLUDED_SLUG_KEYWORDS = [
  'hook',
  '_hook',
  '_skirt',
  '_necktie',
  'perfectassist',
];

// Products with these keywords in their name are excluded
const EXCLUDED_NAME_KEYWORDS = [
  'フック',
  'HOOK',
  'スカート',
  'ネクタイ',
  'パーツ',
  'PARTS',
  'スペア',
  'SPARE',
  'アシストフック',
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
  console.log(`[${timestamp()}] [register-pazdesign] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [register-pazdesign] ERROR: ${message}`);
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

async function fetchOrCreatePazdesignRecordId(): Promise<string> {
  const filter = encodeURIComponent("{Slug}='pazdesign'");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing Pazdesign maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  log('Pazdesign maker record not found — creating...');
  if (DRY_RUN) {
    log('DRY RUN: Would create Pazdesign maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  const created = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'Pazdesign',
        'Slug': 'pazdesign',
      },
    }),
  });

  log(`Created Pazdesign maker record: ${created.id}`);
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

function isExcludedBySlug(slug: string): boolean {
  const lower = slug.toLowerCase();
  return EXCLUDED_SLUG_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
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
}

async function discoverProducts(page: Page): Promise<DiscoveredProduct[]> {
  log(`Crawling Pazdesign reed listing: ${PAZDESIGN_LURE_LIST_URL}`);

  await page.goto(PAZDESIGN_LURE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_LOAD_DELAY_MS);

  const productData = await page.evaluate((baseUrl: string) => {
    const links = document.querySelectorAll('a[href]');
    const products: Array<{ url: string; text: string }> = [];
    const seen = new Set<string>();

    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') || '';

      // Match: relative links starting with ./ or direct slugs (not http, not #, not /)
      // These are product links on the reed listing page
      let slug = '';
      if (href.startsWith('./')) {
        slug = href.substring(2).replace(/\/$/, '');
      } else if (href.startsWith('http')) {
        // Skip full URLs (they're navigation links)
        continue;
      } else if (href.startsWith('/') || href.startsWith('#') || href === '') {
        continue;
      } else {
        slug = href.replace(/\/$/, '');
      }

      // Skip if slug is empty or looks like a category/section link
      if (!slug || slug.includes('/') || slug.includes('.html')) continue;

      const fullUrl = `${baseUrl}/products/reed/${slug}/`;
      const normalized = fullUrl;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Get product name from link text
      const text = link.textContent?.trim()?.split('\n')[0]?.trim() || '';

      products.push({ url: normalized, text: text.substring(0, 100) });
    }

    return products;
  }, PAZDESIGN_BASE_URL);

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
  log(`=== Pazdesign URL Registration Script ===`);
  if (DRY_RUN) log('*** DRY RUN MODE — no writes ***');

  let browser: Browser | null = null;

  try {
    // 1. Discover products from Pazdesign website
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
      // Extract slug from URL for checking
      const slug = p.url.match(/\/products\/reed\/([^/]+)/)?.[1] || '';
      if (isExcludedBySlug(slug) || isExcludedByName(p.name)) {
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

    // 5. Get/create Pazdesign maker record
    const makerId = await fetchOrCreatePazdesignRecordId();

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
