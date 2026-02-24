// scripts/_test-coreman-gap.ts
// Test the COREMAN scraper against 3 URLs missing from Supabase.
// Run: cd /Users/user/clawd/micro-saas-factory/lure-database && set -a && source .env && set +a && npx tsx scripts/_test-coreman-gap.ts

import { scrapeCoremanPage } from './scrapers/coreman.js';

var TEST_URLS = [
  'https://www.coreman.jp/product_lure/booster-system-123/',
  'https://www.coreman.jp/product_lure/alkali-70%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/ip-10-ironplate-highlow/',
];

async function runTests() {
  console.log('=== COREMAN Gap URL Test ===');
  console.log(`Testing ${TEST_URLS.length} URLs\n`);

  var results: { url: string; ok: boolean; colors: number; weights: number[]; error?: string; data?: any }[] = [];

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log(`\n--- Test ${i + 1}/${TEST_URLS.length} ---`);
    console.log(`URL: ${url}`);
    console.log('');

    try {
      var result = await scrapeCoremanPage(url);

      console.log(`  Name:        ${result.name}`);
      console.log(`  Slug:        ${result.slug}`);
      console.log(`  Type:        ${result.type}`);
      console.log(`  Price:       ${result.price}`);
      console.log(`  Length:      ${result.length}`);
      console.log(`  Weights:     [${result.weights.join(', ')}]`);
      console.log(`  Colors:      ${result.colors.length}`);
      console.log(`  Main Image:  ${result.mainImage}`);
      console.log(`  Description: ${result.description.substring(0, 120)}...`);

      if (result.colors.length > 0) {
        console.log('  Color list:');
        for (var c = 0; c < result.colors.length; c++) {
          console.log(`    [${c}] ${result.colors[c].name} -> ${result.colors[c].imageUrl.substring(0, 80)}...`);
        }
      }

      results.push({
        url: url,
        ok: true,
        colors: result.colors.length,
        weights: result.weights,
        data: {
          name: result.name,
          type: result.type,
          price: result.price,
          length: result.length,
        },
      });
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
      results.push({
        url: url,
        ok: false,
        colors: 0,
        weights: [],
        error: err.message,
      });
    }
  }

  console.log('\n\n=== SUMMARY ===');
  for (var r = 0; r < results.length; r++) {
    var res = results[r];
    var status = res.ok ? 'OK' : 'FAIL';
    var detail = res.ok
      ? `colors=${res.colors}, weights=[${res.weights.join(',')}], name="${res.data?.name}"`
      : `error="${res.error}"`;
    console.log(`  [${status}] ${res.url}`);
    console.log(`         ${detail}`);
  }

  var failCount = results.filter(function(r) { return !r.ok; }).length;
  var zeroColorCount = results.filter(function(r) { return r.ok && r.colors === 0; }).length;
  var zeroWeightCount = results.filter(function(r) { return r.ok && r.weights.length === 0; }).length;

  console.log(`\nTotal: ${results.length} tested, ${failCount} errors, ${zeroColorCount} with 0 colors, ${zeroWeightCount} with 0 weights`);
}

runTests().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
