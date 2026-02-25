// Test script for BOTTOMUP scraper
import { scrapeBottomupPage } from './scrapers/bottomup.js';

var TEST_URLS = [
  // Hard lure - Beeble (spinner bait, multiple weights)
  'https://bottomup.info/products/beeble/',
  // Soft lure - Volup Swimmer 3.3 (shadtail worm)
  'https://bottomup.info/products/volupswimmer33/',
  // Hard lure - Flanjer (slow floating plug)
  'https://bottomup.info/products/flanjer/',
];

async function main() {
  for (var url of TEST_URLS) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));

    try {
      var result = await scrapeBottomupPage(url);

      console.log('\n--- RESULT ---');
      console.log(`Name: ${result.name}`);
      console.log(`Kana: ${result.name_kana}`);
      console.log(`Slug: ${result.slug}`);
      console.log(`Type: ${result.type}`);
      console.log(`Price: ${result.price}`);
      console.log(`Length: ${result.length}mm`);
      console.log(`Weights: ${JSON.stringify(result.weights)}`);
      console.log(`Colors: ${result.colors.length}`);
      console.log(`Main image: ${result.mainImage ? 'YES' : 'NO'}`);

      // Check colors
      var withImg = result.colors.filter(function (c) { return c.imageUrl && c.imageUrl.length > 0; }).length;
      console.log(`Colors with image: ${withImg}/${result.colors.length}`);

      // Print first 3 colors
      for (var i = 0; i < Math.min(3, result.colors.length); i++) {
        var c = result.colors[i];
        console.log(`  Color ${i + 1}: ${c.name} | img=${c.imageUrl ? 'YES' : 'NO'}`);
      }

      // Validation
      var errors: string[] = [];
      if (!result.name) errors.push('Missing name');
      if (!result.name_kana) errors.push('Missing kana');
      if (!result.slug) errors.push('Missing slug');
      if (!result.type) errors.push('Missing type');
      if (result.colors.length === 0) errors.push('No colors found');
      if (!result.mainImage) errors.push('Missing main image');

      if (errors.length > 0) {
        console.log(`\n❌ ERRORS: ${errors.join(', ')}`);
      } else {
        console.log(`\n✅ ALL CHECKS PASSED`);
      }
    } catch (err: any) {
      console.error(`\n❌ FAILED: ${err.message}`);
    }
  }
}

main();
