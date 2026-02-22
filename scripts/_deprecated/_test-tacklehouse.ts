// Quick test for Tackle House scraper — run with: npx tsx scripts/_test-tacklehouse.ts
import { scrapeTacklehousePage } from './scrapers/tacklehouse.js';

const testUrls = [
  // Rolling Bait — 7 models, 27+7 colors, saltwater vibration classic
  'https://tacklehouse.co.jp/product/rollingbait.html',
  // Contact Feed Popper — 11 models, multiple color chart sections
  'https://tacklehouse.co.jp/product/con_cfp.html',
  // elfin Cicada — trout topwater, shared color chart note
  'https://tacklehouse.co.jp/product/el_ci.html',
  // K2F — minnow, extended table (Maxdepth column)
  'https://tacklehouse.co.jp/product/k2f.html',
];

async function main() {
  for (const url of testUrls) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(60));
    try {
      const result = await scrapeTacklehousePage(url);
      console.log(`  Name: ${result.name}`);
      console.log(`  Slug: ${result.slug}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  Target: ${result.target_fish.join(', ')}`);
      console.log(`  Length: ${result.length}mm`);
      console.log(`  Weights: [${result.weights.join(', ')}]`);
      console.log(`  Price: ￥${result.price}`);
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
