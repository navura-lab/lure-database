// scripts/_test-zipbaits-gap.ts
// One-shot test for a single ZIPBAITS URL that is missing from Supabase.
// Usage: cd lure-database && set -a && source .env && set +a && npx tsx scripts/_test-zipbaits-gap.ts

import { scrapeZipbaitsPage } from './scrapers/zipbaits.js';

var TARGET_URL = 'https://www.zipbaits.com/item/?i=90';

async function run() {
  console.log('=== ZIPBAITS gap test ===');
  console.log('URL: ' + TARGET_URL);
  console.log('');

  try {
    var result = await scrapeZipbaitsPage(TARGET_URL);

    console.log('--- RESULT ---');
    console.log('Name:         ' + result.name);
    console.log('Slug:         ' + result.slug);
    console.log('Type:         ' + result.type);
    console.log('Manufacturer: ' + result.manufacturer);
    console.log('Target fish:  ' + result.target_fish.join(', '));
    console.log('Length:        ' + (result.length !== null ? result.length + ' mm' : '(none)'));
    console.log('Weights:      ' + (result.weights.length > 0 ? result.weights.join(', ') + ' g' : '(none)'));
    console.log('Price:        ' + (result.price > 0 ? '¥' + result.price : '(none)'));
    console.log('Colors:       ' + result.colors.length);
    console.log('Main image:   ' + (result.mainImage || '(none)'));
    console.log('Description:  ' + (result.description ? result.description.substring(0, 120) + '...' : '(none)'));
    console.log('Source URL:   ' + result.sourceUrl);
    console.log('');

    if (result.colors.length > 0) {
      console.log('--- COLORS (' + result.colors.length + ') ---');
      for (var i = 0; i < result.colors.length; i++) {
        console.log('  [' + (i + 1) + '] ' + result.colors[i].name);
        console.log('      ' + result.colors[i].imageUrl);
      }
    } else {
      console.log('WARNING: No colors extracted!');
    }

    if (result.weights.length === 0) {
      console.log('WARNING: No weights extracted!');
    }

    console.log('');
    console.log('=== TEST COMPLETE ===');
  } catch (err: any) {
    console.error('ERROR during scrape:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    // Force exit since Playwright browser stays open in the module-level singleton
    process.exit(0);
  }
}

run();
