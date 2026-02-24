// Fix Maria detail/134: delete 4 rows without images, reset Airtable, re-run pipeline
import { createClient } from '@supabase/supabase-js';

var SUPABASE_URL = process.env.SUPABASE_URL as string;
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
var AIRTABLE_PAT = process.env.AIRTABLE_PAT as string;
var AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appy0PFXPaBfXnNDV';
var AIRTABLE_TABLE = process.env.AIRTABLE_LURE_URL_TABLE_ID || 'tbl6ZIZkIjcj4uF3s';

var c = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // Step 1: Delete the 4 rows without images for detail/134
  console.log('Step 1: Deleting rows without images for detail/134...');

  var r = await c.from('lures')
    .select('id, color_name, weight, images')
    .eq('source_url', 'https://www.yamaria.co.jp/maria/product/detail/134')
    .is('images', null);

  if (r.data && r.data.length > 0) {
    console.log('Found ' + r.data.length + ' rows without images:');
    var ids: number[] = [];
    for (var i = 0; i < r.data.length; i++) {
      console.log('  ' + r.data[i].color_name + ' | ' + r.data[i].weight + 'g | id=' + r.data[i].id);
      ids.push(r.data[i].id);
    }

    // Delete them
    for (var j = 0; j < ids.length; j++) {
      var del = await c.from('lures').delete().eq('id', ids[j]);
      if (del.error) {
        console.error('  Delete error for id ' + ids[j] + ': ' + del.error.message);
      } else {
        console.log('  Deleted id=' + ids[j]);
      }
    }
  } else {
    console.log('No rows without images found (already clean?)');
  }

  // Step 2: Find Airtable record for detail/134 and reset to 未処理
  console.log('\nStep 2: Resetting Airtable record for detail/134...');

  var filter = encodeURIComponent("AND({URL}='https://www.yamaria.co.jp/maria/product/detail/134')");
  var atUrl = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + AIRTABLE_TABLE + '?filterByFormula=' + filter;
  var atRes = await fetch(atUrl, {
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_PAT },
  });
  var atData = await atRes.json() as any;

  if (atData.records && atData.records.length > 0) {
    var rec = atData.records[0];
    console.log('Found Airtable record: ' + rec.id + ' (' + (rec.fields['ルアー名'] || '') + ')');

    // Reset to 未処理
    var updateUrl = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + AIRTABLE_TABLE + '/' + rec.id;
    var updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + AIRTABLE_PAT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { 'ステータス': '未処理' } }),
    });
    if (updateRes.ok) {
      console.log('Reset to 未処理');
    } else {
      console.error('Failed to reset: ' + updateRes.status);
    }
  } else {
    console.log('No Airtable record found for detail/134');
  }

  // Verify
  console.log('\nStep 3: Verify...');
  var verify = await c.from('lures')
    .select('id', { count: 'exact', head: true })
    .eq('source_url', 'https://www.yamaria.co.jp/maria/product/detail/134')
    .is('images', null);
  console.log('Rows without images remaining: ' + verify.count);
}

main();
