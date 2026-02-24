// Test script for Lucky Craft scraper fixes
// Tests pages that previously returned 0 colors
import { scrapeLuckyCraftPage } from './scrapers/luckycraft.js';

var TEST_URLS = [
  // Category A: Old template with missing header classes
  'https://www.luckycraft.co.jp/product/native/Watch.html',        // headerNative, 12 colors
  'https://www.luckycraft.co.jp/product/native/Raiou.html',        // headerNative, 14 colors
  'https://www.luckycraft.co.jp/product/namazu/KerollMax.html',     // headerPup, 6 colors
  'https://www.luckycraft.co.jp/product/namazu/Sammybug.html',      // headerYlw, 5 colors
  'https://www.luckycraft.co.jp/product/swlightgame/Ika/EgiTribe.html', // headerLight, 20 colors
  // Category B: New template with empty itemlist but data-label rows
  'https://www.luckycraft.co.jp/product/swlightgame/MLG/malas.html',   // new, 17 rows
  'https://www.luckycraft.co.jp/product/area/bevyvib.html',            // new, 10 rows
  // Category C: Old template with ImageComingSoon
  'https://www.luckycraft.co.jp/product/bass/WakeTail.html',          // old, 8 colors, all comingsoon
  // Category D: Working page (sanity check)
  'https://www.luckycraft.co.jp/product/bass/Sammy.html',            // old, should still work
  'https://www.luckycraft.co.jp/product/bass/Keroll.html',           // old, 36 colors
];

async function main() {
  console.log('=== Lucky Craft Scraper Fix Test ===\n');
  var allPassed = true;

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    var shortUrl = url.split('/product/')[1];
    console.log(`--- Test ${i + 1}/${TEST_URLS.length}: ${shortUrl} ---`);

    try {
      var result = await scrapeLuckyCraftPage(url);
      var imgCount = result.colors.filter(function (c) {
        return c.imageUrl;
      }).length;
      console.log(`  Name:     ${result.name}`);
      console.log(`  Slug:     ${result.slug}`);
      console.log(`  Type:     ${result.type}`);
      console.log(`  Fish:     ${result.target_fish.join(', ')}`);
      console.log(`  Length:   ${result.length}mm`);
      console.log(`  Weights:  ${result.weights.join(', ')}g`);
      console.log(`  Colors:   ${result.colors.length} (${imgCount} with images)`);
      console.log(`  MainImg:  ${result.mainImage ? 'YES' : 'NO'}`);

      if (result.colors.length > 0) {
        for (var ci = 0; ci < Math.min(3, result.colors.length); ci++) {
          var c = result.colors[ci];
          console.log(`    [${ci + 1}] ${c.name} → ${c.imageUrl ? 'IMG' : '⚠️ NO IMG'}`);
        }
        if (result.colors.length > 3) console.log(`    ... and ${result.colors.length - 3} more`);
      }

      // Validation
      var issues: string[] = [];
      if (result.colors.length === 0) issues.push('0 colors');
      if (!result.mainImage) issues.push('no mainImage');

      if (issues.length > 0) {
        console.log(`  ⚠️  Issues: ${issues.join(', ')}`);
        allPassed = false;
      } else {
        console.log(`  ✅ Colors found`);
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
