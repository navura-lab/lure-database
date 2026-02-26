// scripts/_test-noike.ts
// Quick smoke-test for the NOIKE scraper.
// Usage: npx tsx scripts/_test-noike.ts

import { scrapeNoikePage } from './scrapers/noike.js';

const TEST_URLS = [
  'https://noike-m.com/wobble-shad-3/',      // ワーム (wobble shad 3")
  'https://noike-m.com/smokin-dad-2-5/',      // ワーム (Smokin' Dad 2.5")
  'https://noike-m.com/kaishin-blade/',       // ブレードベイト (KAISHIN Blade)
];

async function main() {
  var passed = 0;
  var failed = 0;

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('\n========================================');
    console.log('TEST ' + (i + 1) + '/' + TEST_URLS.length + ': ' + url);
    console.log('========================================');

    try {
      var result = await scrapeNoikePage(url);

      console.log('  name:         ' + result.name);
      console.log('  name_kana:    ' + result.name_kana);
      console.log('  slug:         ' + result.slug);
      console.log('  manufacturer: ' + result.manufacturer);
      console.log('  type:         ' + result.type);
      console.log('  price:        ¥' + result.price);
      console.log('  length:       ' + (result.length || '-') + 'mm');
      console.log('  weights:      ' + JSON.stringify(result.weights));
      console.log('  colors:       ' + result.colors.length);
      console.log('  mainImage:    ' + result.mainImage);
      console.log('  target_fish:  ' + JSON.stringify(result.target_fish));

      if (result.colors.length > 0) {
        console.log('  --- first 3 colors ---');
        for (var c = 0; c < Math.min(3, result.colors.length); c++) {
          console.log('    [' + c + '] ' + result.colors[c].name + ' -> ' + result.colors[c].imageUrl);
        }
      }

      // Basic assertions
      var errors: string[] = [];
      if (!result.name) errors.push('name is empty');
      if (!result.slug) errors.push('slug is empty');
      if (result.manufacturer !== 'NOIKE') errors.push('manufacturer is not NOIKE');
      if (result.colors.length === 0) errors.push('no colors found');

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
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + TEST_URLS.length);
  console.log('========================================');

  if (failed > 0) process.exit(1);
}

main();
