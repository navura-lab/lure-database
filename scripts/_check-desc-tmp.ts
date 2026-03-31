import 'dotenv/config';
import { chromium } from 'playwright';

// DUELページのHTMLをダンプして説明文エリアを確認
async function main() {
  const urls = [
    'https://www.duel.co.jp/products/detail.php?pid=229',   // sliderubber (53文字)
    'https://www.duel.co.jp/products/detail.php?pid=1654',  // sonicboom-sb-wake-165f (54文字)
  ];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  for (const url of urls) {
    console.log(`\n=== ${url} ===`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    const result = await page.evaluate(() => {
      // 候補セレクタを全て試す
      const candidates = [
        '.p-product-text', '.p-detail-text', '.product-description', '.l-product-text',
        '.p-concept', '.p-concept-text', '.p-item-text', '.p-lure-text',
        '[class*="text"]', '[class*="description"]', '[class*="concept"]'
      ];
      const found: any[] = [];
      for (const s of candidates) {
        const els = document.querySelectorAll(s);
        els.forEach(el => {
          const t = (el as HTMLElement).textContent?.trim() ?? '';
          if (t.length > 20) {
            found.push({ selector: s, text: t.substring(0, 200) });
          }
        });
      }
      // main内の全p タグ
      const mainParas = document.querySelectorAll('main p, .l-main p, .p-product p, article p');
      const paras: string[] = [];
      mainParas.forEach(p => {
        const t = (p as HTMLElement).textContent?.trim() ?? '';
        if (t.length > 30) paras.push(t.substring(0, 150));
      });
      return { found, paras };
    });

    console.log('候補セレクタ:');
    for (const f of result.found) {
      console.log(`  [${f.selector}] ${f.text.substring(0, 120)}`);
    }
    console.log('main p タグ:');
    for (const p of result.paras.slice(0, 5)) {
      console.log(`  ${p}`);
    }
  }

  await browser.close();
}

main().catch(console.error);
