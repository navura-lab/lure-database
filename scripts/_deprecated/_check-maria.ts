import { createClient } from '@supabase/supabase-js';
var c = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  // Check images status for Maria
  var allRows: any[] = [];
  var from = 0;
  while (from < 5000) {
    var batch = await c.from('lures').select('name, color_name, images, source_url').eq('manufacturer_slug', 'maria').range(from, from + 999);
    if (batch.data === null || batch.data.length === 0) break;
    allRows = allRows.concat(batch.data);
    from += 1000;
  }

  var totalRows = allRows.length;
  var withImages = allRows.filter(function(r: any) { return r.images && r.images.length > 0 && r.images[0]; }).length;
  var withoutImages = totalRows - withImages;

  console.log('Maria total rows: ' + totalRows);
  console.log('With images: ' + withImages);
  console.log('Without images (null): ' + withoutImages);
  console.log('Image coverage: ' + Math.round(withImages / totalRows * 100) + '%');

  // Show sample of rows without images
  var noImg = allRows.filter(function(r: any) { return !r.images || r.images.length === 0 || !r.images[0]; });
  var urls = new Set();
  noImg.forEach(function(r: any) { urls.add(r.source_url); });
  console.log('\nUnique source_urls without images: ' + urls.size);
  console.log('\nSample rows without images:');
  var shown = 0;
  var seenUrls = new Set();
  for (var i = 0; i < noImg.length && shown < 10; i++) {
    if (seenUrls.has(noImg[i].source_url)) continue;
    seenUrls.add(noImg[i].source_url);
    console.log('  ' + noImg[i].name + ' | ' + noImg[i].color_name + ' | ' + noImg[i].source_url);
    shown++;
  }

  // Also show a few WITH images for comparison
  console.log('\nSample rows WITH images:');
  var withImg = allRows.filter(function(r: any) { return r.images && r.images.length > 0 && r.images[0]; });
  for (var j = 0; j < Math.min(3, withImg.length); j++) {
    console.log('  ' + withImg[j].name + ' | ' + withImg[j].color_name + ' | images=' + JSON.stringify(withImg[j].images).substring(0, 100));
  }
}
main();
