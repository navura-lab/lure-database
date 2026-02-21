// scripts/_test-pazdesign.ts
// Quick test for the Pazdesign scraper — run 3 products, print results.
// Move to _deprecated/ after confirming.
//
// Usage: npx tsx scripts/_test-pazdesign.ts

import { scrapePazdesignPage } from './scrapers/pazdesign.js';

const TEST_URLS = [
  'https://pazdesign.co.jp/products/reed/grandsoldier/',    // Big bait, seabass/aomono
  'https://pazdesign.co.jp/products/reed/rebird90S/',        // Minnow, trout
  'https://pazdesign.co.jp/products/reed/kaisey_lakesp18g/', // Metal jig, trout
];

async function main() {
  console.log('=== Pazdesign Scraper Test ===\n');

  for (const url of TEST_URLS) {
    try {
      console.log(`\n--- Testing: ${url} ---`);
      const result = await scrapePazdesignPage(url);

      console.log(`  Name:        ${result.name}`);
      console.log(`  Slug:        ${result.slug}`);
      console.log(`  Type:        ${result.type}`);
      console.log(`  Price:       ¥${result.price}`);
      console.log(`  Length:      ${result.length}mm`);
      console.log(`  Weights:     [${result.weights.join(', ')}]g`);
      console.log(`  Colors:      ${result.colors.length}`);
      if (result.colors.length > 0) {
        console.log(`    First:     ${result.colors[0].name} → ${result.colors[0].imageUrl}`);
        console.log(`    Last:      ${result.colors[result.colors.length - 1].name} → ${result.colors[result.colors.length - 1].imageUrl}`);
      }
      console.log(`  Target fish: [${result.target_fish.join(', ')}]`);
      console.log(`  Main image:  ${result.mainImage}`);
      console.log(`  Description: ${result.description.substring(0, 80)}...`);
      console.log(`  ✅ OK`);
    } catch (err) {
      console.error(`  ❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n=== Test Complete ===');
}

main();
