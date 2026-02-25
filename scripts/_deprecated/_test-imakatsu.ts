// Quick test script for imakatsu scraper
// Usage: cd lure-database && npx tsx scripts/_test-imakatsu.ts

import { scrapeImakatsuPage } from './scrapers/imakatsu.js';

var TEST_URLS = [
  // Hard lure: GillRoid Jr. DIVE (big bait with 3D colors)
  'https://www.imakatsu.co.jp/hard-lure/gillroid-jr-dive/',
  // Soft lure: Javallon One Super Real (iconic worm)
  'https://www.imakatsu.co.jp/soft-lure/javallon-one-superreal/',
  // Other lure: Zinx Mini Super Blade TG (jig/blade)
  'https://www.imakatsu.co.jp/other-lure/zinx-mini-super-blade-tg/',
];

(async function () {
  for (var url of TEST_URLS) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));

    try {
      var result = await scrapeImakatsuPage(url);

      console.log(`\n--- Result ---`);
      console.log(`Name: ${result.name}`);
      console.log(`Name Kana: ${result.name_kana}`);
      console.log(`Slug: ${result.slug}`);
      console.log(`Type: ${result.type}`);
      console.log(`Target Fish: ${result.target_fish.join(', ')}`);
      console.log(`Length: ${result.length}mm`);
      console.log(`Weights: [${result.weights.join(', ')}]`);
      console.log(`Price: ${result.price}`);
      console.log(`Main Image: ${result.mainImage}`);
      console.log(`Colors: ${result.colors.length}`);
      console.log(`Description: ${result.description.substring(0, 100)}...`);

      // Validate colors
      var colorsWithImages = result.colors.filter(function (c) { return c.imageUrl !== ''; }).length;
      var colorsNoImages = result.colors.length - colorsWithImages;
      console.log(`  Colors with images: ${colorsWithImages}/${result.colors.length}`);
      if (colorsNoImages > 0) {
        console.log(`  ⚠️ Colors WITHOUT images: ${colorsNoImages}`);
      }

      // Show first 5 colors
      console.log(`  First 5 colors:`);
      result.colors.slice(0, 5).forEach(function (c) {
        console.log(`    - ${c.name} | img: ${c.imageUrl ? c.imageUrl.substring(0, 80) + '...' : 'NONE'}`);
      });

      // Validation checks
      var checks = [
        { label: 'Has name', pass: result.name.length > 0 },
        { label: 'Has slug', pass: result.slug.length > 0 },
        { label: 'Has main image', pass: result.mainImage.length > 0 },
        { label: 'Has colors', pass: result.colors.length > 0 },
        { label: 'Colors have images', pass: colorsWithImages > 0 },
        { label: 'Has type', pass: result.type.length > 0 },
      ];

      console.log(`\n--- Checks ---`);
      checks.forEach(function (c) {
        console.log(`  ${c.pass ? '✅' : '❌'} ${c.label}`);
      });

      var allPass = checks.every(function (c) { return c.pass; });
      console.log(allPass ? '\n✅ ALL CHECKS PASSED' : '\n❌ SOME CHECKS FAILED');

    } catch (e: any) {
      console.error(`❌ ERROR: ${e.message}`);
    }
  }
})();
