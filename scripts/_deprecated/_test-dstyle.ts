// _test-dstyle.ts — Quick validation for the DSTYLE scraper
// Run: npx tsx scripts/_test-dstyle.ts

import { scrapeDstylePage } from './scrapers/dstyle.js';

var tests = [
  {
    label: 'VIROLA 2.8inch (Soft Lure)',
    url: 'https://dstyle-lure.co.jp/products/virola2-8/',
    expectSlug: 'virola2-8',
    expectType: 'ワーム',
    expectColorsMin: 10,
    expectPrice: true,
    expectLength: true,
  },
  {
    label: 'D-SPIKER COMPACT DW (Spinnerbait)',
    url: 'https://dstyle-lure.co.jp/products/d-spiker-compact-dw/',
    expectSlug: 'd-spiker-compact-dw',
    expectType: 'スピナーベイト',
    expectColorsMin: 5,
    expectPrice: true,
    expectLength: false,
  },
  {
    label: 'D-JIG COVER (Jig)',
    url: 'https://dstyle-lure.co.jp/products/d-jig-cover/',
    expectSlug: 'd-jig-cover',
    expectType: 'ラバージグ',
    expectColorsMin: 5,
    expectPrice: true,
    expectLength: false,
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
      var result = await scrapeDstylePage(t.url);
      var errors: string[] = [];

      // Check slug
      if (result.slug !== t.expectSlug) {
        errors.push('slug: got "' + result.slug + '", expected "' + t.expectSlug + '"');
      }

      // Check type
      if (result.type !== t.expectType) {
        errors.push('type: got "' + result.type + '", expected "' + t.expectType + '"');
      }

      // Check colors
      if (result.colors.length < t.expectColorsMin) {
        errors.push('colors: got ' + result.colors.length + ', expected >= ' + t.expectColorsMin);
      }

      // Check price
      if (t.expectPrice && result.price <= 0) {
        errors.push('price: got ' + result.price + ', expected > 0');
      }

      // Check length
      if (t.expectLength && !result.length) {
        errors.push('length: got null, expected a value');
      }

      // Check mainImage
      if (!result.mainImage || !result.mainImage.startsWith('http')) {
        errors.push('mainImage: got "' + result.mainImage + '", expected http URL');
      }

      // Check color images
      var colorsWithImg = result.colors.filter(function(c) { return c.imageUrl && c.imageUrl.startsWith('http'); }).length;
      var imgRate = result.colors.length > 0 ? Math.round(colorsWithImg / result.colors.length * 100) : 0;

      console.log('\n--- Result ---');
      console.log('  Name:    ' + result.name);
      console.log('  Slug:    ' + result.slug);
      console.log('  Type:    ' + result.type);
      console.log('  Colors:  ' + result.colors.length + ' (' + colorsWithImg + ' with images, ' + imgRate + '%)');
      console.log('  Price:   ' + result.price);
      console.log('  Length:  ' + result.length + 'mm');
      console.log('  Weights: ' + JSON.stringify(result.weights));
      console.log('  Image:   ' + result.mainImage);

      if (result.colors.length > 0) {
        console.log('  Sample colors:');
        for (var ci = 0; ci < Math.min(3, result.colors.length); ci++) {
          console.log('    ' + result.colors[ci].name + ' → ' + result.colors[ci].imageUrl.substring(0, 80) + '...');
        }
      }

      if (errors.length > 0) {
        console.log('\n  ❌ FAILED:');
        for (var ei = 0; ei < errors.length; ei++) {
          console.log('    - ' + errors[ei]);
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

  console.log('\n========================================');
  console.log('RESULTS: ' + passed + '/' + tests.length + ' passed, ' + failed + ' failed');
  console.log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
