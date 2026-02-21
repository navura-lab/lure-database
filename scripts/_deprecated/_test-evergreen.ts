// scripts/_deprecated/_test-evergreen.ts
// Quick test for EVERGREEN INTERNATIONAL scraper
// Usage: npx tsx scripts/_deprecated/_test-evergreen.ts

import { scrapeEvergreenPage } from '../scrapers/evergreen.js';

const TEST_URLS = [
  // Bass crankbait (Mode series) — multiple weight/length variants expected
  'https://www.evergreen-fishing.com/goods_list/Wildhunch.html',
  // Bass lure (Mode series)
  'https://www.evergreen-fishing.com/goods_list/ClutchHitter.html',
  // Another bass lure (Mode series)
  'https://www.evergreen-fishing.com/goods_list/FlatForce.html',
];

async function main() {
  console.log('=== EVERGREEN scraper test ===\n');

  for (const url of TEST_URLS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(70));

    try {
      const result = await scrapeEvergreenPage(url);

      console.log(`\n  Name:         ${result.name}`);
      console.log(`  Name Kana:    ${result.name_kana}`);
      console.log(`  Slug:         ${result.slug}`);
      console.log(`  Manufacturer: ${result.manufacturer}`);
      console.log(`  Type:         ${result.type}`);
      console.log(`  Price:        ${result.price}円`);
      console.log(`  Weights:      [${result.weights.join(', ')}] g`);
      console.log(`  Length:        ${result.length} mm`);
      console.log(`  Colors:       ${result.colors.length} colors`);
      console.log(`  Main Image:   ${result.mainImage}`);
      console.log(`  Description:  ${result.description?.substring(0, 100)}...`);
      console.log(`  Source URL:   ${result.sourceUrl}`);

      if (result.colors.length > 0) {
        console.log(`\n  Sample colors (first 3):`);
        for (const c of result.colors.slice(0, 3)) {
          console.log(`    - ${c.name}: ${c.imageUrl}`);
        }
      }

      // Validation checks
      const issues: string[] = [];
      if (!result.name) issues.push('Missing name');
      if (!result.slug) issues.push('Missing slug');
      if (result.price === 0) issues.push('Price is 0');
      if (result.weights.length === 0) issues.push('No weights parsed');
      if (result.length === null) issues.push('No length parsed');
      if (result.colors.length === 0) issues.push('No colors found');
      if (!result.mainImage) issues.push('No main image');
      if (!result.description) issues.push('No description');

      if (issues.length > 0) {
        console.log(`\n  ⚠️  Issues: ${issues.join(', ')}`);
      } else {
        console.log(`\n  ✅ All fields populated`);
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Polite delay between requests
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n=== Test complete ===');
}

main().catch(console.error);
