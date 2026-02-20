// scripts/register-deps-urls.ts
// One-time script to register all deps lure URLs in Airtable.
// After use, move to _deprecated/.
//
// Usage:
//   npx tsx scripts/register-deps-urls.ts --dry-run   # Preview only
//   npx tsx scripts/register-deps-urls.ts              # Live registration

import 'dotenv/config';
import { chromium } from 'playwright';
import {
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID,
  AIRTABLE_MAKER_TABLE_ID,
  AIRTABLE_API_BASE,
} from './config.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Categories to EXCLUDE (not lures)
const EXCLUDED_CATEGORIES = new Set([
  'SOFT BAIT',
  'SUPER BIG WORM SERIES',
  'JIGHEAD/HOOK',
]);

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

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

async function fetchOrCreateMaker(): Promise<string> {
  // Check if deps maker exists
  const filter = encodeURIComponent(`{Slug}='deps'`);
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: { Slug: string } }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    log(`Found existing maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  // Create new maker record
  log('Creating new deps maker record...');
  const createResult = await airtableFetch<{
    id: string;
    fields: Record<string, unknown>;
  }>(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': 'deps',
        'Slug': 'deps',
      },
    }),
  });
  log(`Created maker record: ${createResult.id}`);
  return createResult.id;
}

async function fetchExistingUrls(): Promise<Set<string>> {
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

  log(`Found ${urls.size} existing URLs`);
  return urls;
}

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

async function main() {
  log('========================================');
  log('deps URL Registration');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log('========================================');

  // 1. Get or create maker record
  const makerId = await fetchOrCreateMaker();

  // 2. Get existing URLs
  const existingUrls = await fetchExistingUrls();

  // 3. Scrape listing page
  log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://www.depsweb.co.jp/products/lure/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Get all products grouped by category
  const products = await page.evaluate((excludedCats: string[]) => {
    const results: { url: string; name: string; nameJa: string; category: string }[] = [];
    const excluded = new Set(excludedCats);

    document.querySelectorAll('section.com-section[id^="sec"]').forEach(section => {
      const h2 = section.querySelector('h2');
      // Category heading has format like "BIG BAIT\n              BIG BAIT" — take first non-empty line
      const categoryText = h2?.textContent?.trim() || '';
      const categoryLines = categoryText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const category = categoryLines[0] || '';

      if (excluded.has(category)) return;

      section.querySelectorAll('ul.mod-list_col3 > li').forEach(li => {
        const a = li.querySelector('a') as HTMLAnchorElement;
        const dt = li.querySelector('dt.ff-ns');
        const dd = li.querySelector('dd');
        if (a?.href) {
          results.push({
            url: a.href,
            name: dt?.textContent?.trim() || '',
            nameJa: dd?.textContent?.trim() || '',
            category,
          });
        }
      });
    });

    return results;
  }, [...EXCLUDED_CATEGORIES]);

  await browser.close();
  log(`Found ${products.length} lure products (excluded: SOFT BAIT, SUPER BIG WORM, JIGHEAD/HOOK)`);

  // 4. Filter out already-registered URLs
  const newProducts = products.filter(p => !existingUrls.has(normalizeUrl(p.url)));
  log(`New products to register: ${newProducts.length}`);

  // 5. Display all products
  const byCategory: Record<string, typeof newProducts> = {};
  for (const p of newProducts) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }

  for (const [cat, prods] of Object.entries(byCategory)) {
    log(`\n--- ${cat} (${prods.length}) ---`);
    for (const p of prods) {
      log(`  ${p.name} (${p.nameJa}) → ${p.url}`);
    }
  }

  if (DRY_RUN) {
    log('\n--- DRY RUN: No records created ---');
    log(`Total: ${products.length} products found, ${newProducts.length} new`);
    return;
  }

  // 6. Register in Airtable (batch 10 at a time)
  log(`\nRegistering ${newProducts.length} products in Airtable...`);
  let registered = 0;
  let errors = 0;

  for (let i = 0; i < newProducts.length; i += 10) {
    const batch = newProducts.slice(i, i + 10);
    const records = batch.map(p => ({
      fields: {
        'ルアー名': `${p.name} ${p.nameJa}`.trim(),
        'URL': p.url,
        'メーカー': [makerId],
        'ステータス': '未処理',
        '備考': `初回一括登録 (${new Date().toISOString().split('T')[0]})`,
      },
    }));

    try {
      await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, '', {
        method: 'POST',
        body: JSON.stringify({ records }),
      });
      registered += batch.length;
      log(`  Batch ${Math.floor(i / 10) + 1}: ${batch.length} records created (${registered}/${newProducts.length})`);
    } catch (e) {
      errors += batch.length;
      log(`  Batch ${Math.floor(i / 10) + 1}: ERROR — ${e instanceof Error ? e.message : String(e)}`);
    }

    // Rate limit: 5 requests/sec for Airtable
    if (i + 10 < newProducts.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  log('\n========================================');
  log('Registration Summary');
  log(`  Total on site: ${products.length}`);
  log(`  Already registered: ${products.length - newProducts.length}`);
  log(`  New registered: ${registered}`);
  log(`  Errors: ${errors}`);
  log('========================================');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
