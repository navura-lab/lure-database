// Test script for YAMASHITA scraper
// Run: cd /path/to/lure-database && npx tsx scripts/_test-yamashita.ts

import { scrapeYamashitaPage } from './scrapers/yamashita.js';

var TEST_URLS = [
  'https://www.yamaria.co.jp/yamashita/product/detail/522',  // エギ王K (egi)
  'https://www.yamaria.co.jp/yamashita/product/detail/655',  // NAORY Range Hunter Basic (sutte)
  'https://www.yamaria.co.jp/yamashita/product/detail/712',  // Another product
];

(async () => {
  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('\n' + '='.repeat(80));
    console.log('Testing: ' + url);
    console.log('='.repeat(80));

    try {
      var result = await scrapeYamashitaPage(url);
      console.log('Name:        ' + result.name);
      console.log('Slug:        ' + result.slug);
      console.log('Type:        ' + result.type);
      console.log('Target Fish: ' + result.target_fish.join(', '));
      console.log('Length:      ' + result.length);
      console.log('Weights:     ' + result.weights.join(', '));
      console.log('Price:       ' + result.price);
      console.log('Main Image:  ' + (result.mainImage ? result.mainImage.substring(0, 80) + '...' : 'NONE'));
      console.log('Description: ' + (result.description ? result.description.substring(0, 100) + '...' : 'NONE'));
      console.log('Colors (' + result.colors.length + '):');
      for (var c = 0; c < Math.min(result.colors.length, 5); c++) {
        var color = result.colors[c];
        console.log('  [' + c + '] ' + color.name + ' → ' + (color.imageUrl ? color.imageUrl.substring(0, 70) + '...' : 'NO IMAGE'));
      }
      if (result.colors.length > 5) {
        console.log('  ... and ' + (result.colors.length - 5) + ' more');
      }

      // Validation
      var issues: string[] = [];
      if (!result.name || result.name === 'Unknown') issues.push('⚠️ No name');
      if (!result.mainImage) issues.push('⚠️ No main image');
      if (result.colors.length === 0) issues.push('⚠️ No colors');
      if (result.weights.length === 0) issues.push('⚠️ No weights');
      var emptyImgColors = result.colors.filter(function(c) { return !c.imageUrl; }).length;
      if (emptyImgColors > 0) issues.push('⚠️ ' + emptyImgColors + '/' + result.colors.length + ' colors without images');

      if (issues.length > 0) {
        console.log('\nISSUES:');
        for (var iss of issues) console.log('  ' + iss);
      } else {
        console.log('\n✅ All checks passed!');
      }
    } catch (err: any) {
      console.error('❌ ERROR: ' + (err.message || err));
    }
  }
  console.log('\n' + '='.repeat(80));
  console.log('Done.');
  process.exit(0);
})();
