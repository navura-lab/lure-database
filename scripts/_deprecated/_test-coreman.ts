// scripts/_test-coreman.ts
// Quick test for COREMAN scraper — move to _deprecated/ after verification
//
// Usage: npx tsx scripts/_test-coreman.ts

import { scrapeCoremanPage } from './scrapers/coreman.js';

const TEST_URLS = [
  // VJ-16: バイブレーションジグヘッド (flagship product, many colors)
  'https://www.coreman.jp/product_lure/vj-16-vibration-jighead/',
  // IP-26: メタルバイブ (IRON PLATE SC, multi-variant page)
  'https://www.coreman.jp/product_lure/ip-26-ironplate-sc/',
  // BC-26: バイブレーション (BACK CHATTER)
  'https://www.coreman.jp/product_lure/bc-26-backchatter/',
];

async function main() {
  console.log('=== COREMAN Scraper Test ===\n');

  for (const url of TEST_URLS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`URL: ${url}`);
    console.log('='.repeat(70));

    try {
      const result = await scrapeCoremanPage(url);
      console.log(`\nResult:`);
      console.log(`  Name:       ${result.name}`);
      console.log(`  Slug:       ${result.slug}`);
      console.log(`  Type:       ${result.type}`);
      console.log(`  Price:      ${result.price}円 (税込)`);
      console.log(`  Length:     ${result.length}mm`);
      console.log(`  Weights:    [${result.weights.join(', ')}]`);
      console.log(`  Colors:     ${result.colors.length}`);
      if (result.colors.length > 0) {
        console.log(`  Sample colors:`);
        for (const c of result.colors.slice(0, 3)) {
          console.log(`    - ${c.name}: ${c.imageUrl.substring(0, 80)}...`);
        }
      }
      console.log(`  TargetFish: [${result.target_fish.join(', ')}]`);
      console.log(`  MainImage:  ${result.mainImage.substring(0, 80)}`);
      console.log(`  Description: ${result.description.substring(0, 80)}...`);
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
