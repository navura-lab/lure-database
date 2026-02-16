import { chromium } from 'playwright';

async function checkPage(url: string) {
  console.log('Starting browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  console.log('Page title:', await page.title());
  
  // h1を全部取得
  const h1s = await page.locator('h1').all();
  console.log('H1 elements:', h1s.length);
  for (const h1 of h1s) {
    console.log('  -', await h1.textContent());
  }
  
  // 画像を取得
  const imgs = await page.locator('img').all();
  console.log('\nImages:', imgs.length);
  for (let i = 0; i < Math.min(5, imgs.length); i++) {
    const src = await imgs[i].getAttribute('src');
    console.log('  -', src?.substring(0, 80));
  }
  
  await browser.close();
  console.log('Done');
}

checkPage(process.argv[2] || 'https://www.bluebluefishing.com/item/series/001001/001001002/');
