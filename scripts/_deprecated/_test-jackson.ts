// scripts/_test-jackson.ts
// Quick test for the Jackson scraper — run against 4 diverse product pages.
// Usage: cd lure-database && npx tsx scripts/_test-jackson.ts

import { scrapeJacksonPage } from './scrapers/jackson.js';

var TEST_URLS = [
  // Salt - Minnow (Athlete series, should have spec table + colors)
  'https://jackson.jp/products/athlete-105-svg-fvg',
  // Salt - Worm (PY Shad, small product)
  'https://jackson.jp/products/py-shad',
  // Salt - Vibe (chinukoro series)
  'https://jackson.jp/products/chinukoro-vibe',
  // Trout - Spoon/minnow (Meteora)
  'https://jackson.jp/products/meteora-45-52',
];

async function main() {
  console.log('=== Jackson Scraper Test ===\n');
  var allPassed = true;

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log(`--- Test ${i + 1}/${TEST_URLS.length}: ${url} ---`);

    try {
      var result = await scrapeJacksonPage(url);
      console.log(`  Name:        ${result.name}`);
      console.log(`  Slug:        ${result.slug}`);
      console.log(`  Type:        ${result.type}`);
      console.log(`  Target fish: ${result.target_fish.join(', ')}`);
      console.log(`  Price:       ¥${result.price}`);
      console.log(`  Length:      ${result.length}mm`);
      console.log(`  Weights:     ${result.weights.join(', ')}g`);
      console.log(`  Colors:      ${result.colors.length}`);
      console.log(`  MainImage:   ${result.mainImage ? 'YES' : 'NO'} ${result.mainImage.substring(0, 80)}`);
      console.log(`  Description: ${result.description.substring(0, 80)}...`);

      // List all colors with image status
      var colorsWithImg = 0;
      for (var ci = 0; ci < result.colors.length; ci++) {
        var c = result.colors[ci];
        if (c.imageUrl) colorsWithImg++;
        if (ci < 3 || !c.imageUrl) {
          console.log(`    [${ci + 1}] ${c.name} → ${c.imageUrl ? 'IMG OK' : '⚠️ NO IMG'}`);
        }
      }
      if (result.colors.length > 3) {
        console.log(`    ... and ${result.colors.length - 3} more`);
      }
      console.log(`  Image coverage: ${colorsWithImg}/${result.colors.length}`);

      // Validation
      var issues: string[] = [];
      if (!result.name || result.name === 'Unknown') issues.push('name missing');
      if (!result.mainImage) issues.push('mainImage missing');
      if (result.colors.length === 0) issues.push('0 colors');
      if (colorsWithImg === 0 && result.colors.length > 0) issues.push('no color images');
      if (result.price === 0) issues.push('price=0');
      if (result.weights.length === 0) issues.push('no weights');
      if (!result.length) issues.push('no length');

      if (issues.length > 0) {
        console.log(`  ⚠️  Issues: ${issues.join(', ')}`);
        allPassed = false;
      } else {
        console.log(`  ✅ All checks passed`);
      }
    } catch (err) {
      console.error(`  ❌ ERROR: ${err}`);
      allPassed = false;
    }
    console.log('');
  }

  console.log(allPassed ? '✅ ALL TESTS PASSED' : '⚠️ SOME TESTS HAVE ISSUES');
  process.exit(allPassed ? 0 : 1);
}

main();
