#!/usr/bin/env npx tsx
// scripts/_test-luckycraft.ts
// Quick test for the LUCKY CRAFT scraper — run then move to _deprecated/

import { scrapeLuckyCraftPage } from './scrapers/luckycraft.js';

const TEST_URLS = [
  // New template — Bass crank with multiple variants + color charts
  'http://www.luckycraft.co.jp/product/bass/BevyCrank.html',
  // New template — Bass topwater (Sammy) — many size variants
  'http://www.luckycraft.co.jp/product/bass/Sammy.html',
  // Old template — Salt FlashMinnow — old spec table format
  'http://www.luckycraft.co.jp/product/salt/FlashMinnow.html',
  // New template — swlightgame MLG Wander
  'http://www.luckycraft.co.jp/product/swlightgame/MLG/Wander.html',
];

async function main() {
  for (const url of TEST_URLS) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));

    try {
      const result = await scrapeLuckyCraftPage(url);
      console.log(`Name:        ${result.name}`);
      console.log(`Slug:        ${result.slug}`);
      console.log(`Type:        ${result.type}`);
      console.log(`Price:       ${result.price}`);
      console.log(`Length:      ${result.length}mm`);
      console.log(`Weights:     [${result.weights.join(', ')}]`);
      console.log(`Colors:      ${result.colors.length}`);
      console.log(`Target Fish: ${result.target_fish.join(', ')}`);
      console.log(`Main Image:  ${result.mainImage}`);
      console.log(`Description: ${result.description.substring(0, 80)}...`);
      if (result.colors.length > 0) {
        console.log(`  First color: ${result.colors[0].name} → ${result.colors[0].imageUrl}`);
      }
      console.log('✅ OK');
    } catch (err) {
      console.error(`❌ FAILED: ${err}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
