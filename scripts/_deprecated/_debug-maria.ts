// Debug — inspect the unnamed UL with 8 color images on detail/136
import { chromium } from 'playwright';

async function main() {
  var browser = await chromium.launch({ headless: true });
  var context = await browser.newContext();
  var page = await context.newPage();
  var url = 'https://www.yamaria.co.jp/maria/product/detail/136';

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  try { await page.waitForSelector('h2.item-ttl', { timeout: 10000 }); } catch(e) {}

  var info = await page.evaluate(function() {
    // Find the unnamed ul with 8 imgs
    var allUls = document.querySelectorAll('ul');
    for (var i = 0; i < allUls.length; i++) {
      var ul = allUls[i];
      var imgs = ul.querySelectorAll('img');
      if (imgs.length === 8 && !ul.className) {
        // Found it — inspect its structure
        var liDetails: string[] = [];
        var children = ul.children;
        for (var j = 0; j < children.length; j++) {
          var li = children[j] as HTMLElement;
          liDetails.push(
            'LI[' + j + ']: tag=' + li.tagName +
            ' | innerHTML=' + li.innerHTML.substring(0, 300)
          );
        }
        return {
          ulIndex: i,
          ulParentClass: ((ul.parentElement || {}) as HTMLElement).className || '(none)',
          ulParentTag: ((ul.parentElement || {}) as HTMLElement).tagName || '(none)',
          childCount: children.length,
          details: liDetails,
          outerHTMLPrefix: (ul as HTMLElement).outerHTML.substring(0, 800),
        };
      }
    }
    return { error: 'unnamed ul with 8 imgs not found' };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}

main();
