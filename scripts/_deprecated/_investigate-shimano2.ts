import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // Go to a sub-category page (seabass minnow)
  console.log('=== SUB-CATEGORY PAGE: seabass/minnow ===');
  await page.goto('https://fish.shimano.com/ja-JP/product/lure/seabass/minnow.html', {
    timeout: 30000,
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);
  console.log('Title:', await page.title());

  // Get product links from this page
  const productData = await page.evaluate(() => {
    const results: { name: string; href: string; img: string; price: string }[] = [];

    // Look for product cards/items
    const items = document.querySelectorAll('[class*="product"], article, .item, [class*="card"]');
    items.forEach(item => {
      const link = item.querySelector('a[href]') as HTMLAnchorElement | null;
      const img = item.querySelector('img') as HTMLImageElement | null;
      const nameEl = item.querySelector('[class*="name"], [class*="title"], h2, h3, h4');
      const priceEl = item.querySelector('[class*="price"]');

      if (link && link.href.includes('/product/lure/')) {
        results.push({
          name: nameEl?.textContent?.trim() || link.textContent?.trim() || '',
          href: link.href,
          img: img?.src || '',
          price: priceEl?.textContent?.trim() || '',
        });
      }
    });

    // Also try direct links
    if (results.length === 0) {
      document.querySelectorAll('a[href*="/product/lure/"]').forEach(a => {
        const el = a as HTMLAnchorElement;
        const text = el.textContent?.trim() || '';
        // Filter out navigation links
        if (text.length > 2 && text.length < 100 && !el.href.endsWith('.html')) {
          results.push({
            name: text,
            href: el.href,
            img: '',
            price: '',
          });
        }
      });
    }

    return results;
  });
  console.log(`Found ${productData.length} products`);
  productData.slice(0, 10).forEach(p => {
    console.log(`  ${p.name} -> ${p.href}`);
    if (p.img) console.log(`    img: ${p.img}`);
  });

  // Get ALL links on the page
  const allLinks = await page.evaluate(() => {
    const links: { text: string; href: string }[] = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const el = a as HTMLAnchorElement;
      const text = el.textContent?.trim().substring(0, 80) || '';
      if (el.href.includes('/product/lure/') && text.length > 0) {
        links.push({ text, href: el.href });
      }
    });
    return [...new Map(links.map(l => [l.href, l])).values()];
  });
  console.log('\nAll lure links on page:');
  allLinks.forEach(l => console.log(`  ${l.text} -> ${l.href}`));

  // Get body text to understand page structure
  const bodyText = await page.evaluate(() => {
    return document.body?.innerText?.substring(0, 2000) || '';
  });
  console.log('\nBody text:\n', bodyText);

  // Get page HTML structure for product sections
  const htmlSnippet = await page.evaluate(() => {
    const main = document.querySelector('main, [role="main"], .content, #content, .products');
    if (main) return main.innerHTML.substring(0, 3000);
    // fallback: look for product-related sections
    const sections = document.querySelectorAll('section');
    let html = '';
    sections.forEach(s => {
      if (s.innerHTML.includes('product') || s.innerHTML.includes('lure')) {
        html += s.innerHTML.substring(0, 1500) + '\n---\n';
      }
    });
    return html.substring(0, 5000) || document.body.innerHTML.substring(0, 3000);
  });
  console.log('\nHTML structure:\n', htmlSnippet);

  await browser.close();
}
main().catch(console.error);
