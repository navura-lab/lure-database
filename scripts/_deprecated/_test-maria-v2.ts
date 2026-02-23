// scripts/_test-maria-v2.ts
// Maria scraper v2 test — verify color images are extracted
// Run: cd /path/to/lure-database && npx tsx scripts/_test-maria-v2.ts

import { scrapeMariaPage } from './scrapers/maria.js';

var testUrls = [
  'https://www.yamaria.co.jp/maria/product/detail/231',  // Souther S60 — 8 colors, hover images
  'https://www.yamaria.co.jp/maria/product/detail/147',  // Rerise S130 — 11 colors, single images
  'https://www.yamaria.co.jp/maria/product/detail/1',    // Blues Code C60 — 6 colors, no spec table
  'https://www.yamaria.co.jp/maria/product/detail/136',  // Pop Queen F — Layout B
];

async function main() {
  var totalColors = 0;
  var colorsWithImage = 0;
  var colorsWithoutImage = 0;
  var allPassed = true;

  for (var i = 0; i < testUrls.length; i++) {
    var url = testUrls[i];
    console.log('\n========================================');
    console.log('TEST ' + (i + 1) + '/' + testUrls.length + ': ' + url);
    console.log('========================================');

    try {
      var result = await scrapeMariaPage(url);
      console.log('Name: ' + result.name);
      console.log('Colors: ' + result.colors.length);
      console.log('Main Image: ' + (result.mainImage ? 'YES' : 'MISSING'));

      for (var c = 0; c < result.colors.length; c++) {
        var color = result.colors[c];
        totalColors++;
        var hasImage = color.imageUrl && color.imageUrl.length > 0;
        if (hasImage) {
          colorsWithImage++;
        } else {
          colorsWithoutImage++;
        }
        console.log('  [' + (hasImage ? 'OK' : 'NG') + '] ' + color.name + ' → ' + (color.imageUrl || '(empty)'));
      }

      // Check: at least 1 color
      if (result.colors.length === 0) {
        console.log('❌ FAIL: No colors found');
        allPassed = false;
      }

      // Check: all colors have imageUrl
      var missingImages = result.colors.filter(function(c) { return !c.imageUrl; });
      if (missingImages.length > 0) {
        console.log('⚠️ WARNING: ' + missingImages.length + ' color(s) without imageUrl');
        allPassed = false;
      } else {
        console.log('✅ PASS: All colors have imageUrl');
      }
    } catch (err) {
      console.log('❌ ERROR: ' + (err instanceof Error ? err.message : String(err)));
      allPassed = false;
    }
  }

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log('Total colors: ' + totalColors);
  console.log('With image:   ' + colorsWithImage + ' (' + (totalColors > 0 ? Math.round(colorsWithImage / totalColors * 100) : 0) + '%)');
  console.log('Without image: ' + colorsWithoutImage);
  console.log('Result: ' + (allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'));

  process.exit(allPassed ? 0 : 1);
}

main();
