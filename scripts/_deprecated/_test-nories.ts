// scripts/_test-nories.ts
// Quick test for Nories scraper — 4 different product types

import { scrapeNoriesPage } from './scrapers/nories.js';

var TEST_URLS = [
  // Hard bait (single model, bass)
  'https://nories.com/bass/complete-square-70/',
  // Soft bait (bass)
  'https://nories.com/bass/escape-twin/',
  // Wire bait / spinnerbait (bass)
  'https://nories.com/bass/crystal-s/',
  // Trout spoon
  'https://trout.nories.com/products/masukurouto/',
];

async function main() {
  for (var url of TEST_URLS) {
    console.log('\n========================================');
    console.log('URL:', url);
    console.log('========================================');
    try {
      var result = await scrapeNoriesPage(url);
      console.log('Name:', result.name);
      console.log('Name Kana:', result.name_kana);
      console.log('Type:', result.type);
      console.log('Target:', result.target_fish.join(', '));
      console.log('Length:', result.length);
      console.log('Weights:', result.weights.join(', '));
      console.log('Price:', result.price ? `¥${result.price}` : 'N/A');
      console.log('Colors:', result.colors.length);
      if (result.colors.length > 0) {
        console.log('  First:', result.colors[0].name);
        console.log('  Last:', result.colors[result.colors.length - 1].name);
        console.log('  First img:', result.colors[0].imageUrl.substring(0, 80) + '...');
      }
      console.log('Main image:', result.mainImage ? result.mainImage.substring(0, 80) + '...' : 'N/A');
      console.log('Description:', result.description ? result.description.substring(0, 60) + '...' : 'N/A');
      console.log('✅ OK');
    } catch (err: any) {
      console.error('❌ ERROR:', err.message);
    }
  }
}

main();
