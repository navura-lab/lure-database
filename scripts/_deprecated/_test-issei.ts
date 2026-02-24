// Test script for issei scraper
// Usage: npx tsx scripts/_test-issei.ts
// Tests 4 product pages (2 bass, 2 salt) and prints results

import { scrapeIsseiPage } from './scrapers/issei.js';

var TEST_URLS = [
  // Bass: AKチャター (chatter bait, 3 size tabs, 14 colors)
  'https://issei.tv/green_cray_fish/165.html',
  // Bass: another bass product from sitemap
  'https://issei.tv/green_cray_fish/178.html',
  // Salt: ヌケガケスッテ (sutte, 9 size tabs)
  'https://issei.tv/umitaro/227.html',
  // Salt: another salt product from sitemap
  'https://issei.tv/umitaro/519.html',
];

async function main() {
  console.log('=== issei scraper test ===\n');

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('--- Test ' + (i + 1) + '/' + TEST_URLS.length + ': ' + url + ' ---');

    try {
      var result = await scrapeIsseiPage(url);

      console.log('  name:         ' + result.name);
      console.log('  slug:         ' + result.slug);
      console.log('  type:         ' + result.type);
      console.log('  target_fish:  ' + result.target_fish.join(', '));
      console.log('  price:        ' + result.price);
      console.log('  weights:      [' + result.weights.join(', ') + ']');
      console.log('  length:       ' + result.length);
      console.log('  colors:       ' + result.colors.length);
      console.log('  mainImage:    ' + (result.mainImage ? 'YES (' + result.mainImage.substring(0, 60) + '...)' : 'NONE'));
      console.log('  description:  ' + (result.description ? result.description.substring(0, 60) + '...' : 'NONE'));

      // Check color images
      var withImg = 0;
      var withoutImg = 0;
      for (var c = 0; c < result.colors.length; c++) {
        if (result.colors[c].imageUrl) {
          withImg++;
        } else {
          withoutImg++;
        }
      }
      console.log('  color images: ' + withImg + ' with / ' + withoutImg + ' without');

      // Show first 3 colors
      for (var j = 0; j < Math.min(3, result.colors.length); j++) {
        console.log('    [' + j + '] ' + result.colors[j].name + ' → ' + (result.colors[j].imageUrl ? result.colors[j].imageUrl.substring(0, 60) : 'NO_IMG'));
      }

      // Validation
      var issues: string[] = [];
      if (!result.name) issues.push('NO NAME');
      if (result.colors.length === 0) issues.push('NO COLORS');
      if (withoutImg > 0) issues.push(withoutImg + ' colors without image');
      if (!result.mainImage) issues.push('NO MAIN IMAGE');
      if (result.price === 0) issues.push('NO PRICE');

      if (issues.length > 0) {
        console.log('  ⚠️  ISSUES: ' + issues.join(', '));
      } else {
        console.log('  ✅ OK');
      }
    } catch (err: any) {
      console.log('  ❌ ERROR: ' + (err.message || err));
    }

    console.log('');
  }

  console.log('=== Test complete ===');
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
