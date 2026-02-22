// scripts/_test-raid.ts
// Quick test for the RAID JAPAN scraper — run with: npx tsx scripts/_test-raid.ts
import { scrapeRaidPage } from './scrapers/raid.js';

var TEST_URLS = [
  // 1. DODGE — crawler bait, hard lure, oz weight, many colors
  'http://raidjapan.com/?product=dodg',
  // 2. LEVEL VIB — vibration, hard lure, oz weight
  'http://raidjapan.com/?product=level-vib',
  // 3. FULLSWING — worm, multi-size, soft bait
  'http://raidjapan.com/?product=fullswing',
  // 4. LEVEL SPIN — spinnerbait, wire bait, different spec format
  'http://raidjapan.com/?product=level-spin',
];

async function main() {
  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST ${i + 1}: ${url}`);
    console.log('='.repeat(60));
    try {
      var result = await scrapeRaidPage(url);
      console.log(`  Name:        ${result.name}`);
      console.log(`  Slug:        ${result.slug}`);
      console.log(`  Type:        ${result.type}`);
      console.log(`  Target Fish: ${result.target_fish.join(', ')}`);
      console.log(`  Price:       ¥${result.price}`);
      console.log(`  Length:      ${result.length}mm`);
      console.log(`  Weights:     [${result.weights.join(', ')}]`);
      console.log(`  Colors:      ${result.colors.length}`);
      if (result.colors.length > 0) {
        console.log(`    First:     ${result.colors[0].name}`);
        console.log(`    Image:     ${result.colors[0].imageUrl.substring(0, 80)}...`);
      }
      console.log(`  Main Image:  ${result.mainImage.substring(0, 80)}...`);
      console.log(`  Description: ${result.description.substring(0, 100)}...`);
      console.log(`  ✅ PASS`);
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${err.message}`);
    }
  }
}

main().catch(console.error);
