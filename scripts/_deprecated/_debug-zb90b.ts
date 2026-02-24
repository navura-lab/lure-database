import { chromium } from 'playwright';

async function main() {
  var browser = await chromium.launch({ headless: true });
  var page = await browser.newPage();
  await page.goto('https://www.zipbaits.com/item/?i=90', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Get inner HTML of #colorArea
  var colorAreaHTML = await page.evaluate(function() {
    var el = document.querySelector('#colorArea');
    return el ? el.innerHTML : 'NOT FOUND';
  });

  // Get body text
  var bodyText = await page.evaluate(function() {
    return (document.body.innerText || '').substring(0, 3000);
  });

  console.log('=== #colorArea innerHTML (first 5000ch) ===');
  console.log(colorAreaHTML.substring(0, 5000));
  console.log('\n=== Body Text ===');
  console.log(bodyText);
  await browser.close();
}
main();
