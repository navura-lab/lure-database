// _test-reins.ts — Quick validation for the REINS scraper
// Run: npx tsx scripts/_test-reins.ts

import { scrapeReinsPage } from './scrapers/reins.js';

var tests = [
  {
    label: '3" Rockvibe Shad (Swimbait, 12 colors)',
    url: 'https://www.reinsfishing.com/product/3-rockvibe-shad/',
    expectSlug: '3-rockvibe-shad',
    expectType: 'ワーム',
    expectColorsMin: 10,
    expectLengthMm: 76, // 3" ≈ 76.2mm
  },
  {
    label: 'Bubbling Craw 3.5" (Craw, 6 colors)',
    url: 'https://www.reinsfishing.com/product/bubbling-craw-3-5/',
    expectSlug: 'bubbling-craw-3-5',
    expectType: 'ワーム',
    expectColorsMin: 5,
    expectLengthMm: 89, // 3.5" ≈ 88.9mm
  },
  {
    label: '5" Bubbling Shaker (Worm, 17 colors)',
    url: 'https://www.reinsfishing.com/product/5-bubbling-shaker/',
    expectSlug: '5-bubbling-shaker',
    expectType: 'ワーム',
    expectColorsMin: 15,
    expectLengthMm: 127, // 5" ≈ 127mm
  },
];

async function runTests() {
  var passed = 0;
  var failed = 0;

  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    console.log('\n========================================');
    console.log('TEST ' + (i + 1) + '/' + tests.length + ': ' + t.label);
    console.log('========================================');

    try {
      var result = await scrapeReinsPage(t.url);
      var errors: string[] = [];

      if (result.slug !== t.expectSlug) {
        errors.push('slug: got "' + result.slug + '", expected "' + t.expectSlug + '"');
      }
      if (result.type !== t.expectType) {
        errors.push('type: got "' + result.type + '", expected "' + t.expectType + '"');
      }
      if (result.colors.length < t.expectColorsMin) {
        errors.push('colors: got ' + result.colors.length + ', expected >= ' + t.expectColorsMin);
      }
      if (t.expectLengthMm && (!result.length || Math.abs(result.length - t.expectLengthMm) > 2)) {
        errors.push('length: got ' + result.length + 'mm, expected ~' + t.expectLengthMm + 'mm');
      }
      if (!result.mainImage || !result.mainImage.startsWith('http')) {
        errors.push('mainImage: got "' + result.mainImage + '", expected http URL');
      }
      if (result.manufacturer !== 'REINS') {
        errors.push('manufacturer: got "' + result.manufacturer + '", expected "REINS"');
      }

      var colorsWithImg = result.colors.filter(function(c) { return c.imageUrl && c.imageUrl.startsWith('http'); }).length;
      var imgRate = result.colors.length > 0 ? Math.round(colorsWithImg / result.colors.length * 100) : 0;

      console.log('\n--- Result ---');
      console.log('  Name:       ' + result.name);
      console.log('  Slug:       ' + result.slug);
      console.log('  Type:       ' + result.type);
      console.log('  Target:     ' + result.target_fish.join(', '));
      console.log('  Colors:     ' + result.colors.length + ' (' + colorsWithImg + ' with images, ' + imgRate + '%)');
      console.log('  Price:      ' + result.price);
      console.log('  Length:     ' + result.length + 'mm');
      console.log('  Weights:    ' + JSON.stringify(result.weights));
      console.log('  Image:      ' + result.mainImage);
      console.log('  Mfr:        ' + result.manufacturer);
      console.log('  Desc:       ' + (result.description || '').substring(0, 100));

      if (result.colors.length > 0) {
        console.log('  Sample colors:');
        for (var ci = 0; ci < Math.min(5, result.colors.length); ci++) {
          var imgStr = result.colors[ci].imageUrl || 'NO IMG';
          if (imgStr.length > 80) imgStr = '...' + imgStr.substring(imgStr.length - 50);
          console.log('    ' + result.colors[ci].name + ' → ' + imgStr);
        }
      }

      if (errors.length > 0) {
        console.log('\n  ❌ FAILED:');
        for (var ei = 0; ei < errors.length; ei++) console.log('    - ' + errors[ei]);
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

  console.log('\n========================================');
  console.log('RESULTS: ' + passed + '/' + tests.length + ' passed, ' + failed + ' failed');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
