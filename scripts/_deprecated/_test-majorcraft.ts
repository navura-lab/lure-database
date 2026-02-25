// scripts/_test-majorcraft.ts
// Quick test: scrape a few Major Craft product pages and verify output
import { scrapeMajorcraftPage } from './scrapers/majorcraft.js';

var TEST_URLS = [
  'https://www.majorcraft.co.jp/lure/jps/',           // ジグパラ ショート (metal jig, 32 colors, open price)
  'https://www.majorcraft.co.jp/lure/bbk-120/',       // ブレイクバック 120 (plug, 10 colors, priced)
  'https://www.majorcraft.co.jp/lure/egs/',           // エギゾー シュリンプ (squid jig, priced)
  'https://www.majorcraft.co.jp/lure/adw/',           // アジドー ワーム (worm/soft bait)
];

async function main() {
  var passed = 0;
  var failed = 0;

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('\n=== Test ' + (i + 1) + '/' + TEST_URLS.length + ': ' + url + ' ===');
    try {
      var result = await scrapeMajorcraftPage(url);
      console.log('  Name:        ' + result.name);
      console.log('  Slug:        ' + result.slug);
      console.log('  Type:        ' + result.type);
      console.log('  Target Fish: ' + result.target_fish.join(', '));
      console.log('  Price:       ' + result.price);
      console.log('  Length:      ' + result.length);
      console.log('  Weights:     ' + result.weights.join(', '));
      console.log('  Colors:      ' + result.colors.length);
      console.log('  MainImage:   ' + (result.mainImage ? 'YES' : 'NO'));

      // Verify minimum quality
      var issues: string[] = [];
      if (!result.name || result.name.length < 2) issues.push('name too short');
      if (result.colors.length === 0) issues.push('no colors');
      var emptyImgColors = result.colors.filter(function(c) { return !c.imageUrl; }).length;
      if (emptyImgColors > 0) issues.push(emptyImgColors + ' colors without images');
      if (!result.mainImage) issues.push('no main image');

      // Show first 3 colors
      for (var ci = 0; ci < Math.min(3, result.colors.length); ci++) {
        var c = result.colors[ci];
        console.log('    Color ' + (ci + 1) + ': ' + c.name + ' | img=' + (c.imageUrl ? c.imageUrl.substring(c.imageUrl.lastIndexOf('/') + 1) : 'NONE'));
      }

      if (issues.length > 0) {
        console.log('  ⚠️  ISSUES: ' + issues.join(', '));
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

  console.log('\n=== Summary: ' + passed + ' passed, ' + failed + ' failed ===');
  process.exit(failed > 0 ? 1 : 0);
}

main();
