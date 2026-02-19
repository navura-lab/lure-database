// Test script for Daiwa scraper
// Run: npx tsx scripts/_deprecated/test-daiwa-scraper.ts

import { scrapeDaiwaPage } from '../scrapers/daiwa.js';

const TEST_URLS = [
  // TGベイト (metal jig, multiple weights)
  'https://www.daiwa.com/jp/product/huz2stf',
  // モアザン モンスタースライダー レーザーインパクト (seabass minnow)
  'https://www.daiwa.com/jp/product/tghykxg',
  // 紅牙ブレードブレーカーTG玉神 (tairubber)
  'https://www.daiwa.com/jp/product/pj6atca',
];

async function main() {
  for (const url of TEST_URLS) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));
    try {
      const result = await scrapeDaiwaPage(url);
      console.log('\n--- RESULT ---');
      console.log(`Name: ${result.name}`);
      console.log(`Name Kana: ${result.name_kana}`);
      console.log(`Slug: ${result.slug}`);
      console.log(`Type: ${result.type}`);
      console.log(`Price: ${result.price} yen`);
      console.log(`Length: ${result.length}mm`);
      console.log(`Weights: [${result.weights.join(', ')}]`);
      console.log(`Colors (${result.colors.length}):`);
      result.colors.slice(0, 5).forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.name} → ${c.imageUrl.substring(0, 80)}...`);
      });
      if (result.colors.length > 5) console.log(`  ... and ${result.colors.length - 5} more`);
      console.log(`Main image: ${result.mainImage.substring(0, 80)}...`);
      console.log(`Description: ${result.description.substring(0, 100)}...`);
    } catch (err) {
      console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch(console.error);
