// Check Airtable status for all makers with suspected missing data
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
  // Fetch all maker records
  var makers = await fetchAllRecords(AIRTABLE_MAKER_TABLE);
  var makerMap: Record<string, string> = {}; // id -> slug
  var makerNameMap: Record<string, string> = {}; // id -> name
  makers.forEach(function(m: any) {
    makerMap[m.id] = m.fields['Slug'] || '';
    makerNameMap[m.id] = m.fields['メーカー名'] || '';
  });

  // Fetch ALL lure URL records
  var records = await fetchAllRecords(AIRTABLE_TABLE);
  console.log('Total Airtable records: ' + records.length + '\n');

  // Group by maker slug
  var byMaker: Record<string, { total: number; statuses: Record<string, number> }> = {};
  records.forEach(function(r: any) {
    var makerIds = r.fields['メーカー'] || [];
    var slug = makerIds.length > 0 ? (makerMap[makerIds[0]] || 'unknown') : 'unknown';
    if (byMaker[slug] === undefined) byMaker[slug] = { total: 0, statuses: {} };
    byMaker[slug].total++;
    var status = r.fields['ステータス'] || '不明';
    if (byMaker[slug].statuses[status] === undefined) byMaker[slug].statuses[status] = 0;
    byMaker[slug].statuses[status]++;
  });

  // Print summary
  console.log('メーカー | 合計 | 登録完了 | 未処理 | 処理中 | エラー');
  console.log('---------|------|---------|--------|--------|-------');
  var slugs = Object.keys(byMaker).sort();
  for (var i = 0; i < slugs.length; i++) {
    var s = byMaker[slugs[i]];
    var done = s.statuses['登録完了'] || 0;
    var pending = s.statuses['未処理'] || 0;
    var processing = s.statuses['処理中'] || 0;
    var error = s.statuses['エラー'] || 0;
    var flag = '';
    if (pending > 0 || processing > 0 || error > 0) flag = ' ⚠️';
    console.log(slugs[i] + ' | ' + s.total + ' | ' + done + ' | ' + pending + ' | ' + processing + ' | ' + error + flag);
  }
}
main();
