/**
 * BlueBlueFishingの商品ページHTML構造を解析するスクリプト
 * Usage: npx tsx scripts/analyze-bb-page.ts <url>
 */
import { chromium } from 'playwright';

async function analyzePage(url: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('[Navigate]', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // 1. ページタイトル・h1
  const title = await page.title();
  console.log('\n=== TITLE ===');
  console.log(title);

  const h1 = await page.locator('h1').allTextContents();
  console.log('\n=== H1 TAGS ===');
  console.log(h1);

  // 2. itemDet_ 系クラスの要素
  console.log('\n=== itemDet_ CLASSES ===');
  const itemDetClasses = await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="itemDet_"]');
    return Array.from(els).map(el => ({
      tag: el.tagName,
      className: el.className,
      childCount: el.children.length,
      textSnippet: el.textContent?.slice(0, 100)?.trim(),
    }));
  });
  console.log(JSON.stringify(itemDetClasses, null, 2));

  // 3. smallList内の画像とテキスト
  console.log('\n=== itemDet_smallList ITEMS ===');
  const smallListItems = await page.evaluate(() => {
    const list = document.querySelector('.itemDet_smallList');
    if (!list) return 'NOT FOUND';
    const items = list.querySelectorAll('li');
    return Array.from(items).map(li => ({
      text: li.textContent?.trim().slice(0, 80),
      imgs: Array.from(li.querySelectorAll('img')).map(img => ({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
      })),
    }));
  });
  console.log(JSON.stringify(smallListItems, null, 2));

  // 4. bigList内の画像
  console.log('\n=== itemDet_bigList ITEMS ===');
  const bigListItems = await page.evaluate(() => {
    const list = document.querySelector('.itemDet_bigList');
    if (!list) return 'NOT FOUND';
    const items = list.querySelectorAll('li');
    return Array.from(items).map(li => ({
      imgs: Array.from(li.querySelectorAll('img')).map(img => ({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
      })),
    }));
  });
  console.log(JSON.stringify(bigListItems, null, 2));

  // 5. 価格情報
  console.log('\n=== PRICE ===');
  const priceText = await page.evaluate(() => {
    const body = document.body.innerText;
    const match = body.match(/希望小売価格[\s\S]*?（税込[\s\S]*?円）/);
    return match ? match[0] : 'NOT FOUND';
  });
  console.log(priceText);

  // 6. 仕様セクション
  console.log('\n=== SPECS ===');
  const specs = await page.evaluate(() => {
    const body = document.body.innerText;
    // Weight, 全長 等のパターン
    const lines = body.split('\n').filter(l =>
      /Weight|全長|重さ|サイズ|フック|リング|Type/i.test(l)
    );
    return lines.map(l => l.trim()).filter(Boolean);
  });
  console.log(specs);

  // 7. COLORCHART セクション
  console.log('\n=== COLORCHART SECTION ===');
  const colorChart = await page.evaluate(() => {
    const body = document.body.innerText;
    const idx = body.indexOf('COLORCHART');
    if (idx === -1) return 'NOT FOUND';
    return body.slice(idx, idx + 500);
  });
  console.log(colorChart);

  // 8. 商品名候補（パンくず最後の要素）
  console.log('\n=== BREADCRUMB ===');
  const breadcrumb = await page.evaluate(() => {
    const crumbs = document.querySelectorAll('.breadcrumb li, .pankuzu li, nav li, .topicPath li');
    return Array.from(crumbs).map(el => el.textContent?.trim());
  });
  console.log(breadcrumb);

  // 9. 商品名 - ロゴ画像直後のテキスト
  console.log('\n=== PRODUCT NAME CANDIDATES ===');
  const nameCandidate = await page.evaluate(() => {
    // パンくず最後
    const allLi = document.querySelectorAll('li');
    const lastLi = Array.from(allLi).pop();
    // title tagから
    const title = document.title;
    return { lastLi: lastLi?.textContent?.trim(), title };
  });
  console.log(nameCandidate);

  // 10. ページ全体のテキスト構造（セクション見出し）
  console.log('\n=== SECTION HEADINGS ===');
  const headings = await page.evaluate(() => {
    const els = document.querySelectorAll('h1, h2, h3, h4, h5, .section-title, [class*="title"], [class*="heading"]');
    return Array.from(els).map(el => ({
      tag: el.tagName,
      class: el.className,
      text: el.textContent?.trim().slice(0, 80),
    }));
  });
  console.log(JSON.stringify(headings, null, 2));

  await browser.close();
}

const url = process.argv[2] || 'https://www.bluebluefishing.com/item/detail/004265/';
analyzePage(url).catch(console.error);
