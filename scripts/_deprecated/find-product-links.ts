import { chromium } from 'playwright';

async function findLinks(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // /item/detail/ へのリンクを探す
  const detailLinks = await page.locator('a[href*="/item/detail/"]').all();
  console.log('Detail page links:', detailLinks.length);
  
  const hrefs = new Set<string>();
  for (const link of detailLinks) {
    const href = await link.getAttribute('href');
    if (href) hrefs.add(href);
  }
  
  console.log('Unique detail URLs:');
  for (const href of hrefs) {
    console.log('  ', href);
  }
  
  await browser.close();
}

findLinks(process.argv[2] || 'https://www.bluebluefishing.com/item/series/001001/001001002/');
