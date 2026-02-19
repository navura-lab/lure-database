import { chromium } from 'playwright';

async function checkImgs(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const allImgs = await page.locator('img').all();
  console.log('Total images:', allImgs.length);
  console.log('');
  
  for (const img of allImgs) {
    const src = await img.getAttribute('src') || '';
    if (!src.includes('banner') && !src.includes('header') && !src.includes('footer') && !src.includes('assets')) {
      console.log(src);
    }
  }
  
  await browser.close();
}

checkImgs(process.argv[2] || 'https://www.bluebluefishing.com/item/detail/000153/');
