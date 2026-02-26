// scripts/_test-tict.ts
// Quick smoke-test for the TICT scraper.
// Usage: npx tsx scripts/_test-tict.ts

import { scrapeTictPage } from './scrapers/tict.js';

const TEST_URLS = [
  'https://tict-net.com/product/bros55.html',       // ハードルアー (BROS 55)
  'https://tict-net.com/product/briliant12.html',    // ワーム (Brilliant 1.2")
  'https://tict-net.com/product/gyopin17.html',       // ワーム (ギョピン 1.7")
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
      var result = await scrapeTictPage(url);

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
      if (result.manufacturer !== 'TICT') errors.push('manufacturer is not TICT');
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
