#!/usr/bin/env npx tsx
// scripts/register-luckycraft-urls.ts
// One-shot script to register all LUCKY CRAFT lure product URLs into Airtable.
//
// 1. Crawls category.html to extract all /product/{cat}/{slug}.html links
// 2. Creates a LUCKY CRAFT maker record in Airtable (if not exists)
// 3. Creates lure URL records in Airtable with status "未処理"
//
// Usage:
//   export $(cat .env | grep -v '^#' | xargs)
//   npx tsx scripts/register-luckycraft-urls.ts [--dry-run]

import 'dotenv/config';
import {
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID,
  AIRTABLE_MAKER_TABLE_ID,
  AIRTABLE_API_BASE,
} from './config.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LUCKYCRAFT_BASE = 'https://www.luckycraft.co.jp';
const CATEGORY_PAGE_URL = `${LUCKYCRAFT_BASE}/category.html`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[luckycraft-urls] ${msg}`);
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch(path: string, options: RequestInit = {}) {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function findOrCreateMaker(): Promise<string> {
  // Search existing makers for LUCKY CRAFT
  const data = await airtableFetch(
    `${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=SEARCH("LUCKY CRAFT",{メーカー名})`,
  );
  if (data.records && data.records.length > 0) {
    log(`Found existing LUCKY CRAFT maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  if (DRY_RUN) {
    log('[DRY-RUN] Would create LUCKY CRAFT maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  // Create new maker record
  const created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
    method: 'POST',
    body: JSON.stringify({
      records: [
        {
          fields: {
            'メーカー名': 'LUCKY CRAFT',
            'URL': 'https://www.luckycraft.co.jp',
            'Slug': 'luckycraft',
          },
        },
      ],
    }),
  });
  const makerId = created.records[0].id;
  log(`Created LUCKY CRAFT maker record: ${makerId}`);
  return makerId;
}

async function getExistingUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      filterByFormula: 'SEARCH("luckycraft.co.jp",{URL})',
      'fields[]': 'URL',
      pageSize: '100',
    });
    if (offset) params.set('offset', offset);

    const data = await airtableFetch(`${AIRTABLE_LURE_URL_TABLE_ID}?${params}`);
    for (const rec of data.records || []) {
      if (rec.fields?.URL) urls.add(normalizeUrl(rec.fields.URL));
    }
    offset = data.offset;
  } while (offset);

  return urls;
}

async function createLureRecords(
  records: { name: string; url: string }[],
  makerId: string,
) {
  // Airtable accepts max 10 records per batch
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const payload = {
      records: batch.map(r => ({
        fields: {
          'ルアー名': r.name,
          'URL': r.url,
          'メーカー': [makerId],
          'ステータス': '未処理',
        },
      })),
    };

    if (DRY_RUN) {
      log(`[DRY-RUN] Would create ${batch.length} records (batch ${Math.floor(i / 10) + 1})`);
      continue;
    }

    await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    log(`Created ${batch.length} records (batch ${Math.floor(i / 10) + 1})`);

    // Rate limit: Airtable allows 5 requests/sec
    if (i + 10 < records.length) {
      await new Promise(r => setTimeout(r, 250));
    }
  }
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  // Normalize http:// to https://, remove trailing slash
  return url
    .replace(/^http:\/\//, 'https://')
    .replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');

  // 1. Crawl category page
  log(`Fetching ${CATEGORY_PAGE_URL}...`);
  const res = await fetch(CATEGORY_PAGE_URL);
  const html = await res.text();

  // Extract all product links: href="...product/..."
  const linkRegex = /href="((?:https?:\/\/www\.luckycraft\.co\.jp)?\/product\/[^"]+\.html)"/gi;
  const allLinks = new Map<string, string>(); // normalized_url -> name

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    let rawUrl = match[1];
    // Make absolute
    if (rawUrl.startsWith('/')) {
      rawUrl = LUCKYCRAFT_BASE + rawUrl;
    }
    // Normalize
    rawUrl = normalizeUrl(rawUrl);

    // Extract name from link text (use slug as fallback)
    const pathParts = new URL(rawUrl).pathname.split('/').filter(Boolean);
    const fileName = (pathParts[pathParts.length - 1] || '').replace('.html', '');

    if (!allLinks.has(rawUrl)) {
      allLinks.set(rawUrl, fileName);
    }
  }

  log(`Total unique product URLs from category.html: ${allLinks.size}`);

  // 2. Check existing Airtable records
  const existingUrls = await getExistingUrls();
  log(`Existing LUCKY CRAFT URLs in Airtable: ${existingUrls.size}`);

  // 3. Filter new URLs
  const newRecords: { name: string; url: string }[] = [];
  for (const [url, name] of allLinks) {
    if (!existingUrls.has(url)) {
      newRecords.push({ name, url });
    }
  }
  log(`New URLs to register: ${newRecords.length}`);

  if (newRecords.length === 0) {
    log('No new URLs to register. Done.');
    return;
  }

  // Show sample URLs
  for (const rec of newRecords.slice(0, 5)) {
    log(`  → ${rec.name}: ${rec.url}`);
  }
  if (newRecords.length > 5) {
    log(`  ... and ${newRecords.length - 5} more`);
  }

  // 4. Ensure maker record exists
  const makerId = await findOrCreateMaker();

  // 5. Create lure URL records
  await createLureRecords(newRecords, makerId);

  log(`Done! Registered ${newRecords.length} LUCKY CRAFT lure URLs.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
