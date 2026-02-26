// scripts/scrapers/fisharrow.ts
// Fish Arrow (フィッシュアロー) product page scraper
// Handles lure products from fisharrow.co.jp/product/{slug}/
//
// Site: WordPress 6.x + custom theme "fisharrow", server-side rendered HTML.
// No lazy loading — images use plain src attributes.
// Spec table uses DIV-based layout (NOT <table>/<tr>/<td>).
// Selectors: BEM-style .product-single__xxx classes.
// data-type attribute on spec div: "soft-lure" | "hard-lure"
// Price: ¥XXX format (no commas for thousands), tax-included.
// target_fish: Bass products → ブラックバス, Salt products → varies.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from data-type + category badge + product name
// ---------------------------------------------------------------------------

var DATA_TYPE_MAP: Record<string, string> = {
  'soft-lure': 'ワーム',
  'hard-lure': 'ルアー',
};

var NAME_TYPE_KEYWORDS: [RegExp, string][] = [
  [/shad/i, 'シャッド'],
  [/minnow/i, 'ミノー'],
  [/vibration/i, 'バイブレーション'],
  [/jig|ジグ/i, 'メタルジグ'],
  [/spin/i, 'ワーム'],
  [/worm/i, 'ワーム'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [fisharrow] ${msg}`);
}

function extractSlug(url: string): string {
  var m = url.match(/\/product\/([^\/]+)\/?/);
  if (m) return decodeURIComponent(m[1]).replace(/\u3000/g, '-').replace(/\s+/g, '-').toLowerCase();
  return url.replace(/\/$/, '').split('/').pop() || '';
}

function detectType(dataType: string, name: string): string {
  // 1. Check data-type attribute
  if (dataType && DATA_TYPE_MAP[dataType]) {
    // For hard-lure, try to refine from name
    if (dataType === 'hard-lure') {
      for (var [re, type] of NAME_TYPE_KEYWORDS) {
        if (re.test(name)) return type;
      }
      return 'ルアー';
    }
    return DATA_TYPE_MAP[dataType];
  }

  // 2. Check name keywords
  for (var [re2, type2] of NAME_TYPE_KEYWORDS) {
    if (re2.test(name)) return type2;
  }

  return 'ルアー';
}

/**
 * Parse price from spec cell text.
 * Format: "¥850", "¥2650", "¥44000" (no commas)
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  var m = text.match(/[￥¥]([0-9,]+)/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  // Try bare number
  var bare = text.match(/(\d+)/);
  if (bare) return parseInt(bare[1], 10);
  return 0;
}

/**
 * Parse weight from spec cell text.
 * Format: "57g", "70g", "77g"
 */
function parseWeight(text: string): number | null {
  if (!text) return null;
  var m = text.match(/(\d+(?:\.\d+)?)\s*g/i);
  if (m) return parseFloat(m[1]);
  return null;
}

/**
 * Parse length from spec cell text.
 * Format: "168mm", "210mm"
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  var mmMatch = text.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (mmMatch) return parseFloat(mmMatch[1]);
  var inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:inch|インチ)/i);
  if (inchMatch) return Math.round(parseFloat(inchMatch[1]) * 25.4 * 10) / 10;
  return null;
}

/**
 * Detect target fish from category badge text.
 */
function detectTargetFish(category: string): string[] {
  var cat = category.toLowerCase();
  if (cat.includes('bass') && cat.includes('salt')) return ['ブラックバス', 'シーバス'];
  if (cat.includes('bass')) return ['ブラックバス'];
  if (cat.includes('salt')) return ['シーバス', 'ヒラメ', 'マゴチ'];
  return ['ブラックバス'];
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeFisharrowPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    // Retry navigation with backoff
    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log(`Navigating to ${url} (attempt ${attempt}/${maxRetries})`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      } catch (navErr: any) {
        if (attempt === maxRetries) throw navErr;
        var backoff = attempt * 3000;
        log(`Navigation failed (attempt ${attempt}): ${navErr.message?.substring(0, 80)} — retrying in ${backoff}ms`);
        await new Promise(function (r) { setTimeout(r, backoff); });
      }
    }

    var slug = extractSlug(url);
    log(`Slug: ${slug}`);

    // ---------- Extract all data from page ----------
    var data = await page.evaluate(function () {
      // Category badge
      var badgeEl = document.querySelector('span.product-single__category');
      var category = badgeEl ? badgeEl.textContent?.trim() || '' : '';

      // Title
      var titleEl = document.querySelector('h2.product-single__title');
      var title = titleEl ? titleEl.textContent?.trim() || '' : '';

      // Kana
      var kanaEl = document.querySelector('p.product-single__kana');
      var kana = kanaEl ? kanaEl.textContent?.trim() || '' : '';

      // Main product image
      var thumbImg = document.querySelector('div.product-single__thumbnail img');
      var mainImage = thumbImg ? thumbImg.getAttribute('src') || '' : '';

      // Description
      var descEl = document.querySelector('div.product-single__sec-text');
      var description = descEl ? descEl.textContent?.trim() || '' : '';

      // Color variations
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorItems = document.querySelectorAll('li.product-single__color-list-item');
      for (var i = 0; i < colorItems.length; i++) {
        var imgEl = colorItems[i].querySelector('div.product-single__item img');
        var nameEl = colorItems[i].querySelector('div.product-single__item-name');

        var colorName = '';
        if (nameEl) {
          colorName = nameEl.textContent?.trim() || '';
        }
        if (!colorName && imgEl) {
          colorName = imgEl.getAttribute('alt') || '';
        }
        if (!colorName) continue;

        var colorImg = imgEl ? imgEl.getAttribute('src') || '' : '';

        colors.push({ name: colorName.trim(), imageUrl: colorImg });
      }

      // Spec table (DIV-based, NOT <table>)
      var specTableEl = document.querySelector('div.product-single__table');
      var dataType = specTableEl ? specTableEl.getAttribute('data-type') || '' : '';

      // Parse header row
      var headerRow = specTableEl ? specTableEl.querySelector('div.product-single__row--head') : null;
      var headers: string[] = [];
      if (headerRow) {
        var headerCells = headerRow.querySelectorAll('div.product-single__cell');
        for (var h = 0; h < headerCells.length; h++) {
          headers.push(headerCells[h].textContent?.trim() || '');
        }
      }

      // Parse data rows
      var specRows: Array<Record<string, string>> = [];
      if (specTableEl) {
        var allRows = specTableEl.querySelectorAll('div.product-single__row:not(.product-single__row--head)');
        for (var r = 0; r < allRows.length; r++) {
          var cells = allRows[r].querySelectorAll('div.product-single__cell');
          var row: Record<string, string> = {};
          for (var c = 0; c < cells.length; c++) {
            var headerKey = c < headers.length ? headers[c] : 'col' + c;
            row[headerKey] = cells[c].textContent?.trim() || '';
          }
          specRows.push(row);
        }
      }

      return {
        category: category,
        title: title,
        kana: kana,
        mainImage: mainImage,
        description: description,
        colors: colors,
        dataType: dataType,
        headers: headers,
        specRows: specRows,
      };
    });

    log(`Product: ${data.title}`);
    log(`Kana: ${data.kana}`);
    log(`Category: ${data.category}`);
    log(`Data-type: ${data.dataType}`);
    log(`Main image: ${data.mainImage}`);
    log(`Colors: ${data.colors.length}`);
    log(`Spec headers: ${data.headers.join(', ')}`);
    log(`Spec rows: ${data.specRows.length}`);

    // ---------- Post-process extracted data ----------

    var type = detectType(data.dataType, data.title);
    log(`Type: ${type}`);

    var targetFish = detectTargetFish(data.category);
    log(`Target fish: ${targetFish.join(', ')}`);

    // Extract price, weight, length from spec rows
    var price = 0;
    var weights: number[] = [];
    var length: number | null = null;

    // Find price column (定価（税込）)
    var priceHeader = data.headers.find(function (h) { return h.includes('定価') || h.includes('価格') || h.includes('Price'); }) || '';
    var weightHeader = data.headers.find(function (h) { return h === 'Weight' || h === 'weight' || h === '重量'; }) || '';
    var lengthHeader = data.headers.find(function (h) { return h === 'Length' || h === 'length' || h === '全長' || h === 'サイズ'; }) || '';

    // Collect unique weights from spec rows
    var weightSet = new Set<number>();
    for (var row of data.specRows) {
      // Price: use first non-zero price found
      if (priceHeader && row[priceHeader] && !price) {
        price = parsePrice(row[priceHeader]);
      }

      // Weight
      if (weightHeader && row[weightHeader]) {
        var w = parseWeight(row[weightHeader]);
        if (w !== null && w > 0) weightSet.add(w);
      }

      // Length
      if (lengthHeader && row[lengthHeader] && length === null) {
        length = parseLength(row[lengthHeader]);
      }
    }
    weights = Array.from(weightSet).sort(function (a, b) { return a - b; });

    // If no price from spec rows, try first row's price-like column
    if (!price && data.specRows.length > 0) {
      for (var key of Object.keys(data.specRows[0])) {
        if (key.includes('定価') || key.includes('Price')) {
          price = parsePrice(data.specRows[0][key]);
          if (price) break;
        }
      }
    }

    log(`Price: ${price}`);
    log(`Weights: ${JSON.stringify(weights)}`);
    log(`Length: ${length}mm`);

    var result: ScrapedLure = {
      name: data.title,
      name_kana: data.kana,
      slug: slug,
      manufacturer: 'Fish Arrow',
      manufacturer_slug: 'fisharrow',
      type: type,
      target_fish: targetFish,
      description: data.description.substring(0, 500),
      price: price,
      colors: data.colors,
      weights: weights,
      length: length,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log(`Done: ${result.name} | type=${result.type} | colors=${result.colors.length} | weights=${JSON.stringify(result.weights)} | length=${result.length}mm | price=${result.price}`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
