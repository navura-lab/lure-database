// scripts/_test-duo-gap.ts
// Test the DUO scraper on 3 URLs that are missing from Supabase.

import { scrapeDuoPage } from './scrapers/duo.js';

var testUrls = [
  'https://www.duo-inc.co.jp/product/152',
  'https://www.duo-inc.co.jp/product/120',
  'https://www.duo-inc.co.jp/product/7',
];

async function runTests() {
  console.log('=== DUO Gap Scraper Test ===');
  console.log('Testing ' + testUrls.length + ' URLs\n');

  var results: Array<{
    url: string;
    success: boolean;
    name?: string;
    colorCount?: number;
    weightCount?: number;
    weights?: number[];
    price?: number;
    length?: number | null;
    type?: string;
    error?: string;
    colorsPreview?: string[];
  }> = [];

  for (var i = 0; i < testUrls.length; i++) {
    var url = testUrls[i];
    console.log('----------------------------------------');
    console.log('TEST ' + (i + 1) + '/' + testUrls.length + ': ' + url);
    console.log('----------------------------------------');

    try {
      var lure = await scrapeDuoPage(url);

      var entry = {
        url: url,
        success: true,
        name: lure.name,
        colorCount: lure.colors.length,
        weightCount: lure.weights.length,
        weights: lure.weights,
        price: lure.price,
        length: lure.length,
        type: lure.type,
        colorsPreview: lure.colors.slice(0, 5).map(function(c) { return c.name; }),
      };

      results.push(entry);

      console.log('\n  >> Name:    ' + lure.name);
      console.log('  >> Slug:    ' + lure.slug);
      console.log('  >> Type:    ' + lure.type);
      console.log('  >> Price:   ' + lure.price);
      console.log('  >> Weights: [' + lure.weights.join(', ') + ']');
      console.log('  >> Length:  ' + lure.length);
      console.log('  >> Colors:  ' + lure.colors.length);
      if (lure.colors.length > 0) {
        console.log('  >> First 5 colors:');
        lure.colors.slice(0, 5).forEach(function(c) {
          console.log('     - ' + c.name);
          console.log('       img: ' + c.imageUrl.substring(0, 80) + '...');
        });
      }
      if (lure.colors.length === 0) {
        console.log('  >> WARNING: 0 colors returned!');
      }
      if (lure.weights.length === 0) {
        console.log('  >> WARNING: 0 weights returned!');
      }
      if (lure.price === 0) {
        console.log('  >> WARNING: price is 0!');
      }
      console.log('  >> MainImg: ' + (lure.mainImage || '(none)').substring(0, 80));
      console.log('  >> Desc:    ' + (lure.description || '(none)').substring(0, 100));
      console.log('');

    } catch (err: any) {
      console.log('\n  >> ERROR: ' + (err.message || String(err)));
      results.push({
        url: url,
        success: false,
        error: err.message || String(err),
      });
      console.log('');
    }
  }

  // Summary
  console.log('========================================');
  console.log('SUMMARY');
  console.log('========================================');
  for (var j = 0; j < results.length; j++) {
    var r = results[j];
    if (r.success) {
      console.log(
        (r.colorCount === 0 || r.weightCount === 0 ? 'WARN' : 'OK  ') +
        ' | ' + r.url +
        ' | name="' + r.name + '"' +
        ' | colors=' + r.colorCount +
        ' | weights=' + JSON.stringify(r.weights) +
        ' | price=' + r.price +
        ' | type=' + r.type
      );
    } else {
      console.log('FAIL | ' + r.url + ' | ' + r.error);
    }
  }
}

runTests().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
