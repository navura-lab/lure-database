import { chromium } from 'playwright';

async function main() {
  var browser = await chromium.launch({ headless: true });
  // Test a REAL page with figures
  var urls = [
    'https://www.coreman.jp/product_lure/pb-20-powerblade/',
    'https://www.coreman.jp/product_lure/vj-36-vibration-jighead/',
  ];
  for (var u = 0; u < urls.length; u++) {
    console.log('\n=== ' + urls[u].split('/product_lure/')[1] + ' ===');
    var page = await browser.newPage();
    await page.goto(urls[u], { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    var data = await page.evaluate(function() {
      var figures = document.querySelectorAll('figure');
      var figInfo: string[] = [];
      for (var i = 0; i < Math.min(figures.length, 5); i++) {
        var img = figures[i].querySelector('img');
        var caption = figures[i].querySelector('figcaption');
        var src = img ? (img.getAttribute('src') || '') : 'no-img';
        var capText = caption ? (caption.textContent || '').trim() : 'no-caption';
        figInfo.push('fig[' + i + ']: src=' + src.substring(0, 80) + ' | caption=' + capText.substring(0, 50));
      }
      // Check COLOR LINEUP section
      var bodyText = (document.body.innerText || '');
      var colorMatch = bodyText.match(/COLOR\s*LINEUP\s*■?([\s\S]*?)$/i);
      var colorSection = colorMatch ? colorMatch[1].substring(0, 500) : 'NOT FOUND';
      return { figCount: figures.length, figInfo: figInfo, colorSection: colorSection };
    });
    console.log('Figures:', data.figCount);
    data.figInfo.forEach(function(f: string) { console.log('  ' + f); });
    console.log('COLOR LINEUP section:', data.colorSection);
    await page.close();
  }
  await browser.close();
}
main();
