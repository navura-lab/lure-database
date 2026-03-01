// Reset Phase 3 "登録完了" records that had 0 rows inserted back to "未処理"
import { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_LURE_URL_TABLE_ID, AIRTABLE_MAKER_TABLE_ID, AIRTABLE_API_BASE } from './config.js';

async function airtableFetch<T>(tableId: string, path: string = '', options: RequestInit = {}): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  // First, get Phase 3 maker IDs
  console.log('Fetching maker records...');
  let makers: any[] = [];
  let offset: string | undefined;
  do {
    let query = '?pageSize=100';
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;
    const data = await airtableFetch<any>(AIRTABLE_MAKER_TABLE_ID, query);
    makers.push(...data.records);
    offset = data.offset;
    if (offset) await new Promise(r => setTimeout(r, 200));
  } while (offset);

  const phase3Slugs = new Set([
    'attic', 'damiki', 'dreemup', 'god-hands', 'grassroots', 'itocraft', 'ivy-line',
    'jazz', 'jungle-gym', 'mibro', 'obasslive', 'pickup', 'pozidrive-garage',
    'sea-falcon', 'shout', 'signal', 'skagit', 'souls', 'viva', 'yarie',
    'phat-lab', 'th-tackle', 'zero-dragon'
  ]);

  const phase3MakerIds = new Set<string>();
  const makerIdToSlug = new Map<string, string>();
  makers.forEach((m: any) => {
    const slug = m.fields['Slug'];
    if (slug && phase3Slugs.has(slug)) {
      phase3MakerIds.add(m.id);
      makerIdToSlug.set(m.id, slug);
    }
  });
  console.log(`Found ${phase3MakerIds.size} Phase 3 maker records`);

  // Find all "登録完了" records with "0行挿入" in notes
  console.log('Searching for 登録完了 records with 0行挿入...');
  const filter = encodeURIComponent("{ステータス}='登録完了'");
  let toReset: any[] = [];
  offset = undefined;

  do {
    let query = `?filterByFormula=${filter}&pageSize=100`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;
    const data = await airtableFetch<any>(AIRTABLE_LURE_URL_TABLE_ID, query);

    for (const r of data.records) {
      const note = r.fields['備考'] || '';
      const makerIds = r.fields['メーカー'] || [];
      const isPhase3 = makerIds.some((id: string) => phase3MakerIds.has(id));

      if (isPhase3 && note.includes('0行挿入')) {
        const slug = makerIds.map((id: string) => makerIdToSlug.get(id)).filter(Boolean).join(',');
        toReset.push({ id: r.id, slug, name: r.fields['ルアー名'], note });
      }
    }

    offset = data.offset;
    if (offset) {
      console.log(`  Scanned ${toReset.length} to reset so far...`);
      await new Promise(r => setTimeout(r, 200));
    }
  } while (offset);

  console.log(`\nFound ${toReset.length} Phase 3 records to reset`);

  // Also find Phase 3 "エラー" records that should be retried
  const errorFilter = encodeURIComponent("{ステータス}='エラー'");
  let errorToReset: any[] = [];
  offset = undefined;

  do {
    let query = `?filterByFormula=${errorFilter}&pageSize=100`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;
    const data = await airtableFetch<any>(AIRTABLE_LURE_URL_TABLE_ID, query);

    for (const r of data.records) {
      const makerIds = r.fields['メーカー'] || [];
      const isPhase3 = makerIds.some((id: string) => phase3MakerIds.has(id));
      if (isPhase3) {
        const slug = makerIds.map((id: string) => makerIdToSlug.get(id)).filter(Boolean).join(',');
        errorToReset.push({ id: r.id, slug, name: r.fields['ルアー名'], note: r.fields['備考'] || '' });
      }
    }

    offset = data.offset;
    if (offset) await new Promise(r => setTimeout(r, 200));
  } while (offset);

  console.log(`Found ${errorToReset.length} Phase 3 error records to reset`);

  // Show summary by maker
  const allToReset = [...toReset, ...errorToReset];
  const byMaker: Record<string, number> = {};
  allToReset.forEach(r => { byMaker[r.slug] = (byMaker[r.slug] || 0) + 1; });
  console.log('\nBy maker:');
  Object.entries(byMaker).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

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
