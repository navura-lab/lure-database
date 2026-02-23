// scripts/_test-rapala.ts
// Quick test for the Rapala scraper — run with:
//   npx tsx scripts/_test-rapala.ts

import { scrapeRapalaPage } from './scrapers/rapala.js';

var TEST_URLS = [
  // Blue Fox Count Slipper — small spoon, e-shop links, b-album colors
  'https://rapala.co.jp/cn7/bfcs.html',
  // Rapala Countdown — multi-model classic, e-shop links, multiple b-album color sections
  'https://rapala.co.jp/cn4/cn5/cd.html',
  // Storm Arashi Glide Bait — single model, e-shop link
  'https://rapala.co.jp/cn6/cn26/agb.html',
  // North Craft Air Ogre — bass brand
  'https://rapala.co.jp/cn10/aog.html',
];

async function main() {
  for (var url of TEST_URLS) {
    console.log('\n' + '='.repeat(80));
    console.log('URL:', url);
    console.log('='.repeat(80));
    try {
      var result = await scrapeRapalaPage(url);
      console.log('Name:', result.name);
      console.log('Name Kana:', result.name_kana);
      console.log('Slug:', result.slug);
      console.log('Type:', result.type);
      console.log('Target Fish:', result.target_fish.join(', '));
      console.log('Price:', result.price);
      console.log('Weights:', result.weights.join(', '));
      console.log('Length:', result.length);
      console.log('Colors:', result.colors.length, 'colors');
      if (result.colors.length > 0) {
        console.log('  First:', result.colors[0].name, '→', result.colors[0].imageUrl.substring(0, 80));
        console.log('  Last:', result.colors[result.colors.length - 1].name);
      }
      console.log('Main Image:', result.mainImage.substring(0, 80));
      console.log('Description:', result.description.substring(0, 100) + (result.description.length > 100 ? '...' : ''));
      console.log('Manufacturer:', result.manufacturer, '(' + result.manufacturer_slug + ')');
    } catch (err) {
      console.error('ERROR:', err);
    }
  }
}

main().catch(console.error);
