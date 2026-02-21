// scripts/scrapers/osp.ts
// O.S.P product page scraper
// Handles lure products from www.o-s-p.net/products/{slug}/
//
// Site: Custom HTML + jQuery + GSAP + Isotope.js, no WAF, headless OK.
// Images: main /wp/wp-content/uploads/img_products_main_{slug}.jpg
//         colors /img/products/{slug}/img_{code}.jpg
// Price format: "1,870円（税込）" — TAX-INCLUDED price used directly
//   Also loaded dynamically via JS `newprice` object
// Spec format: plain text "Length: 53.0mm" / "Weight: 9.0g" / "Type: Hi Floating"
// Colors: ul.optionitem li img thumbnails with alt text for color names

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OSP_BASE_URL = 'https://www.o-s-p.net';

// ---------------------------------------------------------------------------
// Type detection: product name keyword-based
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Crankbaits
  [/blitz|crank|dunk|hpf|louder|highcut/i, 'クランクベイト'],
  // Minnows
  [/rudra|varuna|durga|asura|bent\s*minnow|i-?waver|over\s*real/i, 'ミノー'],
  // Big baits
  [/karen|yamato/i, 'ビッグベイト'],
  // Topwater
  [/romance|picro|duck\s*bill/i, 'トップウォーター'],
  // Buzzbaits
  [/buzzn|co-?buzzn|daibuzzn|buzz\s*zero/i, 'バズベイト'],
  // Spinnerbaits
  [/pitcher|typhoon/i, 'スピナーベイト'],
  // Rubber jigs
  [/jig\s*zero|hunts|tugger|slipper|synchro|weed\s*rider/i, 'ラバージグ'],
  // Metal vibrations
  [/blade\s*jig|over\s*ride|metal\s*blade/i, 'メタルバイブ'],
  // Worms / soft baits
  [/dolive|doliveshad|dolivecraw|dolivestick|doliveshrimp|dolivebeaver|dolivehog|dolivecurly|dolivecrawler|doliveshot|dolivess/i, 'ワーム'],
  [/hp\s*(shadtail|minnow|bug|fish|3d)/i, 'ワーム'],
  [/mmz|orikanemushi|ebi|mylar|action\s*trailer|erimaki|spinnuts|wispul|dice|flutter/i, 'ワーム'],
  // Frogs
  [/frog|drippy|skating|spintail|diving/i, 'フロッグ'],
  // Metal jigs (salt)
  [/bonneville|delgado|fakie|alici/i, 'メタルジグ'],
  // Salt minnows
  [/tsukiyomi|moses/i, 'ミノー'],
  // Tai rubber
  [/コト玉|kotodama/i, 'タイラバ'],
  // Salt jigheads
  [/glidy/i, 'ジグヘッド'],
  // Ayu
  [/chestar/i, 'ミノー'],
  // Trout
  [/melo|durga\s*area/i, 'ミノー'],
  // Windy
  [/windy/i, 'ワーム'],
];

// ---------------------------------------------------------------------------
// Target fish detection: based on product name + sourceUrl category
// ---------------------------------------------------------------------------

const TARGET_FISH_FROM_CATEGORY: [RegExp, string[]][] = [
  [/\/bass\//i, ['ブラックバス']],
  [/\/trout\//i, ['トラウト']],
  [/\/ayu\//i, ['アユ']],
  [/\/salt\/metaljig/i, ['青物']],
  [/\/salt\/tairubber/i, ['マダイ']],
  [/\/salt\//i, ['シーバス']],
];

const TARGET_FISH_FROM_NAME: [RegExp, string[]][] = [
  [/chestar/i, ['アユ']],
  [/melo|durga\s*area/i, ['トラウト']],
  [/bonneville|delgado|fakie|alici/i, ['青物']],
  [/kotodama|コト玉/i, ['マダイ']],
  [/tsukiyomi|moses/i, ['シーバス']],
  [/\bsw\b/i, ['シーバス']],
  [/glidy|windy/i, ['シーバス']],
  [/flutter\s*tube/i, ['シーバス']],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [osp] ${message}`);
}

/**
 * Extract product slug from URL.
 * /products/blitz/ → "blitz"
 */
function extractSlug(url: string): string {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/\/products\/([^/?#]+)/);
  if (match) return match[1].toLowerCase().replace(/\/$/, '');
  // Fallback: last non-empty path segment
  const segments = new URL(decoded).pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] || '').toLowerCase();
}

/**
 * Detect lure type from product name.
 */
function detectType(name: string): string {
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(name)) return type;
  }
  return 'ルアー';
}

/**
 * Detect target fish from product name and source URL category.
 */
function detectTargetFish(name: string, _sourceUrl: string): string[] {
  // First try name-based detection
  for (const [pattern, fish] of TARGET_FISH_FROM_NAME) {
    if (pattern.test(name)) return fish;
  }

  // Default for O.S.P: bass specialist
  return ['ブラックバス'];
}

/**
 * Parse tax-included price from text.
 * "1,870円（税込）" → 1870
 * "※アバロン使用カラーのみ 2,090円（税込）" → picks the first/lowest
 */
function parsePriceIncTax(text: string): number {
  if (!text) return 0;

  // Find all "NNN円（税込）" patterns
  const matches = [...text.matchAll(/([\d,]+)\s*円[（(]税込[）)]/g)];
  if (matches.length > 0) {
    const prices = matches.map(m => parseInt(m[1].replace(/,/g, ''), 10)).filter(p => p >= 100 && p < 1000000);
    if (prices.length > 0) return Math.min(...prices);
  }

  // Fallback: first "NNN円" pattern
  const fallback = text.match(/([\d,]+)\s*円/);
  if (fallback) {
    const price = parseInt(fallback[1].replace(/,/g, ''), 10);
    if (price >= 100 && price < 1000000) return price;
  }

  return 0;
}

/**
 * Parse weights from spec text.
 * "Weight: 9.0g" → [9]
 * "1/4oz (7.0g)" → [7]
 * Handles oz conversion: 1oz = 28.35g
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];

  // Match gram values
  const gMatches = text.matchAll(/([\d.]+)\s*g(?:\b|[^a-z])/gi);
  for (const m of gMatches) {
    const w = parseFloat(m[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }

  // If no gram values, try oz conversion
  if (weights.length === 0) {
    const ozMatches = text.matchAll(/([\d.]+(?:\/[\d.]+)?)\s*oz/gi);
    for (const m of ozMatches) {
      let ozStr = m[1];
      let ozVal: number;
      if (ozStr.includes('/')) {
        const [num, den] = ozStr.split('/');
        ozVal = parseFloat(num) / parseFloat(den);
      } else {
        ozVal = parseFloat(ozStr);
      }
      if (ozVal > 0 && ozVal < 100) {
        const grams = Math.round(ozVal * 28.35 * 10) / 10;
        weights.push(grams);
      }
    }
  }

  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Parse length from spec text.
 * "Length: 53.0mm" → 53
 * "Length: 3.5in/4in/4.5in/6in" → 89 (first size in mm)
 */
function parseLength(text: string): number | null {
  if (!text) return null;

  // mm format
  const mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }

  // cm format
  const cmMatch = text.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    const mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }

  // inch format (first value): "3.5in" → 89mm
  const inMatch = text.match(/([\d.]+)\s*in(?:ch)?/i);
  if (inMatch) {
    const mm = Math.round(parseFloat(inMatch[1]) * 25.4);
    if (mm > 0 && mm < 5000) return mm;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeOspPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    log(`Navigating to ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response || response.status() === 404) {
      throw new Error(`Page not found (404): ${url}`);
    }

    // Wait for JS to execute (price loading, etc.)
    await page.waitForTimeout(3000);

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate((baseUrl: string) => {
      // --- Product name ---
      // On OSP pages, h3 contains the product name (e.g. "BLITZ")
      // h4.h4_item contains the catchphrase (e.g. "シャロークランクの世代交代を加速させる新生児")
      let name = '';
      const h3 = document.querySelector('h3');
      if (h3) name = h3.textContent?.trim() || '';
      // Fallback: title tag — format "PRODUCT NAME | O.S.P,Inc."
      if (!name) {
        const titleText = document.title || '';
        const pipeIdx = titleText.indexOf('|');
        if (pipeIdx > 0) {
          name = titleText.substring(0, pipeIdx).trim();
        } else {
          name = titleText.trim();
        }
      }
      // Fallback: h4.h4_item (catchphrase — better than nothing)
      if (!name) {
        const h4Item = document.querySelector('h4.h4_item');
        name = h4Item?.textContent?.trim() || '';
      }

      // --- Catchphrase as description seed ---
      let catchphrase = '';
      const h4Item = document.querySelector('h4.h4_item');
      if (h4Item) catchphrase = h4Item.textContent?.trim() || '';

      // --- Description ---
      let description = catchphrase;
      // Also look for substantial text paragraphs
      const allPs = document.querySelectorAll('p');
      for (const p of allPs) {
        const text = p.textContent?.trim() || '';
        if (text.length > 50 &&
            !text.includes('Length') &&
            !text.includes('Weight') &&
            !text.includes('円（税込）') &&
            !text.includes('Copyright') &&
            !text.includes('o-s-p.net') &&
            !text.includes('PRODUCTS') &&
            !text.includes('FRESH WATER') &&
            !text.includes('SALT WATER') &&
            !text.includes('REPORT') &&
            !text.includes('MOVIE')) {
          description = text.substring(0, 500);
          break;
        }
      }
      // Fallback: meta description
      if (!description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        description = metaDesc?.getAttribute('content')?.trim()?.substring(0, 500) || '';
      }

      // --- Spec text extraction ---
      // OSP uses "Label\nValue" format (no colons), e.g.:
      //   Length
      //   53.0mm
      //   Weight
      //   9.0g
      //   Type
      //   Hi Floating
      const bodyText = document.body.innerText || '';

      let lengthText = '';
      let weightText = '';
      let specType = '';
      let priceText = '';

      // Extract spec fields — "Label\tValue" format (tab-separated on same line)
      // e.g. "Length\t53.0mm", "Weight\t9.0g", "Type\tHi Floating"
      // Length may have multiple values: "53.0mm" or "3.5in/4in/4.5in/6in"
      const lengthMatch = bodyText.match(/\bLength[\t\s]+([\s\S]+?)(?=\b(?:Weight|Type|Hook|Color|Price|発売|Ring|Count)\b)/i);
      if (lengthMatch) lengthText = lengthMatch[1].trim();

      // Weight may span multiple lines:
      //   Weight\t1/4oz(7.0g)ホワイトビーズ
      //   5/16oz(9.0g)ブラックビーズ
      //   3/8oz(11.0g)ブルービーズ
      // Capture from Weight to next spec label (Type, Hook, Color, Price, 発売)
      const weightMatch = bodyText.match(/\bWeight[\t\s]+([\s\S]+?)(?=\b(?:Type|Hook|Color|Price|発売|Ring)\b)/i);
      if (weightMatch) weightText = weightMatch[1].trim();

      const typeMatch = bodyText.match(/\bType[\t\s]+(.+?)(?:\n|$)/i);
      if (typeMatch) specType = typeMatch[1].trim();

      // Price: look for "NNN円（税込）" patterns
      const priceMatches = bodyText.match(/([\d,]+)\s*円[（(]税込[）)]/g);
      if (priceMatches) {
        priceText = priceMatches.join(' ');
      }

      // --- Colors from thumbnails ---
      const colors: { name: string; imageUrl: string }[] = [];
      // Primary: ul.optionitem li img
      const thumbImgs = document.querySelectorAll('ul.optionitem li img, .optionitem li img, .color_list li img, .color-list li img');
      const seenSrcs = new Set<string>();

      for (const img of thumbImgs) {
        const src = (img as HTMLImageElement).getAttribute('src') || '';
        if (!src || seenSrcs.has(src)) continue;
        // Skip non-color images (kakudai = zoom button, weight = weight chart, etc.)
        if (src.includes('kakudai') || src.includes('weight') || src.includes('logo') || src.includes('icon')) continue;
        seenSrcs.add(src);

        // Build full URL
        let fullSrc = src;
        if (!src.startsWith('http')) {
          // Relative to site root or page
          if (src.startsWith('/')) {
            fullSrc = `${baseUrl}${src}`;
          } else if (src.startsWith('../../')) {
            fullSrc = `${baseUrl}/${src.replace(/^\.\.\/\.\.\//g, '')}`;
          } else {
            fullSrc = `${baseUrl}/img/products/${src}`;
          }
        }

        // Get color name from alt text
        let colorName = (img as HTMLImageElement).getAttribute('alt')?.trim() || '';
        if (!colorName) {
          colorName = src.replace(/^.*img_/, '').replace(/\.\w+$/, '').toUpperCase();
        }

        colors.push({ name: colorName, imageUrl: fullSrc });
      }

      // If no colors found from optionitem, try broader search
      if (colors.length === 0) {
        const allImgs = document.querySelectorAll('img[src*="/img/products/"]');
        for (const img of allImgs) {
          const src = (img as HTMLImageElement).getAttribute('src') || '';
          // Skip main/non-color images
          if (src.includes('main') || src.includes('logo') || src.includes('weight') || src.includes('kakudai') || src.includes('icon')) continue;
          if (!src || seenSrcs.has(src)) continue;
          seenSrcs.add(src);

          let fullSrc = src;
          if (!src.startsWith('http')) {
            fullSrc = `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
          }

          let colorName = (img as HTMLImageElement).getAttribute('alt')?.trim() || '';
          if (!colorName) {
            colorName = src.replace(/^.*img_/, '').replace(/\.\w+$/, '').toUpperCase();
          }

          colors.push({ name: colorName, imageUrl: fullSrc });
        }
      }

      // --- Main image ---
      let mainImageUrl = '';
      // Try img with src containing "products_main" or class freeimg
      const mainImg = document.querySelector('img[src*="products_main"], img.freeimg') as HTMLImageElement;
      if (mainImg) {
        const src = mainImg.getAttribute('src') || '';
        if (!src.includes('kakudai') && !src.includes('icon')) {
          mainImageUrl = src.startsWith('http') ? src : `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
        }
      }
      // Fallback: first wp-content/uploads product image
      if (!mainImageUrl) {
        const allImgs = document.querySelectorAll('img[src*="wp-content/uploads"]');
        for (const img of allImgs) {
          const src = (img as HTMLImageElement).getAttribute('src') || '';
          if (src.includes('kakudai') || src.includes('icon')) continue;
          if (src.includes('products_main') || src.includes('img_products') || src.includes('main_')) {
            mainImageUrl = src.startsWith('http') ? src : `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
            break;
          }
        }
      }
      // Fallback: any large product image in /wp/wp-content/uploads/
      if (!mainImageUrl) {
        const allImgs = document.querySelectorAll('img[src*="wp-content/uploads"]');
        for (const img of allImgs) {
          const src = (img as HTMLImageElement).getAttribute('src') || '';
          if (src.includes('kakudai') || src.includes('icon') || src.includes('logo')) continue;
          mainImageUrl = src.startsWith('http') ? src : `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
          break;
        }
      }

      return {
        name,
        description,
        lengthText,
        weightText,
        specType,
        priceText,
        colors,
        mainImageUrl,
      };
    }, OSP_BASE_URL);

    log(`Extracted: name="${pageData.name}", colors=${pageData.colors.length}, specType="${pageData.specType}"`);

    // ----- Post-process extracted data -----
    const slug = extractSlug(url);
    const name = pageData.name || slug.replace(/[-_]/g, ' ');
    const type = detectType(name);
    const price = parsePriceIncTax(pageData.priceText);

    // Parse specs
    const weights = parseWeights(pageData.weightText);
    const length = parseLength(pageData.lengthText);

    // Target fish
    const targetFish = detectTargetFish(name, url);

    // Colors
    const colors: ScrapedColor[] = pageData.colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl,
    }));

    // Main image
    const mainImage = pageData.mainImageUrl || (colors.length > 0 ? colors[0].imageUrl : '');

    const result: ScrapedLure = {
      name,
      name_kana: name,
      slug,
      manufacturer: 'O.S.P',
      manufacturer_slug: 'osp',
      type,
      target_fish: targetFish,
      description: pageData.description,
      price,
      colors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(`Done: ${name} | type=${type} | price=${price} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | fish=${targetFish.join(',')}`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
