// _test-engine.ts — Quick validation for the ENGINE scraper
// Run: npx tsx scripts/_test-engine.ts

import { scrapeEnginePage } from './scrapers/engine.js';

var tests = [
  {
    label: 'LikeFiveES (Soft bait, 10 colors, ¥1,089)',
    url: 'https://engine.rings-fishing.jp/page2/likefivees/',
    expectSlug: 'likefivees',
    expectType: 'ワーム',
    expectColorsMin: 8,
    expectLengthMm: null,
    expectPriceMin: 900,
  },
  {
    label: 'Surfacehang60 (Hard bait, 14 colors, 60mm)',
    url: 'https://engine.rings-fishing.jp/page2/surfacehang60/',
    expectSlug: 'surfacehang60',
    expectType: 'ルアー',
    expectColorsMin: 10,
    expectLengthMm: 60,
    expectPriceMin: 0,
  },
  {
    label: 'Like3 (Soft bait, worm type)',
    url: 'https://engine.rings-fishing.jp/page2/like3/',
    expectSlug: 'like3',
    expectType: 'ワーム',
    expectColorsMin: 5,
    expectLengthMm: null,
    expectPriceMin: 0,
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
      var result = await scrapeEnginePage(t.url);
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
      if (t.expectLengthMm && result.length && Math.abs(result.length - t.expectLengthMm) > 5) {
        errors.push('length: got ' + result.length + 'mm, expected ~' + t.expectLengthMm + 'mm');
      }
      if (t.expectPriceMin && result.price < t.expectPriceMin) {
        errors.push('price: got ¥' + result.price + ', expected >= ¥' + t.expectPriceMin);
      }
      if (!result.mainImage || !result.mainImage.startsWith('http')) {
        errors.push('mainImage: got "' + result.mainImage + '", expected http URL');
      }
      if (result.manufacturer !== 'ENGINE') {
        errors.push('manufacturer: got "' + result.manufacturer + '", expected "ENGINE"');
      }

      var colorsWithImg = result.colors.filter(function(c) { return c.imageUrl && c.imageUrl.startsWith('http'); }).length;
      var imgRate = result.colors.length > 0 ? Math.round(colorsWithImg / result.colors.length * 100) : 0;

      console.log('\n--- Result ---');
      console.log('  Name:       ' + result.name);
      console.log('  Kana:       ' + result.name_kana);
      console.log('  Slug:       ' + result.slug);
      console.log('  Type:       ' + result.type);
      console.log('  Target:     ' + result.target_fish.join(', '));
      console.log('  Colors:     ' + result.colors.length + ' (' + colorsWithImg + ' with images, ' + imgRate + '%)');
      console.log('  Price:      ¥' + result.price);
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
