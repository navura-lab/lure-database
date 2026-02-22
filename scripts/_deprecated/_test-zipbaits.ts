// Quick test for ZIPBAITS scraper — run with: npx tsx scripts/_test-zipbaits.ts
import { scrapeZipbaitsPage } from './scrapers/zipbaits.js';

const testUrls = [
  // System Minnow 7F — シーバス, 単一モデル, 10カラー
  'https://www.zipbaits.com/item/?i=23',
  // System Minnow 15HD-F / 15HD-S — 複数モデル, シーバス
  'https://www.zipbaits.com/item/?i=16',
  // Rigge系 — トラウト
  'https://www.zipbaits.com/item/?i=2',
  // バス用ルアー
  'https://www.zipbaits.com/item/?i=51',
];

async function main() {
  for (const url of testUrls) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(60));
    try {
      const result = await scrapeZipbaitsPage(url);
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
      console.log(`  Description: ${result.description.substring(0, 100)}...`);
      console.log(`  ✅ OK`);
    } catch (err: any) {
      console.log(`  ❌ ERROR: ${err.message}`);
    }
  }
  process.exit(0);
}

main();
