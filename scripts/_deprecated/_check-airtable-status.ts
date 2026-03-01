import { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_LURE_URL_TABLE_ID, AIRTABLE_API_BASE } from './config.js';

async function countByStatus(status: string) {
  const filter = encodeURIComponent(`{ステータス}='${status}'`);
  let count = 0;
  let offset: string | undefined;
  do {
    let query = `?filterByFormula=${filter}&fields[]=ステータス&pageSize=100`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;
    const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}${query}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
    const data = await res.json() as any;
    count += data.records.length;
    offset = data.offset;
    if (offset) await new Promise(r => setTimeout(r, 200));
  } while (offset);
  return count;
}

async function main() {
  console.log('=== Airtable Status Summary ===');
  for (const s of ['未処理', '処理中', 'エラー', '登録完了']) {
    const c = await countByStatus(s);
    console.log(`  ${s}: ${c}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
