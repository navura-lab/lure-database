// scripts/_test-thirtyfour.ts
// Quick test for 34 (THIRTY FOUR) scraper

import { scrapeThirtyfourPage } from './scrapers/thirtyfour.js';

var TEST_URLS = [
  // MEDUSA 2.8in — ワーム, 14 colors
  'https://34net.jp/products/worm/medusa/',
  // Beady 3.0in — ワーム, 8 colors, new product
  'https://34net.jp/products/worm/beady/',
  // Octpus — ワーム
  'https://34net.jp/products/worm/octpus/',
];

async function main() {
  var passed = 0;
  var failed = 0;

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('\n========================================');
    console.log('Test ' + (i + 1) + '/' + TEST_URLS.length + ': ' + url);
    console.log('========================================');

    try {
      var result = await scrapeThirtyfourPage(url);
      var errors: string[] = [];

      if (!result.name) errors.push('name is empty');
      if (!result.slug) errors.push('slug is empty');
      if (result.manufacturer_slug !== 'thirtyfour') errors.push('manufacturer_slug != thirtyfour');
      if (result.colors.length === 0) errors.push('no colors');
      if (!result.mainImage) errors.push('no mainImage');
      if (result.price === 0) errors.push('price is 0');

      console.log('  Name: ' + result.name);
      console.log('  Name Kana: ' + result.name_kana);
      console.log('  Slug: ' + result.slug);
      console.log('  Type: ' + result.type);
      console.log('  Length: ' + result.length + 'mm');
      console.log('  Weights: ' + JSON.stringify(result.weights));
      console.log('  Price: ¥' + result.price);
      console.log('  Colors: ' + result.colors.length);
      if (result.colors.length > 0) {
        console.log('    First: ' + result.colors[0].name + ' → ' + (result.colors[0].imageUrl ? 'HAS_IMAGE' : 'NO_IMAGE'));
        console.log('    Last: ' + result.colors[result.colors.length - 1].name + ' → ' + (result.colors[result.colors.length - 1].imageUrl ? 'HAS_IMAGE' : 'NO_IMAGE'));
      }
      console.log('  MainImage: ' + (result.mainImage ? result.mainImage.substring(0, 80) + '...' : 'NONE'));

      if (errors.length > 0) {
        console.log('  ❌ FAIL: ' + errors.join(', '));
        failed++;
      } else {
        console.log('  ✅ PASS');
        passed++;
      }
    } catch (e: any) {
      console.log('  ❌ ERROR: ' + e.message);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log('Results: ' + passed + '/' + TEST_URLS.length + ' passed, ' + failed + ' failed');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

main();
