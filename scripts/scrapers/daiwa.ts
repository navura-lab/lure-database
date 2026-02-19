// scripts/scrapers/daiwa.ts
// Daiwa product page scraper
// Handles lure products from www.daiwa.com/jp/product/{hash}

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAIWA_BASE_URL = 'https://www.daiwa.com';

// ---------------------------------------------------------------------------
// Type detection keywords
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|METAL JIG/i, 'メタルジグ'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/バイブレーション|VIB/i, 'バイブレーション'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/スピナーベイト|SPINNER ?BAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZ ?BAIT/i, 'バズベイト'],
  [/スイムベイト|SWIM ?BAIT/i, 'スイムベイト'],
  [/ジョイント|JOINT/i, 'ジョイントベイト'],
  [/トップウォーター|TOPWATER/i, 'トップウォーター'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ジグヘッド|JIG ?HEAD/i, 'ジグヘッド'],
  [/ブレード|BLADE|SPIN ?TAIL/i, 'ブレードベイト'],
  [/エギ|EGI|餌木/i, 'エギ'],
  [/タイラバ|鯛ラバ|TIE ?RUBBER/i, 'タイラバ'],
  [/ジグ|JIG/i, 'メタルジグ'],
  [/ワーム|WORM|SOFT|ソフト/i, 'ワーム'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [daiwa] ${message}`);
}

/**
 * Normalize fullwidth characters to halfwidth.
 */
function normalizeFullWidth(text: string): string {
  return text
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[ａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/＃/g, '#')
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/～/g, '~')
    .replace(/ｇ/g, 'g')
    .replace(/ｍ/g, 'm');
}

/**
 * Parse Daiwa price text (tax-excluded) and convert to tax-included (×1.1).
 * "1,800~8,800円" → 1980 (min × 1.1)
 * "2,700円" → 2970
 */
function parseDaiwaPrice(priceText: string): number {
  if (!priceText) return 0;
  const cleaned = normalizeFullWidth(priceText).replace(/,/g, '').replace(/\s/g, '');

  // Range: "1800~8800" → take minimum
  const rangeMatch = cleaned.match(/(\d+)[~\-](\d+)/);
  if (rangeMatch) {
    return Math.round(parseInt(rangeMatch[1], 10) * 1.1);
  }

  // Single: "2700円" or just "2700"
  const singleMatch = cleaned.match(/(\d+)/);
  if (singleMatch) {
    const price = parseInt(singleMatch[1], 10);
    if (price > 100 && price < 100000) {
      return Math.round(price * 1.1);
    }
  }

  return 0;
}

/**
 * Extract weight from spec row item name or weight column.
 * Handles: "33", "33g", "1/2oz.", "約33", fullwidth numbers
 */
function parseWeight(text: string): number {
  const normalized = normalizeFullWidth(text).replace(/約/g, '').trim();

  // grams: "33" or "33g" or "33.5g"
  const gramMatch = normalized.match(/([\d.]+)\s*g?$/i);
  if (gramMatch) {
    const num = parseFloat(gramMatch[1]);
    if (!isNaN(num) && num > 0 && num < 10000) {
      return Math.round(num * 10) / 10;
    }
  }

  // oz fraction: "1/2oz."
  const ozFracMatch = normalized.match(/(\d+)\/(\d+)\s*oz/i);
  if (ozFracMatch) {
    return Math.round((parseInt(ozFracMatch[1]) / parseInt(ozFracMatch[2])) * 28.3495 * 10) / 10;
  }

  // oz decimal: "1.5oz."
  const ozDecMatch = normalized.match(/([\d.]+)\s*oz/i);
  if (ozDecMatch) {
    return Math.round(parseFloat(ozDecMatch[1]) * 28.3495 * 10) / 10;
  }

  return 0;
}

/**
 * Detect lure type from page content.
 */
function detectType(category: string, title: string, description: string): string {
  const combined = `${category} ${title} ${description}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) {
      return typeName;
    }
  }
  return 'ルアー';
}

/**
 * Generate slug from Daiwa URL.
 * /jp/product/huz2stf → "huz2stf"
 */
function generateSlug(url: string): string {
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // Pattern: /jp/product/{hash}
    const productIdx = segments.indexOf('product');
    if (productIdx >= 0 && productIdx + 1 < segments.length) {
      return segments[productIdx + 1].toLowerCase();
    }
    return segments[segments.length - 1]?.toLowerCase() || '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeDaiwaPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Navigate
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    log('Page loaded');

    // --- Product name (Japanese) ---
    // Daiwa product pages have the product title in an h1 or .product_name element
    let name = '';
    try {
      // Try multiple selectors
      name = await page.locator('h1.product_name, .product_detail h1, h1').first().innerText()
        .then(t => t.split('\n')[0].trim())  // Take first line only (sometimes h1 has subtitle)
        .catch(() => '');
    } catch { /* ignore */ }

    // Fallback: extract from title tag
    if (!name) {
      const titleTag = await page.title().catch(() => '');
      // "TGベイト | 製品情報 | DAIWA" → "TGベイト"
      name = titleTag.split('|')[0].trim();
    }
    log(`Product name: ${name}`);

    if (!name) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // --- Title tag ---
    const titleTag = await page.title().catch(() => '');
    log(`Title tag: ${titleTag}`);

    // --- Category (from breadcrumb or page content) ---
    let category = '';
    try {
      const breadcrumb = await page.locator('.breadcrumb, nav[aria-label="breadcrumb"]').first().innerText()
        .catch(() => '');
      category = breadcrumb;
    } catch { /* ignore */ }
    log(`Category: ${category.substring(0, 80)}`);

    // --- Description ---
    let description = '';
    try {
      // Daiwa product descriptions are in sections below the main image
      const descTexts = await page.locator('.product_detail p, section.mainParts_description p, .mainParts_point p')
        .allInnerTexts().catch(() => []);
      description = descTexts
        .filter(t => t.trim().length > 20)
        .join('\n')
        .substring(0, 500);
    } catch { /* ignore */ }
    if (!description) {
      description = titleTag;
    }
    log(`Description: ${description.substring(0, 80)}...`);

    // --- SPEC table ---
    // Daiwa's spec table is inside <section class="spec"> with <table>
    // Extract all at once via page.evaluate for speed (some products have 100+ rows)
    let specHeaders: string[] = [];
    let specRows: Record<string, string>[] = [];
    try {
      const specData = await page.evaluate(() => {
        const table = document.querySelector('section.spec table, .spec table');
        if (!table) return { headers: [], rows: [] };

        const trs = table.querySelectorAll('tr');
        if (trs.length < 2) return { headers: [], rows: [] };

        // Headers from first row
        const headers: string[] = [];
        trs[0].querySelectorAll('th, td').forEach(cell => {
          headers.push((cell.textContent || '').trim());
        });

        // Data rows
        const rows: Record<string, string>[] = [];
        for (let r = 1; r < trs.length; r++) {
          const cells = trs[r].querySelectorAll('th, td');
          const row: Record<string, string> = {};
          cells.forEach((cell, c) => {
            if (c < headers.length) {
              row[headers[c]] = (cell.textContent || '').trim();
            }
          });
          if (Object.keys(row).length > 0) rows.push(row);
        }
        return { headers, rows };
      });

      specHeaders = specData.headers.map(h => normalizeFullWidth(h));
      specRows = specData.rows.map(row => {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          normalized[normalizeFullWidth(k)] = normalizeFullWidth(v);
        }
        return normalized;
      });
      if (specHeaders.length > 0) log(`Spec headers: ${specHeaders.join(' | ')}`);
    } catch (e) {
      log(`Spec table extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`Spec rows: ${specRows.length}`);

    // --- Extract weights from spec rows ---
    // Find the weight column header (標準自重, 自重, ウエイト, Weight, etc.)
    // Prefer g-column explicitly, skip oz columns
    const weightHeader =
      specHeaders.find(h => /自重.*g|ウエイト.*g|ウェイト.*g|weight.*g/i.test(h)) ||
      specHeaders.find(h => (/自重|ウエイト|ウェイト|weight/i.test(h)) && !/oz/i.test(h)) ||
      '';

    const weightsSet = new Set<number>();
    for (const row of specRows) {
      if (weightHeader && row[weightHeader]) {
        const w = parseWeight(row[weightHeader]);
        if (w > 0) weightsSet.add(w);
      }
    }
    const weights = [...weightsSet].sort((a, b) => a - b);
    log(`Weights: [${weights.join(', ')}]`);

    // --- Extract length from spec rows ---
    // Prefer mm-column explicitly, then generic size columns, skip inch columns
    const sizeHeader =
      specHeaders.find(h => /サイズ.*mm|全長.*mm|length.*mm/i.test(h)) ||
      specHeaders.find(h => /サイズ|全長|length/i.test(h) && !/inch/i.test(h)) ||
      '';

    let length: number | null = null;
    if (sizeHeader && specRows.length > 0) {
      const sizeText = normalizeFullWidth(specRows[0][sizeHeader] || '');
      const sizeMatch = sizeText.match(/([\d.]+)/);
      if (sizeMatch) {
        const num = parseFloat(sizeMatch[1]);
        if (!isNaN(num) && num > 0 && num < 2000) {
          length = num;
        }
      }
    }
    log(`Length: ${length}`);

    // --- Extract price from spec rows ---
    const priceHeader = specHeaders.find(h =>
      /価格|プライス|price/i.test(h)
    ) || '';

    let price = 0;
    if (priceHeader && specRows.length > 0) {
      price = parseDaiwaPrice(specRows[0][priceHeader] || '');
    }
    // Fallback: try from product page header area
    if (price === 0) {
      try {
        const priceEl = await page.locator('.product_price, .price').first().innerText().catch(() => '');
        price = parseDaiwaPrice(priceEl);
      } catch { /* ignore */ }
    }
    log(`Price: ${price} yen (tax incl.)`);

    // --- Colors ---
    // Strategy 1: Extract from slick slider using page.evaluate (fast, no per-element round-trips)
    const colors: ScrapedColor[] = [];
    try {
      const rawColors = await page.evaluate(() => {
        const results: { name: string; imageUrl: string }[] = [];
        const seen = new Set<string>();
        // Get non-cloned slick slides
        const slides = document.querySelectorAll('.item_view .slick-slide:not(.slick-cloned)');
        slides.forEach(slide => {
          const img = slide.querySelector('img');
          const caption = slide.querySelector('.caption, p');
          if (!img || !caption) return;
          const src = img.getAttribute('src') || '';
          const text = caption.textContent?.trim() || '';
          if (!src || !text) return;
          // Remove size suffix like "(135)" or "（80g）"
          const colorName = text.replace(/\s*[\(（][^)）]*[\)）]\s*$/, '').trim();
          if (colorName && !seen.has(colorName)) {
            seen.add(colorName);
            results.push({ name: colorName, imageUrl: src });
          }
        });
        return results;
      });
      for (const c of rawColors) {
        const fullUrl = c.imageUrl.startsWith('http') ? c.imageUrl : `${DAIWA_BASE_URL}${c.imageUrl}`;
        colors.push({ name: c.name, imageUrl: fullUrl });
      }
    } catch (e) {
      log(`Color slider extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Strategy 2: If no colors from slider, extract unique color names from spec table
    if (colors.length === 0 && specRows.length > 0) {
      const itemHeader = specHeaders.find(h => /アイテム|item|品名/i.test(h)) || specHeaders[0];
      if (itemHeader) {
        const seenColors = new Set<string>();
        for (const row of specRows) {
          const itemText = normalizeFullWidth(row[itemHeader] || '');
          // Item text includes product name + size + color
          // Simple heuristic: color is the last segment
          let colorName = itemText;
          if (name && itemText.includes(name)) {
            colorName = itemText.substring(itemText.indexOf(name) + name.length).trim();
          }
          colorName = colorName.trim();
          if (colorName && !seenColors.has(colorName)) {
            seenColors.add(colorName);
            colors.push({ name: colorName, imageUrl: '' });
          }
        }
      }
    }
    log(`Found ${colors.length} colors`);

    // --- Main image ---
    let mainImage = '';
    try {
      mainImage = await page.locator('.product_detail img, .main_image img, .slider img').first()
        .getAttribute('src').catch(() => '') || '';
      if (mainImage && !mainImage.startsWith('http')) {
        mainImage = `${DAIWA_BASE_URL}${mainImage}`;
      }
    } catch { /* ignore */ }
    if (!mainImage && colors.length > 0 && colors[0].imageUrl) {
      mainImage = colors[0].imageUrl;
    }
    log(`Main image: ${mainImage}`);

    // --- Generate slug ---
    const slug = generateSlug(url);
    if (!slug) {
      throw new Error(`Could not generate slug from URL: ${url}`);
    }
    log(`Slug: ${slug}`);

    // --- Detect type ---
    const type = detectType(category, titleTag, description);
    log(`Detected type: ${type}`);

    // --- Name kana ---
    // Daiwa products typically have Japanese names, so the name itself works as kana
    // For English-name products, we leave the name as-is (same as Megabass fallback)
    const name_kana = name;
    log(`Name kana: ${name_kana}`);

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'DAIWA',
      manufacturer_slug: 'daiwa',
      type,
      description,
      price,
      colors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(`Scrape complete: ${name} (${colors.length} colors, ${weights.length} weights, price: ${price})`);
    return result;

  } finally {
    if (browser) {
      await browser.close();
      log('Browser closed');
    }
  }
}
