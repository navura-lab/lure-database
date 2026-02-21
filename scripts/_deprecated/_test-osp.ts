// scripts/_test-osp.ts
// Quick test for O.S.P scraper — run then move to _deprecated/
// Usage: npx tsx scripts/_test-osp.ts

import { scrapeOspPage } from './scrapers/osp.js';

const TEST_URLS = [
  // Crankbait with 43 colors
  'https://www.o-s-p.net/products/blitz/',
  // Soft bait with multiple sizes
  'https://www.o-s-p.net/products/doliveshad/',
  // Spinnerbait with oz weights
  'https://www.o-s-p.net/products/high-pitcher/',
  // Salt metal jig
  'https://www.o-s-p.net/products/bonneville/',
];

async function main() {
  for (const url of TEST_URLS) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));

    try {
      const result = await scrapeOspPage(url);
      console.log(JSON.stringify(result, null, 2));
      console.log(`\n✅ ${result.name} | type=${result.type} | price=${result.price} | colors=${result.colors.length} | weights=[${result.weights.join(',')}] | length=${result.length}mm | fish=${result.target_fish.join(',')}`);
    } catch (err) {
      console.error(`\n❌ FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch(console.error);
