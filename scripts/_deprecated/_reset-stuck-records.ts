// Reset stuck Airtable records from "処理中" or "エラー" back to "未処理"
import { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_LURE_URL_TABLE_ID, AIRTABLE_API_BASE } from './config.js';

async function airtableFetch<T>(path: string): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  // First, count records by status
  for (const status of ['未処理', '処理中', 'エラー', '完了']) {
    const filter = encodeURIComponent(`{ステータス}='${status}'`);
    const data = await airtableFetch<{ records: any[] }>(`?filterByFormula=${filter}&fields[]=ステータス&pageSize=1`);
    console.log(`${status}: ${data.records.length > 0 ? '1+ records' : '0 records'}`);
  }

  // Count ALL records with "処理中" status
  const stuckFilter = encodeURIComponent("{ステータス}='処理中'");
  let stuckRecords: any[] = [];
  let offset: string | undefined;

  do {
    let query = `?filterByFormula=${stuckFilter}`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;
    const data = await airtableFetch<{ records: any[]; offset?: string }>(query);
    stuckRecords.push(...data.records);
    offset = data.offset;
    if (offset) await new Promise(r => setTimeout(r, 200));
  } while (offset);

  console.log(`\nFound ${stuckRecords.length} stuck records with status "処理中"`);

  // Also check for エラー records
  const errorFilter = encodeURIComponent("{ステータス}='エラー'");
  let errorRecords: any[] = [];
  offset = undefined;

  do {
    let query = `?filterByFormula=${errorFilter}`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;
    const data = await airtableFetch<{ records: any[]; offset?: string }>(query);
    errorRecords.push(...data.records);
    offset = data.offset;
    if (offset) await new Promise(r => setTimeout(r, 200));
  } while (offset);

  console.log(`Found ${errorRecords.length} error records with status "エラー"`);

  const allToReset = [...stuckRecords, ...errorRecords];
  if (allToReset.length === 0) {
    console.log('Nothing to reset.');
    return;
  }

  // Reset in batches of 10
  console.log(`\nResetting ${allToReset.length} records to "未処理"...`);
  for (let i = 0; i < allToReset.length; i += 10) {
    const batch = allToReset.slice(i, i + 10);
    const records = batch.map((r: any) => ({
      id: r.id,
      fields: { 'ステータス': '未処理', '備考': '' }
    }));

    const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    });
    if (!res.ok) {
      console.error(`Failed batch at ${i}: ${res.status} ${await res.text()}`);
    } else {
      console.log(`  Reset batch ${Math.floor(i/10)+1}: ${batch.length} records`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
