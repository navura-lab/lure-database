// scripts/_test-tiemco.ts
// Quick test for TIEMCO scraper — run 4 representative product pages
// Usage: npx tsx scripts/_test-tiemco.ts
// After verification, move to _deprecated/

import { scrapeTiemcoPage } from './scrapers/tiemco.js';

const TEST_URLS = [
  // 1. Stealth Pepper 70SF-R: bass hard lure, prop bait, multiple colors
  'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=3009018&bid=lurefishing&cat=002001003010',
  // 2. ハリネズミ Mini ECO: bass soft lure (Critter Tackle brand)
  'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=30012703&bid=lurefishing&cat=002001004',
  // 3. Crankie Darter 50R: bass hard lure, crankbait (PDL brand)
  'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=302700005&bid=lurefishing&cat=002001003002',
  // 4. Trout: ヴィクセン70F (trout hard lure, minnow)
  'https://www.tiemco.co.jp/Form/Product/ProductDetail.aspx?shop=0&pid=3130001&bid=lurefishing&cat=002002004001',
];

async function main() {
  console.log('=== TIEMCO Scraper Test ===\n');
  let passed = 0;
  let failed = 0;

  for (const url of TEST_URLS) {
    console.log(`\n--- Testing: ${url} ---`);
    try {
      const result = await scrapeTiemcoPage(url);

      // Validation
      const errors: string[] = [];
      if (!result.name || result.name === 'Unknown') errors.push('name is empty/Unknown');
      if (!result.slug) errors.push('slug is empty');
      if (result.manufacturer_slug !== 'tiemco') errors.push('manufacturer_slug != tiemco');
      if (result.type === 'ルアー') errors.push('type is generic "ルアー" (should be specific)');
      if (result.price <= 0) errors.push('price is 0');
      if (result.colors.length === 0) errors.push('no colors');
      if (result.weights.length === 0) errors.push('no weights');
      if (!result.mainImage) errors.push('no mainImage');
      if (!result.description) errors.push('no description');
      if (result.target_fish.length === 0) errors.push('no target_fish');

      console.log(`  name:        ${result.name}`);
      console.log(`  slug:        ${result.slug}`);
      console.log(`  type:        ${result.type}`);
      console.log(`  target_fish: ${result.target_fish.join(', ')}`);
      console.log(`  price:       ¥${result.price} (tax-included)`);
      console.log(`  length:      ${result.length}mm`);
      console.log(`  weights:     [${result.weights.join(', ')}]`);
      console.log(`  colors:      ${result.colors.length}`);
      if (result.colors.length > 0) {
        console.log(`  color[0]:    ${result.colors[0].name} → ${result.colors[0].imageUrl?.substring(0, 80)}...`);
      }
      console.log(`  mainImage:   ${result.mainImage?.substring(0, 80)}...`);
      console.log(`  description: ${result.description?.substring(0, 80)}...`);

      if (errors.length > 0) {
        console.log(`  ⚠️ WARNINGS: ${errors.join('; ')}`);
        failed++;
      } else {
        console.log(`  ✅ PASS`);
        passed++;
      }
    } catch (err) {
      console.error(`  ❌ FAIL: ${err}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
