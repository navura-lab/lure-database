import { chromium } from 'playwright';

async function checkDetail(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // 少し待って動的コンテンツを読み込む
  await page.waitForTimeout(3000);
  
  console.log('Title:', await page.title());
  
  // 商品名 - タイトルからパース
  const title = await page.title();
  const productName = title.split('|')[0].trim();
  console.log('Product name:', productName);
  
  // 画像を探す
  const allImgs = await page.locator('img').all();
  console.log('Total images:', allImgs.length);
  
  const productImgs: string[] = [];
  for (const img of allImgs) {
    const src = await img.getAttribute('src') || '';
    // CDN画像
    if (src.includes('/cdn/images/')) {
      productImgs.push('https://www.bluebluefishing.com' + src);
    }
  }
  
  console.log('\nCDN product images:', productImgs.length);
  for (const src of productImgs.slice(0, 15)) {
    console.log('  ', src);
  }
  
  await browser.close();
}

checkDetail(process.argv[2] || 'https://www.bluebluefishing.com/item/detail/000153/');
