// Reset yarie Airtable records to "未処理" so pipeline can re-scrape them
import 'dotenv/config';
import {
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID,
} from './config.js';

const AIRTABLE_API = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

async function airtableFetch<T>(tableId: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${AIRTABLE_API}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Non-lure products to exclude
const EXCLUDE_URLS = new Set([
  'https://www.etanba.co.jp/529.html', // スナップリング
  'https://www.etanba.co.jp/797.html', // ハンディーフォーセップ
  'https://www.etanba.co.jp/798.html', // スプリットリングプライヤー
]);

async function main() {
  // 1. Find all yarie records (filter by URL domain since Airtable field names are uncertain)
  const filter = encodeURIComponent("FIND('etanba.co.jp',{URL})>0");
  const data = await airtableFetch<{
    records: Array<{ id: string; fields: Record<string, any> }>;
  }>(AIRTABLE_LURE_URL_TABLE_ID, `?filterByFormula=${filter}`);

  console.log(`Found ${data.records.length} yarie records in Airtable`);

  // 2. Separate lure vs non-lure
  const lureRecords = data.records.filter(r => !EXCLUDE_URLS.has(r.fields['URL']));
  const excludedRecords = data.records.filter(r => EXCLUDE_URLS.has(r.fields['URL']));

  console.log(`Lure products: ${lureRecords.length}`);
  console.log(`Non-lure (to delete): ${excludedRecords.length}`);

  for (const r of data.records) {
    const isExcluded = EXCLUDE_URLS.has(r.fields['URL']);
    console.log(`  ${isExcluded ? '❌' : '✅'} ${r.fields['URL']} | status=${r.fields['ステータス']}`);
  }

  // 3. Reset lure records to 未処理
  for (const r of lureRecords) {
    await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, `/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { 'ステータス': '未処理' } }),
    });
    console.log(`  Reset: ${r.fields['URL']}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // 4. Delete non-lure records
  for (const r of excludedRecords) {
    await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, `/${r.id}`, {
      method: 'DELETE',
    });
    console.log(`  Deleted: ${r.fields['URL']}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('Done! Run pipeline with --limit 4 to re-scrape yarie lures.');
}

main().catch(console.error);
