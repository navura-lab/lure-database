// scripts/_test-maria.ts
// Quick smoke-test for the Maria scraper.
// Usage: npx tsx scripts/_test-maria.ts

import { scrapeMariaPage } from './scrapers/maria.js';

var TEST_URLS = [
  // サウザー S60 — new product, タイプあり (シンキング), 8 colors
  'https://www.yamaria.co.jp/maria/product/detail/231',
  // タイトスラローム 80 — タイプなし, 10 colors
  'https://www.yamaria.co.jp/maria/product/detail/137',
  // ボアー SS195 — タイプあり (スローシンキング), summary表なし, 8 colors
  'https://www.yamaria.co.jp/maria/product/detail/166',
];

async function main() {
  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('\n' + '='.repeat(70));
    console.log('TEST ' + (i + 1) + '/' + TEST_URLS.length + ': ' + url);
    console.log('='.repeat(70));
    try {
      var lure = await scrapeMariaPage(url);
      console.log('  name:        ' + lure.name);
      console.log('  slug:        ' + lure.slug);
      console.log('  type:        ' + lure.type);
      console.log('  target_fish: ' + JSON.stringify(lure.target_fish));
      console.log('  length:      ' + lure.length);
      console.log('  weights:     ' + JSON.stringify(lure.weights));
      console.log('  price:       ' + lure.price);
      console.log('  colors:      ' + lure.colors.length + ' colors');
      if (lure.colors.length > 0) {
        console.log('    first: ' + lure.colors[0].name);
        console.log('    last:  ' + lure.colors[lure.colors.length - 1].name);
      }
      console.log('  mainImage:   ' + (lure.mainImage ? lure.mainImage.substring(0, 80) + '...' : '(none)'));
      console.log('  desc:        ' + (lure.description ? lure.description.substring(0, 80) + '...' : '(none)'));
      console.log('  sourceUrl:   ' + lure.sourceUrl);
      console.log('  ✅ OK');
    } catch (err: any) {
      console.error('  ❌ ERROR: ' + (err.message || err));
    }
  }
  console.log('\n✅ All tests completed');
}

main().catch(console.error);
