// scripts/_test-apia.ts
// Quick test for APIA scraper — run 3 diverse products.
// Usage: npx tsx scripts/_test-apia.ts
// After verification, move to scripts/_deprecated/_test-apia.ts

import { scrapeApiaPage } from './scrapers/apia.js';

const TEST_URLS = [
  'https://www.apiajapan.com/product/lure/masterpiece120fl/',   // ミノー, SEABASS
  'https://www.apiajapan.com/product/lure/gem45-55/',            // チヌ向け, 複数ウェイト
  'https://www.apiajapan.com/product/lure/juicy-2/',             // 別タイプ
];

async function main() {
  console.log('=== APIA Scraper Test ===\n');
  let passed = 0;
  let failed = 0;

  for (const url of TEST_URLS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(60));

    try {
      const result = await scrapeApiaPage(url);

      // Validation
      const issues: string[] = [];
      if (!result.name) issues.push('name is empty');
      if (!result.slug) issues.push('slug is empty');
      if (result.price === 0) issues.push('price is 0');
      if (result.colors.length === 0) issues.push('no colors found');
      if (result.weights.length === 0) issues.push('no weights found');
      if (!result.mainImage) issues.push('no mainImage');
      if (result.type === 'ルアー') issues.push('type is generic "ルアー"');
      if (result.target_fish.length === 0) issues.push('no target_fish');

      console.log(`\n  Name:        ${result.name}`);
      console.log(`  Slug:        ${result.slug}`);
      console.log(`  Type:        ${result.type}`);
      console.log(`  Target Fish: ${result.target_fish.join(', ')}`);
      console.log(`  Price:       ¥${result.price} (tax-incl)`);
      console.log(`  Weights:     [${result.weights.join(', ')}]g`);
      console.log(`  Length:      ${result.length}mm`);
      console.log(`  Colors:      ${result.colors.length}`);
      result.colors.slice(0, 3).forEach((c, i) => {
        console.log(`    ${i + 1}. ${c.name} → ${c.imageUrl.substring(0, 80)}...`);
      });
      if (result.colors.length > 3) console.log(`    ... and ${result.colors.length - 3} more`);
      console.log(`  MainImage:   ${result.mainImage.substring(0, 80)}...`);
      console.log(`  Description: ${result.description.substring(0, 100)}...`);

      if (issues.length > 0) {
        console.log(`\n  ⚠️  Issues: ${issues.join(', ')}`);
        failed++;
      } else {
        console.log(`\n  ✅ All checks passed`);
        passed++;
      }
    } catch (err) {
      console.error(`\n  ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${TEST_URLS.length}`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
