// scripts/_test-shopify-scraper.ts
// Shopify generic scraper の動作テスト
import { createShopifyScraper } from './scrapers/shopify-generic.js';

const scraper = createShopifyScraper({
  name: '6th Sense',
  slug: '6th-sense',
  baseUrl: 'https://6thsensefishing.com',
});

async function main() {
  try {
    const result = await scraper('https://6thsensefishing.com/products/jigsaw-minnow-fire-craw');
    console.log('✅ 6th Sense scraper OK');
    console.log('  name:', result.name);
    console.log('  slug:', result.slug);
    console.log('  type:', result.type);
    console.log('  manufacturer:', result.manufacturer);
    console.log('  manufacturer_slug:', result.manufacturer_slug);
    console.log('  colors:', result.colors.length);
    console.log('  price:', result.price, 'JPY');
    console.log('  description:', result.description.substring(0, 80) + '...');
    console.log('  target_fish:', result.target_fish);
    console.log('  mainImage:', result.mainImage ? '✅' : '❌');
    console.log('  weights:', result.weights);
    console.log('  length:', result.length);
  } catch (err) {
    console.error('❌ Error:', err);
  }
}
main();
