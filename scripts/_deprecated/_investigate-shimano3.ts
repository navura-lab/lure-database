import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // Navigate to a product detail page
  const productUrl = 'https://fish.shimano.com/ja-JP/product/lure/seabass/minnow/a155f00000c5crvqaf.html';
  console.log('=== PRODUCT DETAIL PAGE ===');
  console.log('URL:', productUrl);
  await page.goto(productUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('Title:', await page.title());

  const detail = await page.evaluate(() => {
    const info: Record<string, string> = {};

    // Product name - try various selectors
    const selectors = ['h1', '.product-name', '.product-title', '[class*="productName"]', '[class*="product-name"]', '[class*="pdp"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim() || '';
        if (text.length > 0 && text.length < 200) {
          info[`name(${sel})`] = text;
        }
      }
    }

    // All h1/h2/h3 on the page
    document.querySelectorAll('h1, h2, h3').forEach((h, i) => {
      const text = h.textContent?.trim() || '';
      if (text.length > 0 && text.length < 200) {
        info[`heading_${i}_${h.tagName}`] = text;
      }
    });

    // Price
    document.querySelectorAll('[class*="price"], [class*="Price"]').forEach((el, i) => {
      const text = el.textContent?.trim() || '';
      if (text.length > 0) info[`price_${i}`] = text;
    });

    // Description text
    document.querySelectorAll('[class*="description"], [class*="desc"], [class*="copy"], [class*="about"], [class*="text"]').forEach((el, i) => {
      const text = el.textContent?.trim() || '';
      if (text.length > 20 && text.length < 500) {
        info[`desc_${i}`] = text;
      }
    });

    // Images
    const productImages: string[] = [];
    document.querySelectorAll('img[src]').forEach(img => {
      const src = (img as HTMLImageElement).src;
      if (src.includes('dam/') && (src.includes('Product') || src.includes('product') || src.includes('PRD'))) {
        productImages.push(src);
      }
    });
    info['product_images'] = productImages.join('\n  ');

    // Color swatches
    const colorElements: { name: string; img: string }[] = [];
    document.querySelectorAll('[class*="color"], [class*="Color"], [class*="swatch"], [class*="variation"], [class*="thumbnail"]').forEach(el => {
      const name = el.getAttribute('title') || el.getAttribute('alt') || el.textContent?.trim() || '';
      const img = el.querySelector('img')?.src || (el as HTMLImageElement).src || '';
      if (name || img) {
        colorElements.push({ name: name.substring(0, 50), img: img.substring(0, 100) });
      }
    });
    info['colors'] = JSON.stringify(colorElements.slice(0, 10));

    // Spec tables
    const tables = document.querySelectorAll('table');
    info['table_count'] = String(tables.length);
    tables.forEach((table, ti) => {
      const headers: string[] = [];
      table.querySelectorAll('th').forEach(th => headers.push(th.textContent?.trim() || ''));
      info[`table_${ti}_headers`] = headers.join(' | ');

      const rows: string[] = [];
      table.querySelectorAll('tbody tr').forEach((tr, ri) => {
        if (ri < 3) {
          const cells: string[] = [];
          tr.querySelectorAll('td, th').forEach(td => cells.push(td.textContent?.trim() || ''));
          rows.push(cells.join(' | '));
        }
      });
      info[`table_${ti}_rows`] = rows.join('\n    ');
    });

    // All relevant CSS classes
    const classes = new Set<string>();
    document.querySelectorAll('[class]').forEach(el => {
      el.classList.forEach(c => {
        if (c.includes('product') || c.includes('spec') || c.includes('color') || c.includes('image') ||
            c.includes('detail') || c.includes('lure') || c.includes('price') || c.includes('name') ||
            c.includes('pdp') || c.includes('gallery') || c.includes('thumb') || c.includes('slide') ||
            c.includes('variation') || c.includes('swatch') || c.includes('tab') || c.includes('desc')) {
          classes.add(c);
        }
      });
    });
    info['css_classes'] = [...classes].sort().join(', ');

    return info;
  });

  console.log('\nDetail page info:');
  for (const [k, v] of Object.entries(detail)) {
    console.log(`  ${k}: ${v}`);
  }

  // Get body text
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 4000) || '');
  console.log('\n=== BODY TEXT (first 4000) ===\n', bodyText);

  // Now try a second product (a jig) for comparison
  console.log('\n\n=== SECOND PRODUCT (JIG) ===');
  await page.goto('https://fish.shimano.com/ja-JP/product/lure/offshorejigging/jig.html', {
    timeout: 30000, waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  // Get first jig product link
  const jigLink = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/product/lure/offshorejigging/jig/"]');
    return links.length > 0 ? (links[0] as HTMLAnchorElement).href : null;
  });

  if (jigLink) {
    console.log('Navigating to jig:', jigLink);
    await page.goto(jigLink, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const jigText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');
    console.log('\nJig body text:\n', jigText);
  }

  await browser.close();
}
main().catch(console.error);
