// Find URLs in Airtable (登録完了) but with 0 rows in Supabase
import { createClient } from '@supabase/supabase-js';

var c = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
var AIRTABLE_PAT = process.env.AIRTABLE_PAT as string;
var AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appy0PFXPaBfXnNDV';
var AIRTABLE_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID || 'tbl6ZIZkIjcj4uF3s';
var AIRTABLE_MAKER_TABLE = process.env.AIRTABLE_MAKER_TABLE_ID || 'tbluGJQ0tGtcaStYU';

var TARGETS = ['zipbaits', 'duo', 'duel', 'coreman'];

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
  // Build maker ID -> slug map
  var makers = await fetchAllRecords(AIRTABLE_MAKER_TABLE);
  var makerSlugById: Record<string, string> = {};
  var makerIdBySlug: Record<string, string> = {};
  makers.forEach(function(m: any) {
    makerSlugById[m.id] = m.fields['Slug'] || '';
    makerIdBySlug[m.fields['Slug'] || ''] = m.id;
  });

  // Get all Supabase source_urls
  var allRows: any[] = [];
  var from = 0;
  while (from < 100000) {
    var batch = await c.from('lures').select('source_url, manufacturer_slug').range(from, from + 999);
    if (batch.data === null || batch.data.length === 0) break;
    allRows = allRows.concat(batch.data);
    from += 1000;
  }

  var supabaseUrlsByMaker: Record<string, Set<string>> = {};
  allRows.forEach(function(r: any) {
    var slug = r.manufacturer_slug;
    if (supabaseUrlsByMaker[slug] === undefined) supabaseUrlsByMaker[slug] = new Set();
    supabaseUrlsByMaker[slug].add(r.source_url);
  });

  // Check each target
  for (var ti = 0; ti < TARGETS.length; ti++) {
    var slug = TARGETS[ti];
    console.log('\n=== ' + slug.toUpperCase() + ' ===');

    // Get Airtable records for this maker
    var records = await fetchAllRecords(AIRTABLE_TABLE);
    var makerRecords = records.filter(function(r: any) {
      var ids = r.fields['メーカー'] || [];
      return ids.length > 0 && makerSlugById[ids[0]] === slug;
    });

    var supaUrls = supabaseUrlsByMaker[slug] || new Set();
    console.log('Airtable records: ' + makerRecords.length);
    console.log('Supabase unique URLs: ' + supaUrls.size);

    // Find missing (in Airtable 登録完了 but not in Supabase)
    var missing: any[] = [];
    var stuckProcessing: any[] = [];
    var errors: any[] = [];

    makerRecords.forEach(function(r: any) {
      var url = r.fields['URL'] || '';
      var status = r.fields['ステータス'] || '';
      if (status === '登録完了' && url && !supaUrls.has(url)) {
        missing.push(r);
      }
      if (status === '処理中') stuckProcessing.push(r);
      if (status === 'エラー') errors.push(r);
    });

    console.log('Missing (登録完了 but 0 rows): ' + missing.length);
    if (missing.length > 0 && missing.length <= 10) {
      missing.forEach(function(r: any) {
        console.log('  ' + (r.fields['ルアー名'] || '?') + ' | ' + (r.fields['URL'] || ''));
      });
    } else if (missing.length > 10) {
      console.log('  (showing first 10)');
      for (var mi = 0; mi < 10; mi++) {
        console.log('  ' + (missing[mi].fields['ルアー名'] || '?') + ' | ' + (missing[mi].fields['URL'] || ''));
      }
      console.log('  ... and ' + (missing.length - 10) + ' more');
    }

    if (stuckProcessing.length > 0) {
      console.log('Stuck in 処理中: ' + stuckProcessing.length);
      stuckProcessing.forEach(function(r: any) {
        console.log('  ' + (r.fields['ルアー名'] || '?') + ' | ' + (r.fields['URL'] || ''));
      });
    }
    if (errors.length > 0) {
      console.log('Errors: ' + errors.length);
      errors.forEach(function(r: any) {
        console.log('  ' + (r.fields['ルアー名'] || '?') + ' | ' + (r.fields['URL'] || '') + ' | ' + (r.fields['備考'] || ''));
      });
    }
  }
}
main();
