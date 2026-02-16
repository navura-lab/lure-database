import { chromium } from 'playwright';

async function checkPage(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // ページHTMLの一部を取得
  const html = await page.content();
  
  // シーライド関連のテキストを探す
  const seatideMatch = html.match(/SeaRide|シーライド|sea-ride/gi);
  console.log('SeaRide mentions:', seatideMatch?.length || 0);
  
  // カラー関連のセレクタを探す
  const colorDivs = await page.locator('[class*=color], [class*=Color]').all();
  console.log('Color divs:', colorDivs.length);
  
  // data属性を持つ要素
  const dataElements = await page.locator('[data-color], [data-name], [data-id]').all();
  console.log('Data attribute elements:', dataElements.length);
  
  // 商品画像っぽいもの
  const productImgs = await page.locator('.item img, .product img, .series img, [class*=item] img').all();
  console.log('Product-like images:', productImgs.length);
  
  // CDN画像
  const cdnImgs = await page.locator('img[src*=cdn], img[src*=files]').all();
  console.log('CDN images:', cdnImgs.length);
  for (let i = 0; i < Math.min(10, cdnImgs.length); i++) {
    const src = await cdnImgs[i].getAttribute('src');
    console.log('  -', src);
  }
  
  await browser.close();
}

checkPage(process.argv[2] || 'https://www.bluebluefishing.com/item/series/001001/001001002/');
