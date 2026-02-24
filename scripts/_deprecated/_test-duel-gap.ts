// scripts/_test-duel-gap.ts
// Test the DUEL scraper on 3 URLs that are missing from Supabase.
// Run: cd /Users/user/clawd/micro-saas-factory/lure-database && set -a && source .env && set +a && npx tsx scripts/_test-duel-gap.ts

import { scrapeDuelPage } from './scrapers/duel.js';
import { chromium } from 'playwright';

var TEST_URLS = [
  'https://www.duel.co.jp/products/detail.php?pid=328',
  'https://www.duel.co.jp/products/detail.php?pid=250',
  'https://www.duel.co.jp/products/detail.php?pid=229',
];

async function runTest() {
  console.log('=== DUEL Gap URL Test ===');
  console.log('Testing', TEST_URLS.length, 'URLs\n');

  // First, do a quick raw page check on each URL to see what the page actually returns
  var browser = await chromium.launch({ headless: true });

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log('─'.repeat(70));
    console.log('[' + (i + 1) + '/' + TEST_URLS.length + '] Testing: ' + url);
    console.log('─'.repeat(70));

    // Step 1: Raw page diagnostics
    console.log('\n--- Raw page diagnostics ---');
    var ctx = await browser.newContext();
    var page = await ctx.newPage();
    try {
      var response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log('HTTP status:', response ? response.status() : 'null response');
      console.log('Final URL:', page.url());

      var rawDiag = await page.evaluate(function () {
        var diag: any = {};
        diag.title = document.title;
        diag.h1Count = document.querySelectorAll('h1').length;
        diag.h1Text = '';
        var h1 = document.querySelector('h1');
        if (h1) diag.h1Text = h1.textContent.trim().substring(0, 200);

        // Check for redirect / error indicators
        diag.bodyLength = document.body ? document.body.innerHTML.length : 0;
        diag.hasHeroDetail = !!document.querySelector('h1.l-hero-detail_ttl');
        diag.hasSpecTable = !!document.querySelector('.p-spec-table');
        diag.specRowCount = document.querySelectorAll('.p-spec-table tbody tr').length;
        diag.hasProductListWrapper = !!document.querySelector('.p-product-list_wrapper');
        diag.productListWrapperCount = document.querySelectorAll('.p-product-list_wrapper').length;
        diag.hasColorTitle = !!document.querySelector('.p-color-title');
        diag.colorTitleCount = document.querySelectorAll('.p-color-title').length;
        diag.hasColorSelect = !!document.querySelector('.p-color-select_item');
        diag.colorSelectCount = document.querySelectorAll('.p-color-select_item').length;

        // Check for alternate color selectors
        diag.altColorSelectors = {
          gridProductCol: document.querySelectorAll('.c-grid-product_col').length,
          productListBody: document.querySelectorAll('.p-product-list_body').length,
          productListTtl: document.querySelectorAll('.p-product-list_ttl').length,
          anyH2InWrapper: document.querySelectorAll('.p-product-list_wrapper h2').length,
          anyH3InWrapper: document.querySelectorAll('.p-product-list_wrapper h3').length,
          anyImgInWrapper: document.querySelectorAll('.p-product-list_wrapper img').length,
        };

        // Check for any images with /storage/product/ paths
        var allImgs = document.querySelectorAll('img');
        var productImgs: string[] = [];
        for (var x = 0; x < allImgs.length && x < 5; x++) {
          var src = allImgs[x].src || '';
          if (src.indexOf('/storage/') !== -1) productImgs.push(src);
        }
        diag.productImageSamples = productImgs;

        // og:title
        var ogMeta = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
        diag.ogTitle = ogMeta ? ogMeta.content : '(none)';

        // Check for error / redirect / 404 signals
        diag.has404Text = document.body ? (document.body.textContent || '').indexOf('404') !== -1 : false;
        diag.hasNotFoundText = document.body ? (document.body.textContent || '').toLowerCase().indexOf('not found') !== -1 : false;
        diag.hasRedirectMeta = !!document.querySelector('meta[http-equiv="refresh"]');

        // First 300 chars of body text (stripped)
        var bodyText = document.body ? (document.body.textContent || '').trim() : '';
        diag.bodyTextPreview = bodyText.substring(0, 300);

        return diag;
      });

      console.log('Page title:', rawDiag.title);
      console.log('og:title:', rawDiag.ogTitle);
      console.log('Body HTML length:', rawDiag.bodyLength);
      console.log('h1 count:', rawDiag.h1Count, '| h1 text:', rawDiag.h1Text.substring(0, 100));
      console.log('Has hero detail h1:', rawDiag.hasHeroDetail);
      console.log('Has spec table:', rawDiag.hasSpecTable, '| spec rows:', rawDiag.specRowCount);
      console.log('Has .p-product-list_wrapper:', rawDiag.hasProductListWrapper, '| count:', rawDiag.productListWrapperCount);
      console.log('Has .p-color-title:', rawDiag.hasColorTitle, '| count:', rawDiag.colorTitleCount);
      console.log('Has .p-color-select_item:', rawDiag.hasColorSelect, '| count:', rawDiag.colorSelectCount);
      console.log('Alt color selectors:', JSON.stringify(rawDiag.altColorSelectors));
      console.log('Product image samples:', rawDiag.productImageSamples);
      console.log('404 text?', rawDiag.has404Text, '| Not found text?', rawDiag.hasNotFoundText, '| Redirect meta?', rawDiag.hasRedirectMeta);
      console.log('Body text preview:', rawDiag.bodyTextPreview.substring(0, 200));

    } catch (err: any) {
      console.log('RAW DIAG ERROR:', err.message);
    } finally {
      await ctx.close();
    }

    // Step 2: Run the actual scraper
    console.log('\n--- Scraper output ---');
    try {
      var result = await scrapeDuelPage(url);
      console.log('Name:', result.name);
      console.log('Slug:', result.slug);
      console.log('Type:', result.type);
      console.log('Target fish:', result.target_fish);
      console.log('Weights:', result.weights);
      console.log('Length:', result.length);
      console.log('Colors count:', result.colors.length);
      if (result.colors.length > 0) {
        console.log('First 3 colors:');
        for (var c = 0; c < Math.min(3, result.colors.length); c++) {
          console.log('  ', result.colors[c].name, '-', result.colors[c].imageUrl.substring(0, 80));
        }
      } else {
        console.log('*** NO COLORS RETURNED ***');
      }
      console.log('Main image:', result.mainImage ? result.mainImage.substring(0, 80) : '(none)');
      console.log('Description:', result.description ? result.description.substring(0, 100) : '(none)');
      console.log('Source URL:', result.sourceUrl);
    } catch (err: any) {
      console.log('SCRAPER ERROR:', err.message);
      console.log('Stack:', err.stack);
    }

    console.log('\n');
  }

  await browser.close();
  console.log('=== Test complete ===');
  process.exit(0);
}

runTest().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
