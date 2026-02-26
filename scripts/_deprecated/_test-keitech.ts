// Test script for Keitech scraper
// Tests 3 representative products: soft-lure, wire-bait, rubber-jig

import { scrapeKeitechPage } from './scrapers/keitech.js';

var tests = [
  {
    name: 'Easy Shiner (soft-lure)',
    url: 'https://keitech.co.jp/pages/232/',
    expect: {
      minColors: 10,
      type: 'ワーム',
      hasPrice: true,
    },
  },
  {
    name: 'Swing Impact (soft-lure)',
    url: 'https://keitech.co.jp/pages/39/',
    expect: {
      minColors: 5,
      type: 'ワーム',
      hasPrice: true,
    },
  },
  {
    name: 'TEE-BONE Buzzbait (wire-bait)',
    url: 'https://keitech.co.jp/pages/660/',
    expect: {
      minColors: 3,
      type: 'バズベイト',
      hasPrice: true,
    },
  },
];

async function runTests() {
  var passed = 0;
  var failed = 0;

  for (var t of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${t.name}`);
    console.log(`URL: ${t.url}`);
    console.log('='.repeat(60));

    try {
      var result = await scrapeKeitechPage(t.url);

      var errors: string[] = [];

      // Check colors
      if (result.colors.length < t.expect.minColors) {
        errors.push(`Colors: ${result.colors.length} < ${t.expect.minColors} expected`);
      }
      var colorsWithImg = result.colors.filter(function(c) { return c.imageUrl && c.imageUrl.length > 0; }).length;
      if (colorsWithImg < result.colors.length * 0.5) {
        errors.push(`Color images: ${colorsWithImg}/${result.colors.length} (< 50%)`);
      }

      // Check type
      if (result.type !== t.expect.type) {
        errors.push(`Type: "${result.type}" !== "${t.expect.type}"`);
      }

      // Check price
      if (t.expect.hasPrice && (!result.price || result.price <= 0)) {
        errors.push(`Price missing: ${result.price}`);
      }

      // Check basics
      if (!result.name) errors.push('Name missing');
      if (!result.slug) errors.push('Slug missing');
      if (!result.mainImage) errors.push('Main image missing');

      console.log(`\nResult: ${result.name} (${result.name_kana})`);
      console.log(`  Slug: ${result.slug}`);
      console.log(`  Type: ${result.type}`);
      console.log(`  Target: ${result.target_fish.join(', ')}`);
      console.log(`  Colors: ${result.colors.length} (${colorsWithImg} with image)`);
      console.log(`  Price: ¥${result.price}`);
      console.log(`  Weights: ${JSON.stringify(result.weights)}`);
      console.log(`  Length: ${result.length}mm`);
      console.log(`  Main image: ${result.mainImage}`);

      if (result.colors.length > 0) {
        console.log(`  First color: ${result.colors[0].name}`);
        console.log(`  First color img: ${result.colors[0].imageUrl?.substring(0, 80)}`);
      }

      if (errors.length > 0) {
        console.log(`\n  ❌ FAILED: ${errors.join('; ')}`);
        failed++;
      } else {
        console.log(`\n  ✅ PASSED`);
        passed++;
      }
    } catch (err: any) {
      console.log(`\n  ❌ ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed (${tests.length} total)`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
