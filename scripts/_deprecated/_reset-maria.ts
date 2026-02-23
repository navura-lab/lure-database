// scripts/_reset-maria.ts
// Reset Maria records in Airtable to "未処理" and delete Supabase rows
// Run: cd /path/to/lure-database && npx tsx scripts/_reset-maria.ts

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

var AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
var AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;

async function airtableFetch(endpoint: string, options?: RequestInit) {
  var url = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + AIRTABLE_TABLE_ID + endpoint;
  var res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + AIRTABLE_PAT,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    var body = await res.text();
    throw new Error('Airtable error ' + res.status + ': ' + body);
  }
  return res.json();
}

async function main() {
  // --- 1. Fetch all Maria records from Airtable ---
  console.log('=== Fetching Maria records from Airtable ===');
  var allRecords: Array<{ id: string; fields: any }> = [];
  var offset: string | undefined = undefined;

  do {
    var params = new URLSearchParams();
    params.set('filterByFormula', 'SEARCH("yamaria.co.jp", {URL})');
    params.set('fields[]', 'URL');
    if (offset) params.set('offset', offset);

    var data = await airtableFetch('?' + params.toString()) as any;
    allRecords = allRecords.concat(data.records);
    offset = data.offset;
  } while (offset);

  console.log('Found ' + allRecords.length + ' Maria records');

  // --- 2. Reset each to 未処理 (batch of 10) ---
  console.log('=== Resetting to 未処理 ===');
  for (var i = 0; i < allRecords.length; i += 10) {
    var batch = allRecords.slice(i, i + 10).map(function(r) {
      return { id: r.id, fields: { 'ステータス': '未処理' } };
    });
    await airtableFetch('', {
      method: 'PATCH',
      body: JSON.stringify({ records: batch }),
    });
    console.log('  Reset ' + (i + batch.length) + '/' + allRecords.length);
  }
  console.log('✅ All ' + allRecords.length + ' records reset to 未処理');

  // --- 3. Delete Supabase rows ---
  console.log('\n=== Deleting Supabase rows ===');
  var supabase = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!
  );

  // Count existing
  var countResult = await supabase
    .from('lure_colors')
    .select('id', { count: 'exact', head: true })
    .eq('manufacturer_slug', 'maria');
  console.log('Existing Maria rows: ' + (countResult.count || 0));

  // Delete
  var deleteResult = await supabase
    .from('lure_colors')
    .delete()
    .eq('manufacturer_slug', 'maria');

  if (deleteResult.error) {
    console.error('Delete error:', deleteResult.error);
  } else {
    console.log('✅ Deleted Maria rows');
  }

  // Verify
  var verifyResult = await supabase
    .from('lure_colors')
    .select('id', { count: 'exact', head: true })
    .eq('manufacturer_slug', 'maria');
  console.log('Maria rows remaining: ' + (verifyResult.count || 0));

  console.log('\n=== Done! Run: npx tsx scripts/pipeline.ts --maker maria --limit 0 ===');
}

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
