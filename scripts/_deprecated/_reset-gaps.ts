// Reset all "登録完了 but 0 Supabase rows" records for given slugs back to 未処理
import { createClient } from '@supabase/supabase-js';

var supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
var AIRTABLE_PAT = process.env.AIRTABLE_PAT as string;
var AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appy0PFXPaBfXnNDV';
var AIRTABLE_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID || 'tbl6ZIZkIjcj4uF3s';
var AIRTABLE_MAKER_TABLE = process.env.AIRTABLE_MAKER_TABLE_ID || 'tbluGJQ0tGtcaStYU';

var TARGETS = (process.argv[2] || '').split(',').filter(Boolean);
if (TARGETS.length === 0) { console.error('Usage: npx tsx scripts/_reset-gaps.ts slug1,slug2,...'); process.exit(1); }

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
    if (offset) await new Promise(function(r) { setTimeout(r, 200); });
  } while (offset);
  return all;
}

async function patchRecords(ids: string[], fields: Record<string, any>): Promise<void> {
  for (var i = 0; i < ids.length; i += 10) {
    var batch = ids.slice(i, i + 10);
    var body = { records: batch.map(function(id) { return { id: id, fields: fields }; }) };
    var res = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + AIRTABLE_TABLE, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json() as any;
    if (data.error) console.error('Airtable PATCH error:', data.error);
    if (i + 10 < ids.length) await new Promise(function(r) { setTimeout(r, 250); });
  }
}

async function main() {
  // Build maker maps
  var makers = await fetchAllRecords(AIRTABLE_MAKER_TABLE);
  var makerSlugById: Record<string, string> = {};
  makers.forEach(function(m: any) { makerSlugById[m.id] = m.fields['Slug'] || ''; });

  // Get all Supabase source_urls
  var allRows: any[] = [];
  var from = 0;
  while (from < 100000) {
    var batch = await supabase.from('lures').select('source_url, manufacturer_slug').range(from, from + 999);
    if (batch.data === null || batch.data.length === 0) break;
    allRows = allRows.concat(batch.data);
    from += 1000;
  }
  var supaUrls: Record<string, Set<string>> = {};
  allRows.forEach(function(r: any) {
    if (!supaUrls[r.manufacturer_slug]) supaUrls[r.manufacturer_slug] = new Set();
    supaUrls[r.manufacturer_slug].add(r.source_url);
  });

  // Get all Airtable records (one fetch for all)
  var records = await fetchAllRecords(AIRTABLE_TABLE);

  for (var ti = 0; ti < TARGETS.length; ti++) {
    var slug = TARGETS[ti];
    console.log('\n=== ' + slug.toUpperCase() + ' ===');

    var makerRecords = records.filter(function(r: any) {
      var ids = r.fields['メーカー'] || [];
      return ids.length > 0 && makerSlugById[ids[0]] === slug;
    });

    var urls = supaUrls[slug] || new Set();
    var toReset: string[] = [];
    var resetUrls: string[] = [];

    makerRecords.forEach(function(r: any) {
      var url = r.fields['URL'] || '';
      var status = r.fields['ステータス'] || '';
      if (status === '登録完了' && url && !urls.has(url)) {
        toReset.push(r.id);
        resetUrls.push(url);
      }
    });

    console.log('Found ' + toReset.length + ' records to reset');
    if (toReset.length > 0) {
      resetUrls.forEach(function(u) { console.log('  ' + u); });
      await patchRecords(toReset, { 'ステータス': '未処理', '備考': '' });
      console.log('Reset ' + toReset.length + ' records to 未処理');
    }
  }
}
main();
