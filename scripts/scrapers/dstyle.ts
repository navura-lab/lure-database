// scripts/scrapers/dstyle.ts
// DSTYLE product page scraper
// Handles lure products from dstyle-lure.co.jp/products/{slug}/
//
// Site: WordPress (custom theme) with custom post type "products".
// WP REST API disabled. WP root at /dstylesys/.
// All products listed at /products/ page.
// Title: h2.tit-01
// Colors: div.img-color > h4.tit-color (name) + a.productspop[href] (full-size image)
// Price: div.products-price containing ￥ (groups of 4: label, yen, label, tax)
// Specs: table.table-products-about (th=key, td=value, 2 pairs per row)
// Main image: div.products-main-img img (data-src || src)
// Description: p.catch-products + sibling <p> text
// Lazy loading: data-src first, src fallback
// All products are bass lures — target fish = ブラックバス.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name / URL slug
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/スピナーベイト|spiker|spinner/i, 'スピナーベイト'],
  [/バズベイト|buzzbait/i, 'バズベイト'],
  [/チャターベイト|chatter/i, 'チャターベイト'],
  [/クランク|crank/i, 'クランクベイト'],
  [/ミノー|minnow/i, 'ルアー'],
  [/バイブ|vibe|vibra/i, 'バイブレーション'],
  [/ジグ|jig/i, 'ラバージグ'],
  [/フロッグ|frog/i, 'フロッグ'],
  [/スイムベイト|swimbait/i, 'ルアー'],
  [/ブレード|blade/i, 'ルアー'],
  [/ポッパー|popper/i, 'ルアー'],
  [/トップウォーター|topwater/i, 'ルアー'],
  [/プロップ|prop/i, 'ルアー'],
  [/ペンシル|pencil/i, 'ルアー'],
];

function detectType(name: string, slug: string): string {
  // Check name first
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  // Check slug
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(slug)) return NAME_TYPE_MAP[i][1];
  }
  // Default: soft lure = ワーム
  return 'ワーム';
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [dstyle] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeDstylePage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    // Navigate with retry
    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log('Navigating to ' + url + ' (attempt ' + attempt + '/' + maxRetries + ')');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      } catch (navErr: any) {
        if (attempt === maxRetries) throw navErr;
        log('Navigation failed, retrying in 3s...');
        await page.waitForTimeout(3000);
      }
    }

    await page.waitForTimeout(2000);

    // ---------- Extract all data from page ----------
    var data = await page.evaluate(function() {
      // Title from h2.tit-01
      var h2 = document.querySelector('h2.tit-01');
      var title = h2 ? (h2.textContent || '').trim() : '';

      // Description: catchphrase + body paragraphs
      var desc = '';
      var catchEl = document.querySelector('p.catch-products');
      if (catchEl) {
        desc = (catchEl.textContent || '').trim();
      }
      // Add body paragraphs from products-about
      var aboutDiv = document.querySelector('div.products-about div.block01');
      if (aboutDiv) {
        var pEls = aboutDiv.querySelectorAll('p');
        for (var pi = 0; pi < pEls.length; pi++) {
          if (!pEls[pi].classList.contains('catch-products')) {
            var pText = (pEls[pi].textContent || '').trim();
            if (pText && pText.length > 10) {
              desc += '\n' + pText;
            }
          }
        }
      }
      desc = desc.trim().substring(0, 500);

      // Main product image
      var mainImage = '';
      var mainImgEl = document.querySelector('div.products-main-img img');
      if (mainImgEl) {
        mainImage = mainImgEl.getAttribute('data-src') || mainImgEl.getAttribute('src') || '';
      }
      if (mainImage && !mainImage.startsWith('http')) {
        mainImage = 'https://dstyle-lure.co.jp' + mainImage;
      }

      // Spec table: table.table-products-about
      var specs: Record<string, string> = {};
      var specTable = document.querySelector('table.table-products-about');
      if (specTable) {
        var rows = specTable.querySelectorAll('tr');
        for (var ri = 0; ri < rows.length; ri++) {
          var cells = rows[ri].querySelectorAll('th, td');
          // 2 key-value pairs per row: th, td, th, td
          for (var ci = 0; ci < cells.length - 1; ci += 2) {
            var key = (cells[ci].textContent || '').trim();
            var val = (cells[ci + 1].textContent || '').trim();
            if (key) specs[key] = val;
          }
        }
      }

      // Price: find div.products-price containing ￥
      var priceValue = 0;
      var priceDivs = document.querySelectorAll('div.products-price');
      for (var pri = 0; pri < priceDivs.length; pri++) {
        var priceText = (priceDivs[pri].textContent || '').trim();
        var yenMatch = priceText.match(/[￥¥][\s]*([\d,]+)/);
        if (yenMatch && !priceValue) {
          priceValue = parseInt(yenMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Colors: div.img-color
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorSeen = new Set();
      var colorDivs = document.querySelectorAll('div.img-color');
      for (var ci = 0; ci < colorDivs.length; ci++) {
        var colorDiv = colorDivs[ci];

        // Color name from h4.tit-color
        var nameEl = colorDiv.querySelector('h4.tit-color');
        var colorName = nameEl ? (nameEl.textContent || '').trim() : '';
        if (!colorName) continue;

        // Color image from a.productspop href (full-size) or img.img-color-img
        var imgUrl = '';
        var linkEl = colorDiv.querySelector('a.productspop');
        if (linkEl) {
          imgUrl = linkEl.getAttribute('href') || '';
        }
        if (!imgUrl) {
          var thumbEl = colorDiv.querySelector('img.img-color-img');
          if (thumbEl) {
            imgUrl = thumbEl.getAttribute('data-src') || thumbEl.getAttribute('src') || '';
          }
        }
        if (imgUrl && !imgUrl.startsWith('http')) {
          imgUrl = 'https://dstyle-lure.co.jp' + imgUrl;
        }

        if (!colorSeen.has(colorName)) {
          colorSeen.add(colorName);
          colors.push({ name: colorName, imageUrl: imgUrl });
        }
      }

      return {
        title: title,
        description: desc,
        mainImage: mainImage,
        specs: specs,
        price: priceValue,
        colors: colors,
      };
    });

    var fullName = (data.title || '').trim();
    log('Product: ' + fullName);
    log('Main image: ' + data.mainImage);
    log('Colors: ' + data.colors.length);
    log('Price: ' + data.price);
    log('Specs: ' + JSON.stringify(data.specs));

    // Generate slug from URL path
    var urlPath = new URL(url).pathname;
    var slugMatch = urlPath.match(/\/products\/([^\/]+)/);
    var slug = slugMatch ? slugMatch[1] : '';
    if (!slug) {
      slug = fullName.toLowerCase()
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'dstyle-product';
    }

    // Extract display name (clean up)
    var displayName = fullName;

    // Detect type
    var lureType = detectType(fullName, slug);

    // Extract length from specs
    var lengthMm: number | null = null;
    var lengthSpec = data.specs['Length'] || data.specs['length'] || '';
    if (lengthSpec) {
      var inchMatch = lengthSpec.match(/([\d.]+)\s*inch/i);
      if (inchMatch) {
        lengthMm = Math.round(parseFloat(inchMatch[1]) * 25.4);
      }
      var mmMatch = lengthSpec.match(/([\d.]+)\s*mm/i);
      if (mmMatch) {
        lengthMm = Math.round(parseFloat(mmMatch[1]));
      }
    }

    // Extract weights from specs
    var weights: number[] = [];
    var weightSpec = data.specs['Weight'] || data.specs['weight'] || '';
    if (weightSpec) {
      // Match various formats: "2.2g", "1/4oz", "1.8g/2.3g/2.8g"
      var gMatches = weightSpec.match(/[\d.]+\s*g/gi);
      if (gMatches) {
        for (var wi = 0; wi < gMatches.length; wi++) {
          var gVal = parseFloat(gMatches[wi]);
          if (gVal > 0) weights.push(gVal);
        }
      }
      var ozMatches = weightSpec.match(/(\d+\/\d+)\s*oz/gi);
      if (ozMatches) {
        for (var oi = 0; oi < ozMatches.length; oi++) {
          var ozParts = ozMatches[oi].match(/(\d+)\/(\d+)/);
          if (ozParts) {
            var ozVal = parseInt(ozParts[1], 10) / parseInt(ozParts[2], 10);
            weights.push(Math.round(ozVal * 28.3495 * 10) / 10);
          }
        }
      }
      // Also try decimal oz: "0.9oz"
      var decOzMatches = weightSpec.match(/([\d.]+)\s*oz/gi);
      if (decOzMatches && weights.length === 0) {
        for (var doi = 0; doi < decOzMatches.length; doi++) {
          var doVal = parseFloat(decOzMatches[doi]);
          if (doVal > 0) weights.push(Math.round(doVal * 28.3495 * 10) / 10);
        }
      }
    }

    var result: ScrapedLure = {
      name: displayName,
      name_kana: '',
      slug: slug,
      manufacturer: 'DSTYLE',
      manufacturer_slug: 'dstyle',
      type: lureType,
      target_fish: ['ブラックバス'],
      description: data.description,
      price: data.price,
      colors: data.colors,
      weights: weights,
      length: lengthMm,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log('Done: ' + result.name + ' | type=' + result.type + ' | colors=' + result.colors.length + ' | price=' + result.price + ' | slug=' + result.slug + ' | length=' + result.length);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
