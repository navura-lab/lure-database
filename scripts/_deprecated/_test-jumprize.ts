// scripts/_test-jumprize.ts
// Quick test for Jumprize scraper

import { scrapeJumprizePage } from './scrapers/jumprize.js';

var TEST_URLS = [
  // Rowdy 130F — ミノー, 14 colors, spec table with price
  'https://www.jumprize.com/lure/series1/rowdy130f/',
  // ぶっ飛び君95S — シンキングペンシル, multiple galleries (size variants)
  'https://www.jumprize.com/lure/series2/buttobi-kun95s/',
  // モモパンチ30g 45g — メタルジグ, no color names (empty data-title)
  'https://www.jumprize.com/lure/series5/momopunch30g-45g/',
  // チャタビー68 — バイブレーション
  'https://www.jumprize.com/lure/series3/chata-bee68/',
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
      var result = await scrapeJumprizePage(url);
      var errors: string[] = [];

      if (!result.name) errors.push('name is empty');
      if (!result.slug) errors.push('slug is empty');
      if (result.manufacturer_slug !== 'jumprize') errors.push('manufacturer_slug != jumprize');
      if (!result.type || result.type === 'ルアー') errors.push('type is generic: ' + result.type);
      if (result.colors.length === 0) errors.push('no colors');
      if (!result.mainImage) errors.push('no mainImage');

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
