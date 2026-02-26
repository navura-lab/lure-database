// Test script for Fish Arrow scraper
// Tests 3 representative products: soft-lure (Bass), hard-lure (Salt), soft-lure (Salt)

import { scrapeFisharrowPage } from './scrapers/fisharrow.js';

var tests = [
  {
    name: 'Flash-J 3inch (Bass soft-lure)',
    url: 'https://fisharrow.co.jp/product/flash-j-3inch/',
    expect: {
      minColors: 10,
      type: 'ワーム',
      hasPrice: true,
      targetFish: 'ブラックバス',
    },
  },
  {
    name: 'Flash-J Huddle1 (Bass soft-lure)',
    url: 'https://fisharrow.co.jp/product/flash-j%e3%80%80huddle1/',
    expect: {
      minColors: 5,
      type: 'ワーム',
      hasPrice: true,
      targetFish: 'ブラックバス',
    },
  },
  {
    name: 'RiSER JACK (Bass+Salt hard-lure)',
    url: 'https://fisharrow.co.jp/product/riser-jack/',
    expect: {
      minColors: 3,
      type: 'ルアー',
      hasPrice: true,
      hasWeight: true,
      hasLength: true,
      targetFish: 'ブラックバス',
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
      var result = await scrapeFisharrowPage(t.url);

      var errors: string[] = [];

      // Check colors
      if (result.colors.length < t.expect.minColors) {
        errors.push(`Colors: ${result.colors.length} < ${t.expect.minColors} expected`);
      }
      var colorsWithImg = result.colors.filter(function (c) { return c.imageUrl && c.imageUrl.length > 0; }).length;
      if (colorsWithImg < result.colors.length * 0.8) {
        errors.push(`Color images: ${colorsWithImg}/${result.colors.length} (< 80%)`);
      }

      // Check type
      if (result.type !== t.expect.type) {
        errors.push(`Type: "${result.type}" !== "${t.expect.type}"`);
      }

      // Check price
      if (t.expect.hasPrice && (!result.price || result.price <= 0)) {
        errors.push(`Price missing: ${result.price}`);
      }

      // Check weight (if expected)
      if (t.expect.hasWeight && result.weights.length === 0) {
        errors.push(`Weight missing`);
      }

      // Check length (if expected)
      if (t.expect.hasLength && result.length === null) {
        errors.push(`Length missing`);
      }

      // Check target fish
      if (!result.target_fish.includes(t.expect.targetFish)) {
        errors.push(`Target fish: ${result.target_fish} missing ${t.expect.targetFish}`);
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
