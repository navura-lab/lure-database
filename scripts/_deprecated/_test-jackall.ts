// Test script for Jackall scraper
// Tests 3 products from different sections (bass, salt shore, salt offshore)

import { scrapeJackallPage } from './scrapers/jackall.js';

const TEST_URLS = [
  // Bass: crank bait
  'https://www.jackall.co.jp/bass/products/lure/crank-bait/master-crank/',
  // Salt shore: sea bass
  'https://www.jackall.co.jp/saltwater/shore-casting/products/lure/sea-bass/hiei-123sf/',
  // Salt offshore: tairaba
  'https://www.jackall.co.jp/saltwater/offshore-casting/products/binbin-switch/',
];

async function main() {
  for (const url of TEST_URLS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));

    try {
      const result = await scrapeJackallPage(url);
      console.log(JSON.stringify(result, null, 2));
      console.log(`\n✅ ${result.name}: ${result.colors.length} colors, ${result.weights.length} weights, price=${result.price}, type=${result.type}`);
    } catch (err) {
      console.error(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch(console.error);
