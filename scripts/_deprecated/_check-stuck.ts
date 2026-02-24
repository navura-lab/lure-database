// Check stuck (処理中) and error records in Airtable
var AIRTABLE_PAT = process.env.AIRTABLE_PAT as string;
var AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appy0PFXPaBfXnNDV';
var AIRTABLE_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID || 'tbl6ZIZkIjcj4uF3s';
var AIRTABLE_MAKER_TABLE = process.env.AIRTABLE_MAKER_TABLE_ID || 'tbluGJQ0tGtcaStYU';

async function fetchAllRecords(tableId: string, filter?: string): Promise<any[]> {
  var all: any[] = [];
  var offset: string | undefined;
  do {
    var query = filter ? '?filterByFormula=' + encodeURIComponent(filter) : '?';
    if (offset) query += '&offset=' + encodeURIComponent(offset);
    var url = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + tableId + query;
    var res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT } });
    var data = await res.json() as any;
    if (data.records) all = all.concat(data.records);
    offset = data.offset;
    if (offset) await new Promise(r => setTimeout(r, 200));
  } while (offset);
  return all;
}

async function main() {
  var makers = await fetchAllRecords(AIRTABLE_MAKER_TABLE);
  var makerSlugById: Record<string, string> = {};
  makers.forEach(function(m: any) { makerSlugById[m.id] = m.fields['Slug'] || ''; });

  // Fetch stuck and error records
  var stuck = await fetchAllRecords(AIRTABLE_TABLE, "{ステータス}='処理中'");
  var errors = await fetchAllRecords(AIRTABLE_TABLE, "{ステータス}='エラー'");

  console.log('=== 処理中 (stuck) records: ' + stuck.length + ' ===\n');
  stuck.forEach(function(r: any) {
    var makerIds = r.fields['メーカー'] || [];
    var slug = makerIds.length > 0 ? makerSlugById[makerIds[0]] : '?';
    console.log('[' + slug + '] ' + (r.fields['ルアー名'] || '?') + ' | ' + (r.fields['URL'] || '') + ' | 備考: ' + (r.fields['備考'] || ''));
  });

  console.log('\n=== エラー records: ' + errors.length + ' ===\n');
  errors.forEach(function(r: any) {
    var makerIds = r.fields['メーカー'] || [];
    var slug = makerIds.length > 0 ? makerSlugById[makerIds[0]] : '?';
    console.log('[' + slug + '] ' + (r.fields['ルアー名'] || '?') + ' | ' + (r.fields['URL'] || '') + ' | 備考: ' + (r.fields['備考'] || '').substring(0, 100));
  });
}
main();
