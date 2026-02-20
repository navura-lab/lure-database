import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // Navigate to lure listing page
  await page.goto('https://fish.shimano.com/ja-JP/product/lure.html', { timeout: 30000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  console.log('=== LURE LISTING PAGE ===');
  console.log('Title:', await page.title());

  // Get all links on the page
  const allLinks = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href]');
    const links: { text: string; href: string }[] = [];
    anchors.forEach(a => {
      const el = a as HTMLAnchorElement;
      const text = el.textContent?.trim() || '';
      if (text.length > 0 && text.length < 100) {
        links.push({ text, href: el.href });
      }
    });
    return links;
  });

  // Filter for product-related links
  const productLinks = allLinks.filter(l =>
    l.href.includes('/product/') && l.href !== page.url()
  );
  console.log('\nProduct-related links (unique):');
  const uniqueProductLinks = [...new Map(productLinks.map(l => [l.href, l])).values()];
  uniqueProductLinks.slice(0, 30).forEach(l => console.log(`  ${l.text} -> ${l.href}`));
  console.log(`  ... total: ${uniqueProductLinks.length}`);

  // Check page structure
  const structure = await page.evaluate(() => {
    const result: Record<string, number> = {};
    const selectors = [
      '.product-card', '.product-item', '.product-list', '.item-list',
      '[class*="product"]', '[class*="item"]', '[class*="card"]',
      '.category', '[class*="category"]', '[class*="lure"]',
      'article', 'section', '.list', 'ul.product', 'ul li a img',
    ];
    for (const sel of selectors) {
      try {
        const count = document.querySelectorAll(sel).length;
        if (count > 0) result[sel] = count;
      } catch {}
    }
    return result;
  });
  console.log('\nPage structure (elements found):', JSON.stringify(structure, null, 2));

  // Get body text
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');
  console.log('\nBody text (first 3000 chars):\n', bodyText);

  // Now let's look at a sub-category if they exist
  const lureSubLinks = allLinks.filter(l =>
    l.href.includes('lure') && l.href !== page.url() && l.href.includes('product')
  );
  console.log('\nLure sub-category links:');
  lureSubLinks.forEach(l => console.log(`  ${l.text} -> ${l.href}`));

  // Navigate to first product to study detail page structure
  if (uniqueProductLinks.length > 0) {
    const firstProduct = uniqueProductLinks[0];
    console.log(`\n=== NAVIGATING TO FIRST PRODUCT: ${firstProduct.text} ===`);
    console.log(`URL: ${firstProduct.href}`);
    await page.goto(firstProduct.href, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    console.log('Title:', await page.title());

    // Study detail page
    const detail = await page.evaluate(() => {
      const info: Record<string, string> = {};

      // Product name
      const h1 = document.querySelector('h1');
      if (h1) info['h1'] = h1.textContent?.trim() || '';

      // Try various selectors for product info
      const nameEl = document.querySelector('.product-name, .product-title, [class*="productName"], [class*="product-name"]');
      if (nameEl) info['product_name'] = nameEl.textContent?.trim() || '';

      // Price
      const priceEl = document.querySelector('.price, [class*="price"], [class*="Price"]');
      if (priceEl) info['price'] = priceEl.textContent?.trim() || '';

      // Description
      const descEl = document.querySelector('.description, [class*="description"], [class*="desc"], .product-detail');
      if (descEl) info['description'] = (descEl.textContent?.trim() || '').substring(0, 300);

      // Images
      const images = document.querySelectorAll('img[src]');
      const imgSrcs: string[] = [];
      images.forEach(img => {
        const src = (img as HTMLImageElement).src;
        if (src.includes('product') || src.includes('lure') || src.includes('shimano')) {
          imgSrcs.push(src);
        }
      });
      info['product_images'] = imgSrcs.slice(0, 5).join(' | ');

      // Spec table
      const tables = document.querySelectorAll('table');
      info['table_count'] = String(tables.length);
      if (tables.length > 0) {
        const firstTable = tables[0];
        const headers: string[] = [];
        firstTable.querySelectorAll('th').forEach(th => headers.push(th.textContent?.trim() || ''));
        info['first_table_headers'] = headers.join(' | ');
        const firstRow: string[] = [];
        const tds = firstTable.querySelectorAll('tbody tr:first-child td, tr:nth-child(2) td');
        tds.forEach(td => firstRow.push(td.textContent?.trim() || ''));
        info['first_table_row'] = firstRow.join(' | ');
      }

      // Color swatches
      const colorEls = document.querySelectorAll('[class*="color"], [class*="Color"], .swatch, [class*="variation"]');
      info['color_elements'] = String(colorEls.length);

      // Body text
      info['body_text_preview'] = (document.body?.innerText?.substring(0, 2000) || '');

      return info;
    });
    console.log('\nDetail page info:');
    for (const [k, v] of Object.entries(detail)) {
      if (k === 'body_text_preview') {
        console.log(`\n${k}:\n${v}`);
      } else {
        console.log(`  ${k}: ${v}`);
      }
    }

    // Get page HTML classes for structure analysis
    const classes = await page.evaluate(() => {
      const allClasses = new Set<string>();
      document.querySelectorAll('[class]').forEach(el => {
        el.classList.forEach(c => {
          if (c.includes('product') || c.includes('spec') || c.includes('color') || c.includes('image') || c.includes('detail') || c.includes('lure') || c.includes('price') || c.includes('name')) {
            allClasses.add(c);
          }
        });
      });
      return [...allClasses].sort();
    });
    console.log('\nRelevant CSS classes:', classes);
  }

  await browser.close();
}
main().catch(console.error);
