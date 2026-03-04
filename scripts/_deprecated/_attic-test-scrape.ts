import { scrapeAtticPage } from './scrapers/attic.js';

async function main() {
  const urls = [
    'https://attic.ne.jp/products/poet5/',
    'https://attic.ne.jp/products/arcrank-mr/',
    'https://attic.ne.jp/products/range-master-85sw/',
  ];
  
  for (const url of urls) {
    console.log(`\n${'='.repeat(60)}`);
    const result = await scrapeAtticPage(url);
    console.log(`\nResult: ${result.name}`);
    console.log(`  mainImage: ${result.mainImage}`);
    console.log(`  colors(${result.colors.length}):`);
    result.colors.forEach(c => console.log(`    - ${c.name} | img: ${c.imageUrl?.substring(0, 60) || 'null'}`));
    console.log(`  weights: [${result.weights.join(', ')}]`);
    console.log(`  length: ${result.length}mm`);
    console.log(`  type: ${result.type}`);
    console.log(`  price: ${result.price}`);
  }
}
main().catch(console.error);
