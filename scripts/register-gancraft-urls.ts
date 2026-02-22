#!/usr/bin/env npx tsx
// scripts/register-gancraft-urls.ts
// One-shot script to register all GANCRAFT lure product URLs into Airtable.
//
// 1. Crawls bass.html, saltwater.html, ayu.html category pages
// 2. Extracts all /lures/{slug}.html links
// 3. Creates a GANCRAFT maker record in Airtable (if not exists)
// 4. Creates lure URL records in Airtable with status "未処理"
//
// Usage:
//   export $(cat .env | grep -v '^#' | xargs)
//   npx tsx scripts/register-gancraft-urls.ts [--dry-run]

import 'dotenv/config';
import {
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID,
  AIRTABLE_MAKER_TABLE_ID,
  AIRTABLE_API_BASE,
} from './config.js';

const DRY_RUN = process.argv.includes('--dry-run');
const GANCRAFT_BASE = 'https://gancraft.com';
const CATEGORY_PAGES = ['bass.html', 'saltwater.html', 'ayu.html'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[gancraft-urls] ${msg}`);
}

async function fetchEucJp(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const decoder = new TextDecoder('euc-jp');
  return decoder.decode(buf);
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
  // Search existing makers for GANCRAFT
  const data = await airtableFetch(
    `${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=SEARCH("GANCRAFT",{メーカー名})`,
  );
  if (data.records && data.records.length > 0) {
    log(`Found existing GANCRAFT maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  if (DRY_RUN) {
    log('[DRY-RUN] Would create GANCRAFT maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  // Create new maker record
  const created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
    method: 'POST',
    body: JSON.stringify({
      records: [
        {
          fields: {
            'メーカー名': 'GANCRAFT',
            'URL': 'https://gancraft.com',
            'Slug': 'gancraft',
          },
        },
      ],
    }),
  });
  const makerId = created.records[0].id;
  log(`Created GANCRAFT maker record: ${makerId}`);
  return makerId;
}

async function getExistingUrls(): Promise<Set<string>> {
  const urls = new Set<string>();
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      filterByFormula: 'SEARCH("gancraft.com",{URL})',
      'fields[]': 'URL',
      pageSize: '100',
    });
    if (offset) params.set('offset', offset);

    const data = await airtableFetch(`${AIRTABLE_LURE_URL_TABLE_ID}?${params}`);
    for (const rec of data.records || []) {
      if (rec.fields?.URL) urls.add(rec.fields.URL);
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');

  // 1. Crawl category pages
  const allLinks = new Map<string, string>(); // url -> name (deduped)

  for (const catPage of CATEGORY_PAGES) {
    const html = await fetchEucJp(`${GANCRAFT_BASE}/${catPage}`);
    // Extract lure links: href="lures/xxx.html" or href="lures/xxx/"
    const linkRegex = /href="(lures\/[^"]+)"/g;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let path = match[1].replace(/\/$/, '');
      // Normalize: ensure .html suffix
      if (!path.endsWith('.html')) path += '.html';
      const fullUrl = `${GANCRAFT_BASE}/${path}`;

      // Extract slug for name
      const slug = path.replace('lures/', '').replace('.html', '');
      if (!allLinks.has(fullUrl)) {
        allLinks.set(fullUrl, slug);
      }
    }
    log(`${catPage}: found ${allLinks.size} unique links so far`);
  }

  log(`Total unique lure URLs: ${allLinks.size}`);

  // 2. Check existing Airtable records
  const existingUrls = await getExistingUrls();
  log(`Existing GANCRAFT URLs in Airtable: ${existingUrls.size}`);

  // 3. Filter new URLs
  const newRecords: { name: string; url: string }[] = [];
  for (const [url, slug] of allLinks) {
    if (!existingUrls.has(url)) {
      newRecords.push({ name: slug, url });
    }
  }
  log(`New URLs to register: ${newRecords.length}`);

  if (newRecords.length === 0) {
    log('No new URLs to register. Done.');
    return;
  }

  // 4. Ensure maker record exists
  const makerId = await findOrCreateMaker();

  // 5. Create lure URL records
  await createLureRecords(newRecords, makerId);

  log(`Done! Registered ${newRecords.length} GANCRAFT lure URLs.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
