import 'dotenv/config';
import { scrapeVivaPage } from './scrapers/viva.js';

async function main() {
  const testUrls = [
    'https://vivanet.co.jp/viva/mazzy-popper/',       // Hard bait with colors
    'https://vivanet.co.jp/viva/ayulasic-shad110f/',   // Viva brand
    'https://vivanet.co.jp/aquawave/aji-pinpin/',      // AquaWave brand
    'https://vivanet.co.jp/aquawave/blade-magic75/',   // AquaWave metal
  ];

  for (const url of testUrls) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(80));

    try {
      const result = await scrapeVivaPage(url);
      console.log(`\n--- Result ---`);
      console.log(`name: ${result.name}`);
      console.log(`slug: ${result.slug}`);
      console.log(`type: ${result.type}`);
      console.log(`target_fish: [${result.target_fish.join(', ')}]`);
      console.log(`description: ${result.description.substring(0, 120)}...`);
      console.log(`price: ${result.price}`);
      console.log(`weights: [${result.weights.join(', ')}]`);
      console.log(`length: ${result.length}mm`);
      console.log(`mainImage: ${result.mainImage}`);
      console.log(`colors: ${result.colors.length}`);
      for (const c of result.colors.slice(0, 5)) {
        console.log(`  - ${c.name} | ${c.imageUrl.substring(0, 80)}`);
      }
      if (result.colors.length > 5) console.log(`  ... and ${result.colors.length - 5} more`);
    } catch (e: any) {
      console.error(`ERROR: ${e.message}`);
    }
  }
}

main();
