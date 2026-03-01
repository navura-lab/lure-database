import { AIRTABLE_PAT, AIRTABLE_BASE_ID, AIRTABLE_LURE_URL_TABLE_ID, AIRTABLE_MAKER_TABLE_ID, AIRTABLE_API_BASE } from './config.js';

// Phase 3 makers we want to check
const phase3Slugs = ['pickup', 'shout', 'sea-falcon', 'dreemup', 'pozidrive-garage', 'viva', 'yarie', 'souls', 'grassroots', 'attic', 'jungle-gym', 'obasslive', 'mibro'];

async function airtableFetch<T>(tableId: string, path: string = ''): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function main() {
  // First, get all maker records to build slug->id mapping
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

  const slugToId = new Map<string, string>();
  const idToSlug = new Map<string, string>();
  makers.forEach((m: any) => {
    const slug = m.fields['Slug'];
    if (slug) {
      slugToId.set(slug, m.id);
      idToSlug.set(m.id, slug);
    }
  });

  // Now find a sample URL for each Phase 3 maker
  console.log('\n=== Phase 3 Sample URLs ===');
  for (const slug of phase3Slugs) {
    const makerId = slugToId.get(slug);
    if (!makerId) {
      console.log(`${slug}: No maker record found`);
      continue;
    }

    // Find one record for this maker
    const filter = encodeURIComponent(`RECORD_ID()='${makerId}'`);
    // Actually need to search lure URL records by maker
    const lureFilter = encodeURIComponent(`{ステータス}='登録完了'`);
    let query = `?filterByFormula=${lureFilter}&pageSize=5`;
    const data = await airtableFetch<any>(AIRTABLE_LURE_URL_TABLE_ID, query);

    // Filter by maker in records
    const matching = data.records.filter((r: any) => {
      const makerIds = r.fields['メーカー'] || [];
      return makerIds.includes(makerId);
    });

    if (matching.length > 0) {
      const r = matching[0];
      console.log(`${slug}: ${r.fields['URL']} (${r.fields['ルアー名']})`);
    } else {
      console.log(`${slug}: No records found in first page`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
