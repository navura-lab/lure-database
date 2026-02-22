// Quick test for DUEL scraper — run with: npx tsx scripts/_test-duel.ts
import { scrapeDuelPage } from './scrapers/duel.js';

const testUrls = [
  // Multi-size sinking pencil (Monster Shot — 6 sizes, different colors per size)
  'https://www.duel.co.jp/products/detail.php?pid=1618',
  // Sonic Boom SBショット (3 sizes, same colors)
  'https://www.duel.co.jp/products/detail.php?pid=1653',
  // Shallow Runner (classic product)
  'https://www.duel.co.jp/products/detail.php?pid=279',
  // La Tour (freshwater crank)
  'https://www.duel.co.jp/products/detail.php?pid=1568',
];

async function main() {
  for (const url of testUrls) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(60));
    try {
      const result = await scrapeDuelPage(url);
      console.log(`  Name: ${result.name}`);
      console.log(`  Slug: ${result.slug}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  Target: ${result.target_fish.join(', ')}`);
      console.log(`  Length: ${result.length}mm`);
      console.log(`  Weights: [${result.weights.join(', ')}]`);
      console.log(`  Colors: ${result.colors.length}`);
      if (result.colors.length > 0) {
        console.log(`    First: ${result.colors[0].name} → ${result.colors[0].imageUrl.substring(0, 80)}`);
        const last = result.colors[result.colors.length - 1];
        console.log(`    Last:  ${last.name} → ${last.imageUrl.substring(0, 80)}`);
      }
      console.log(`  MainImage: ${result.mainImage.substring(0, 80)}`);
      console.log(`  Description: ${result.description.substring(0, 80)}...`);
      console.log(`  ✅ OK`);
    } catch (err: any) {
      console.log(`  ❌ ERROR: ${err.message}`);
    }
  }
  process.exit(0);
}

main();
