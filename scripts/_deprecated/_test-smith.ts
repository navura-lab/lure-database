// scripts/_test-smith.ts
// Quick test for SMITH scraper — run 4 representative product pages
// Usage: npx tsx scripts/_test-smith.ts
// After verification, move to _deprecated/

import { scrapeSmithPage } from './scrapers/smith.js';

const TEST_URLS = [
  // 1. D-Contact: trout, multiple models (50/63/72), 36 colors, heavy sinking minnow
  'https://www.smith.jp/product/trout/dcontact/dcontact.html',
  // 2. Saruna: salt, multiple models (80F/95F/110F/125F/147MAX F), floating minnow
  'https://www.smith.jp/product/salt/saruna/saruna.html',
  // 3. Zara Spook: Heddon brand, bass, pencil bait
  'https://www.smith.jp/product/heddon/zaraspook/zaraspook.html',
  // 4. Strike Frog: bass, frog type
  'https://www.smith.jp/product/bass/strikefrog/strikefrog.html',
];

async function main() {
  console.log('=== SMITH Scraper Test ===\n');
  let passed = 0;
  let failed = 0;

  for (const url of TEST_URLS) {
    console.log(`\n--- Testing: ${url} ---`);
    try {
      const result = await scrapeSmithPage(url);

      // Validation
      const errors: string[] = [];
      if (!result.name || result.name === 'Unknown') errors.push('name is empty/Unknown');
      if (!result.slug) errors.push('slug is empty');
      if (result.manufacturer_slug !== 'smith') errors.push('manufacturer_slug != smith');
      if (result.type === 'ルアー') errors.push('type is generic "ルアー" (should be specific)');
      // Heddon products use "オープン" (open price) — price=0 is acceptable
      if (result.price <= 0 && !/heddon/i.test(url)) errors.push('price is 0');
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
