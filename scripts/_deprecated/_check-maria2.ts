import { createClient } from '@supabase/supabase-js';
var c = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  // Check detail/134 rows specifically
  var r = await c.from('lures').select('name, color_name, weight, images, source_url')
    .eq('manufacturer_slug', 'maria')
    .eq('source_url', 'https://www.yamaria.co.jp/maria/product/detail/134');

  console.log('detail/134 rows: ' + (r.data ? r.data.length : 0));
  if (r.data) {
    for (var i = 0; i < r.data.length; i++) {
      var row = r.data[i];
      var hasImg = row.images && row.images.length > 0 && row.images[0];
      console.log('  ' + row.color_name + ' | ' + row.weight + 'g | img=' + (hasImg ? 'YES' : 'NO'));
    }
  }

  // Count Maria product count
  var all = await c.from('lures').select('source_url', { count: 'exact' }).eq('manufacturer_slug', 'maria');
  var urls = new Set();
  if (all.data) all.data.forEach(function(d: any) { urls.add(d.source_url); });
  console.log('\nMaria total rows: ' + all.count);
  console.log('Unique products: ' + urls.size);

  // Check pipeline image stat - how many rows have images by product
  var allRows: any[] = [];
  var from = 0;
  while (from < 5000) {
    var batch = await c.from('lures').select('source_url, images').eq('manufacturer_slug', 'maria').range(from, from + 999);
    if (batch.data === null || batch.data.length === 0) break;
    allRows = allRows.concat(batch.data);
    from += 1000;
  }

  // Group by source_url
  var byUrl: Record<string, { total: number; withImg: number }> = {};
  allRows.forEach(function(r: any) {
    var url = r.source_url;
    if (byUrl[url] === undefined) byUrl[url] = { total: 0, withImg: 0 };
    byUrl[url].total++;
    if (r.images && r.images.length > 0 && r.images[0]) byUrl[url].withImg++;
  });

  // Show products with less than 100% image coverage
  console.log('\nProducts with missing images:');
  var found = false;
  Object.keys(byUrl).forEach(function(url) {
    var stat = byUrl[url];
    if (stat.withImg < stat.total) {
      found = true;
      console.log('  ' + url + ' | ' + stat.withImg + '/' + stat.total + ' rows with images');
    }
  });
  if (!found) console.log('  (none — all products have 100% coverage)');
}
main();
