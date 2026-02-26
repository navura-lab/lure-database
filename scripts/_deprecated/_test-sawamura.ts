// scripts/_test-sawamura.ts
// Quick smoke test for the Sawamura scraper
// Usage: npx tsx scripts/_test-sawamura.ts

import { scrapeSawamuraPage } from './scrapers/sawamura.js';

interface TestCase {
  name: string;
  url: string;
  expectedType: string;
}

var tests: TestCase[] = [
  {
    name: 'ワンナップシャッド5" (モノトーン)',
    url: 'https://karil.co.jp/?p=2433',
    expectedType: 'ワーム',
  },
  {
    name: 'バレット2.5" スローシンキング',
    url: 'https://karil.co.jp/?p=2344',
    expectedType: 'ワーム',
  },
  {
    name: 'ワンナップバイブレード',
    url: 'https://karil.co.jp/?p=115',
    expectedType: 'ルアー',
  },
];

async function runTests() {
  var passed = 0;
  var failed = 0;

  for (var t = 0; t < tests.length; t++) {
    var test = tests[t];
    console.log('\n' + '='.repeat(60));
    console.log('TEST: ' + test.name);
    console.log('URL: ' + test.url);
    console.log('='.repeat(60));

    try {
      var result = await scrapeSawamuraPage(test.url);

      console.log('\nResult: ' + result.name);
      console.log('  Slug: ' + result.slug);
      console.log('  Type: ' + result.type);
      console.log('  Target: ' + result.target_fish.join(', '));
      console.log('  Colors: ' + result.colors.length + ' (' + result.colors.filter(function(c) { return !!c.imageUrl; }).length + ' with image)');
      console.log('  Price: ¥' + result.price);
      console.log('  Weights: [' + result.weights.join(',') + ']');
      console.log('  Length: ' + result.length + 'mm');
      console.log('  Main image: ' + result.mainImage);
      if (result.colors.length > 0) {
        console.log('  First color: ' + result.colors[0].name);
        console.log('  First color img: ' + result.colors[0].imageUrl);
      }

      // Validation
      var errors: string[] = [];
      if (result.colors.length < 1) errors.push('No colors found');
      if (result.price <= 0) errors.push('No price');
      if (!result.mainImage) errors.push('No main image');
      if (result.type !== test.expectedType) errors.push('Wrong type: ' + result.type + ' (expected ' + test.expectedType + ')');

      var colorsWithImg = result.colors.filter(function(c) { return !!c.imageUrl; }).length;
      if (result.colors.length > 0 && colorsWithImg / result.colors.length < 0.5) {
        errors.push('Color images: ' + colorsWithImg + '/' + result.colors.length + ' (< 50%)');
      }

      if (errors.length > 0) {
        for (var e = 0; e < errors.length; e++) {
          console.log('\n  ❌ FAILED: ' + errors[e]);
        }
        failed++;
      } else {
        console.log('\n  ✅ PASSED');
        passed++;
      }
    } catch (err: any) {
      console.log('\n  ❌ ERROR: ' + err.message);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed (' + tests.length + ' total)');
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
