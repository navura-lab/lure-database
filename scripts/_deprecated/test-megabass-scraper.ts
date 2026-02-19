// scripts/test-megabass-scraper.ts
// Quick test for the Megabass scraper — run a single product and print results
// Usage: npx tsx scripts/test-megabass-scraper.ts [url]

import { scrapeMegabassPage } from './scrapers/megabass.js';

const DEFAULT_URL = 'https://www.megabass.co.jp/site/products/karashi_80/';
const url = process.argv[2] || DEFAULT_URL;

async function main() {
  console.log(`\n=== Testing Megabass Scraper ===`);
  console.log(`URL: ${url}\n`);

  const result = await scrapeMegabassPage(url);

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`Name:         ${result.name}`);
  console.log(`Name Kana:    ${result.name_kana}`);
  console.log(`Slug:         ${result.slug}`);
  console.log(`Manufacturer: ${result.manufacturer}`);
  console.log(`Type:         ${result.type}`);
  console.log(`Price:        ${result.price} yen (tax incl.)`);
  console.log(`Length:        ${result.length}mm`);
  console.log(`Weights:      [${result.weights.join(', ')}]`);
  console.log(`Colors:       ${result.colors.length}`);
  result.colors.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} -> ${c.imageUrl.substring(0, 80)}...`);
  });
  console.log(`Main Image:   ${result.mainImage.substring(0, 80)}...`);
  console.log(`Source URL:   ${result.sourceUrl}`);
  console.log(`Description:  ${result.description.substring(0, 100)}...`);
}

main().catch((err) => {
  console.error('SCRAPER FAILED:', err);
  process.exit(1);
});
