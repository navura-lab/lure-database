// Temporary test script for deps scraper
import { scrapeDepsPage } from './scrapers/deps.js';

const testUrls = [
  'https://www.depsweb.co.jp/product/funaju/',                // BIG BAIT, oz weight
  'https://www.depsweb.co.jp/product/new-silentkiller/',      // Multi-variant
  'https://www.depsweb.co.jp/product/buzzjet-jr/',            // SURFACE BAIT
];

async function main() {
  for (const url of testUrls) {
    try {
      console.log('\n' + '='.repeat(60));
      const result = await scrapeDepsPage(url);
      console.log('--- RESULT ---');
      console.log(`  Name: ${result.name}`);
      console.log(`  Name Kana: ${result.name_kana}`);
      console.log(`  Slug: ${result.slug}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  Price: ${result.price}`);
      console.log(`  Weights: [${result.weights.join(', ')}]`);
      console.log(`  Length: ${result.length}`);
      console.log(`  Colors: ${result.colors.length}`);
      console.log(`  First color: ${result.colors[0]?.name || 'none'}`);
      console.log(`  Main image: ${result.mainImage?.substring(0, 80)}`);
      console.log(`  Description: ${result.description.substring(0, 100)}...`);
    } catch (e) {
      console.error(`ERROR: ${url} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();
