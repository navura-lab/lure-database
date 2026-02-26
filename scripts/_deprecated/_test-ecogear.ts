// _test-ecogear.ts — Quick validation for the Ecogear scraper
// Run: npx tsx scripts/_test-ecogear.ts

import { scrapeEcogearPage } from './scrapers/ecogear.js';

var tests = [
  {
    label: 'Jukusei Aqua Bug Ants (Soft Bait)',
    url: 'https://ecogear.jp/ecogear/ecogear_jukusei_aqua_bugants/',
    expectSlug: 'ecogear_jukusei_aqua_bugants',
    expectType: 'ワーム',
    expectColorsMin: 5,
    expectPrice: true,
  },
  {
    label: 'Breamer Vibe 35 (Hard Bait)',
    url: 'https://ecogear.jp/ecogear/breamer_vibe_35/',
    expectSlug: 'breamer_vibe_35',
    expectType: 'バイブレーション',
    expectColorsMin: 3,
    expectPrice: true,
  },
  {
    label: 'Grass Minnow (Worm)',
    url: 'https://ecogear.jp/ecogear/grass_minnow/',
    expectSlug: 'grass_minnow',
    expectType: 'ワーム',
    expectColorsMin: 5,
    expectPrice: true,
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
      var result = await scrapeEcogearPage(t.url);
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
      if (t.expectPrice && result.price <= 0) {
        errors.push('price: got ' + result.price + ', expected > 0');
      }
      if (!result.mainImage || !result.mainImage.startsWith('http')) {
        errors.push('mainImage: got "' + result.mainImage + '", expected http URL');
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

      if (result.colors.length > 0) {
        console.log('  Sample colors:');
        for (var ci = 0; ci < Math.min(3, result.colors.length); ci++) {
          console.log('    ' + result.colors[ci].name + ' → ' + (result.colors[ci].imageUrl || 'NO IMG').substring(0, 80));
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
