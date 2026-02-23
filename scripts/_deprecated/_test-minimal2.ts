import { chromium } from 'playwright';

var testScrape = async function(url: string) {
  var browser = await chromium.launch({ headless: true });
  var ctx = await browser.newContext();
  var page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  var data = await page.evaluate(function () {
    var trim = function (s: string): string {
      return (s || '').replace(/[\s\u3000]+/g, ' ').trim();
    };
    return { title: trim(document.title) };
  });
  
  console.log('Result:', JSON.stringify(data));
  await browser.close();
};

testScrape('https://rapala.co.jp/cn6/cn26/agb.html');
