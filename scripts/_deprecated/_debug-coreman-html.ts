// scripts/_debug-coreman-html.ts
// Debug: dump key HTML signals from the 3 failing COREMAN URLs

import { chromium } from 'playwright';

var TEST_URLS = [
  'https://www.coreman.jp/product_lure/booster-system-123/',
  'https://www.coreman.jp/product_lure/alkali-70%e3%8e%9c/',
  'https://www.coreman.jp/product_lure/ip-10-ironplate-highlow/',
];

async function debugPages() {
  var browser = await chromium.launch({ headless: true });

  for (var i = 0; i < TEST_URLS.length; i++) {
    var url = TEST_URLS[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`URL: ${url}`);
    console.log('='.repeat(80));

    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    var response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`HTTP Status: ${response?.status()}`);

    await page.waitForSelector('.e-con', { timeout: 10000 }).catch(function() {
      console.log('  [warn] .e-con selector not found within 10s');
    });
    await page.waitForTimeout(2000);

    var debug = await page.evaluate(function() {
      var result: any = {};

      // Title
      result.title = document.title;

      // All img srcs
      var imgs = document.querySelectorAll('img');
      result.allImgSrcs = [];
      for (var j = 0; j < imgs.length; j++) {
        var src = imgs[j].getAttribute('src') || '';
        if (src) result.allImgSrcs.push(src);
      }

      // Check for color images specifically
      var colorImgs = document.querySelectorAll('img[src*="/color-"]');
      result.colorImgCount = colorImgs.length;
      result.colorImgSrcs = [];
      for (var k = 0; k < colorImgs.length; k++) {
        result.colorImgSrcs.push(colorImgs[k].getAttribute('src'));
      }

      // Check for ANY img with "color" in src
      var anyColorImgs = document.querySelectorAll('img[src*="color"]');
      result.anyColorImgCount = anyColorImgs.length;

      // Body text (truncated)
      var bodyText = document.body.innerText || '';
      result.bodyTextLength = bodyText.length;
      result.bodyTextPreview = bodyText.substring(0, 2000);

      // Check for spec marker
      result.hasSpecMarker = bodyText.includes('SPEC') || bodyText.includes('spec');
      result.hasLureSpec = bodyText.includes('LURE SPEC');
      result.hasPriceText = bodyText.includes('円') || bodyText.includes('JPY');

      // Check e-con count
      var eCons = document.querySelectorAll('.e-con');
      result.eConCount = eCons.length;

      // Check for figures / figcaptions
      var figures = document.querySelectorAll('figure');
      result.figureCount = figures.length;

      // All anchors that might be "detail" links
      var anchors = document.querySelectorAll('a');
      result.anchorHrefs = [];
      for (var a = 0; a < anchors.length; a++) {
        var href = anchors[a].getAttribute('href') || '';
        var text = anchors[a].textContent?.trim() || '';
        if (href && (text.includes('詳') || text.includes('detail') || text.includes('こちら'))) {
          result.anchorHrefs.push({ href: href, text: text });
        }
      }

      // Meta description
      var metaDesc = document.querySelector('meta[name="description"]');
      result.metaDescription = metaDesc?.getAttribute('content') || '';

      // Full HTML size
      result.htmlSize = document.documentElement.outerHTML.length;

      return result;
    });

    console.log(`\n  Title:           ${debug.title}`);
    console.log(`  HTML size:       ${debug.htmlSize} chars`);
    console.log(`  Body text len:   ${debug.bodyTextLength} chars`);
    console.log(`  .e-con count:    ${debug.eConCount}`);
    console.log(`  figure count:    ${debug.figureCount}`);
    console.log(`  color-* imgs:    ${debug.colorImgCount}`);
    console.log(`  any color imgs:  ${debug.anyColorImgCount}`);
    console.log(`  total imgs:      ${debug.allImgSrcs.length}`);
    console.log(`  has SPEC:        ${debug.hasSpecMarker}`);
    console.log(`  has LURE SPEC:   ${debug.hasLureSpec}`);
    console.log(`  has price text:  ${debug.hasPriceText}`);
    console.log(`  meta desc:       ${debug.metaDescription}`);

    console.log(`\n  Image srcs:`);
    for (var s = 0; s < debug.allImgSrcs.length; s++) {
      console.log(`    ${debug.allImgSrcs[s]}`);
    }

    if (debug.anchorHrefs.length > 0) {
      console.log(`\n  Detail/link anchors:`);
      for (var a = 0; a < debug.anchorHrefs.length; a++) {
        console.log(`    "${debug.anchorHrefs[a].text}" -> ${debug.anchorHrefs[a].href}`);
      }
    }

    console.log(`\n  Body text preview:\n---`);
    console.log(debug.bodyTextPreview);
    console.log('---');

    await context.close();
  }

  await browser.close();
}

debugPages().catch(function(err) {
  console.error('Fatal:', err);
  process.exit(1);
});
