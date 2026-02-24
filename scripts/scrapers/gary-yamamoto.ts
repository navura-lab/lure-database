// scripts/scrapers/gary-yamamoto.ts
// Gary Yamamoto Custom Baits product page scraper
// Handles soft/hard baits from www.gary-yamamoto.com/products/{slug}
//
// Site: WordPress (custom theme), Apache hosting, no WAF, headless OK.
// Images: self-hosted /products_data/ and /color/images/
// Price: NOT listed on site → always 0
// Spec format: Inline text in DETAIL box (.product_detail_fullbox)
// Colors: Numbered chip system with global color codes (e.g., 002, 042, 297)
// Two brands: "Gary YAMAMOTO" (soft baits) and "YABAI" (hard baits)

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GARY_BASE_URL = 'https://www.gary-yamamoto.com';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Soft baits (Gary brand)
  [/センコー|senko/i, 'ワーム'],
  [/グラブ|grub/i, 'ワーム'],
  [/カットテール|kuttail|kut\s*tail/i, 'ワーム'],
  [/カーリーテール|curly\s*tail/i, 'ワーム'],
  [/シュリンプ|shrimp/i, 'ワーム'],
  [/クロー|craw/i, 'ワーム'],
  [/レッグワーム|leg\s*worm/i, 'ワーム'],
  [/ハートテール|heart\s*tail/i, 'ワーム'],
  [/モコリー|mokory/i, 'ワーム'],
  [/ディトレーター|detrator/i, 'ワーム'],
  [/ディッシュ|d-shu/i, 'ワーム'],
  [/アングリー|angry/i, 'ワーム'],
  [/カリフォルニア|california/i, 'ワーム'],
  [/クリーチャー|kreature/i, 'ワーム'],
  [/フロッグ|frog/i, 'ワーム'],
  [/サンショウウオ|sanshouo/i, 'ワーム'],
  [/ピンテール|pintail/i, 'ワーム'],
  [/リザード|lizard/i, 'ワーム'],
  [/フラットテール|flat\s*tail/i, 'ワーム'],
  [/スイムベイト|swim\s*bait/i, 'ワーム'],
  [/ハガー|hugger/i, 'ワーム'],
  [/イカ|ika|lightika/i, 'ワーム'],
  [/タヌキ|tanuki/i, 'ワーム'],
  [/ミミズ|mimizu/i, 'ワーム'],
  [/エコベイト|eco\s*bait/i, 'ワーム'],
  [/ソルトウォーター|saltwater/i, 'ワーム'],
  // Hard baits (YABAI brand)
  [/クランク|crank|dump|rodeo/i, 'クランクベイト'],
  [/ポップ|pop/i, 'トップウォーター'],
  [/プロップ|prop/i, 'トップウォーター'],
  [/バズ|buzz/i, 'バズベイト'],
  [/スピナーベイト|spinner\s*bait|spin$/i, 'スピナーベイト'],
  [/フナ|funa/i, 'クランクベイト'],
  // Accessories
  [/フック|hook/i, 'フック'],
  [/シンカー|sinker/i, 'シンカー'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [gary-yamamoto] ${message}`);
}

/**
 * Extract product slug from URL.
 * /products/senko4 → "senko4"
 */
function extractSlug(url: string): string {
  var decoded = decodeURIComponent(url);
  var match = decoded.match(/\/products\/([^/?#]+)/);
  if (match) return match[1].toLowerCase().replace(/\/$/, '');
  var segments = new URL(decoded).pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] || '').toLowerCase();
}

/**
 * Detect lure type from breadcrumb + product name.
 */
function detectType(breadcrumb: string, name: string): string {
  var combined = breadcrumb + ' ' + name;
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(combined)) return TYPE_KEYWORDS[i][1];
  }
  return 'ワーム'; // Gary Yamamoto is primarily a worm maker
}

/**
 * Parse weight from spec text (hard baits).
 * "自重 : 約9.4g" → [9.4]
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  var weights: number[] = [];
  var re = /([\d.]+)\s*g/gi;
  var m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    var w = parseFloat(m[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }
  // Deduplicate and sort
  var unique: number[] = [];
  for (var i = 0; i < weights.length; i++) {
    if (unique.indexOf(weights[i]) === -1) unique.push(weights[i]);
  }
  return unique.sort(function(a, b) { return a - b; });
}

/**
 * Parse length from spec text or product name.
 * "全長 : 80mm" → 80
 * '4"YAMASENKO' → inch-based (not converted — return null, use name)
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  var mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    var len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }
  var cmMatch = text.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    var mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }
  return null;
}

/**
 * Extract inch size from product name and convert to mm.
 * '4"YAMASENKO' → 102 (4 * 25.4)
 * '2.5"Leg Worm' → 64
 */
function parseLengthFromName(name: string): number | null {
  var inchMatch = name.match(/([\d.]+)\s*["″]/);
  if (inchMatch) {
    var inches = parseFloat(inchMatch[1]);
    if (inches > 0 && inches < 20) {
      return Math.round(inches * 25.4);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeGaryYamamotoPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    log('Navigating to ' + url);
    var response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response || response.status() === 404) {
      throw new Error('Page not found (404): ' + url);
    }

    // Wait for content
    await page.waitForSelector('.product_mainimg, .product_detail_fullbox, h2', { timeout: 10000 }).catch(function() {});
    await page.waitForTimeout(1500);

    // ----- Extract all data in a single page.evaluate -----
    var pageData = await page.evaluate(function(baseUrl) {
      // --- Product name from h2 ---
      var name = '';
      var h2List = document.querySelectorAll('h2');
      for (var hi = 0; hi < h2List.length; hi++) {
        var h2Text = (h2List[hi].textContent || '').trim();
        // Skip section headers like "製品情報"
        if (h2Text && h2Text.length > 2 && h2Text !== '製品情報' && !h2Text.startsWith('製品情報')) {
          name = h2Text;
          break;
        }
      }
      // Fallback: title tag
      if (!name) {
        var titleText = document.title || '';
        var pipeIdx = titleText.indexOf(' | ');
        if (pipeIdx > 0) {
          name = titleText.substring(0, pipeIdx).trim();
        }
      }

      // --- Breadcrumb ---
      var breadcrumbText = '';
      var breadcrumb = document.querySelector('ul.pkz');
      if (breadcrumb) {
        breadcrumbText = (breadcrumb.textContent || '').trim();
      }

      // --- Brand detection from breadcrumb ---
      var brand = 'Gary YAMAMOTO';
      if (breadcrumbText.indexOf('YABAI') >= 0 || breadcrumbText.indexOf('yabai') >= 0) {
        brand = 'YABAI';
      }

      // --- Description ---
      var description = '';
      var descDiv = document.querySelector('.product_detaild002');
      if (descDiv) {
        description = (descDiv.textContent || '').trim().substring(0, 500);
      }
      if (!description) {
        var metaDesc = document.querySelector('meta[name="description"]');
        description = (metaDesc ? metaDesc.getAttribute('content') : '') || '';
        description = description.trim().substring(0, 500);
      }

      // --- Main image ---
      var mainImageUrl = '';
      var mainImgEl = document.querySelector('.product_mainimg img');
      if (mainImgEl) {
        mainImageUrl = mainImgEl.getAttribute('src') || '';
      }
      if (mainImageUrl && !mainImageUrl.startsWith('http')) {
        mainImageUrl = baseUrl + mainImageUrl;
      }

      // --- Spec / detail text ---
      var detailText = '';
      var detailBox = document.querySelector('.product_detail_fullbox');
      if (detailBox) {
        detailText = (detailBox.textContent || '').trim();
      }

      // --- Pack count ---
      var packCount = '';
      var detailPs = document.querySelectorAll('.product_detailp001');
      for (var pi = 0; pi < detailPs.length; pi++) {
        var pText = (detailPs[pi].textContent || '').trim();
        if (pText.indexOf('本入') >= 0 || pText.indexOf('個入') >= 0) {
          packCount = pText;
        }
      }

      // --- Spec info for hard baits (length, weight) ---
      var specLines: string[] = [];
      for (var si = 0; si < detailPs.length; si++) {
        var sText = (detailPs[si].textContent || '').trim();
        specLines.push(sText);
      }

      // --- Color chips (soft baits) ---
      var colors: { name: string; imageUrl: string; code: string }[] = [];
      var colorChips = document.querySelectorAll('span.colorchip');
      for (var ci = 0; ci < colorChips.length; ci++) {
        var chip = colorChips[ci];
        var link = chip.querySelector('a');
        var img = chip.querySelector('img');

        var code = '';
        var imgUrl = '';

        if (link) {
          // Extract code from text content
          var linkText = (link.textContent || '').trim();
          // Format: "002\n[img]" — the code is the first line
          var codeMatch = linkText.match(/^(\d{2,}[\dN]*)/);
          if (codeMatch) {
            code = codeMatch[1];
          }
          // Extract from href: /color/color.php?clcd=002
          if (!code) {
            var hrefMatch = (link.getAttribute('href') || '').match(/clcd=([^&]+)/);
            if (hrefMatch) {
              code = hrefMatch[1];
            }
          }
        }

        if (img) {
          imgUrl = img.getAttribute('src') || '';
          if (imgUrl && !imgUrl.startsWith('http')) {
            imgUrl = baseUrl + imgUrl;
          }
        }

        if (code || imgUrl) {
          colors.push({
            name: code, // Will be enriched with color name later
            imageUrl: imgUrl,
            code: code,
          });
        }
      }

      // --- Color images for hard baits (YABAI) ---
      if (colors.length === 0) {
        var separateBoxes = document.querySelectorAll('.separate_box_outer .wdp-140, .separate_box_outer .wdp-200');
        for (var bi = 0; bi < separateBoxes.length; bi++) {
          var box = separateBoxes[bi];
          var boxImg = box.querySelector('img');
          var boxP = box.querySelector('p');
          if (boxImg) {
            var bImgUrl = boxImg.getAttribute('src') || '';
            if (bImgUrl && !bImgUrl.startsWith('http')) {
              bImgUrl = baseUrl + bImgUrl;
            }
            var bName = boxP ? (boxP.textContent || '').trim() : '';
            colors.push({
              name: bName,
              imageUrl: bImgUrl,
              code: '',
            });
          }
        }
      }

      // --- Discontinued check ---
      var isDiscontinued = false;
      var allImgs = document.querySelectorAll('img');
      for (var di = 0; di < allImgs.length; di++) {
        var diSrc = allImgs[di].getAttribute('src') || '';
        if (diSrc.indexOf('discontinued') >= 0) {
          isDiscontinued = true;
          break;
        }
      }

      return {
        name: name,
        breadcrumbText: breadcrumbText,
        brand: brand,
        description: description,
        mainImageUrl: mainImageUrl,
        detailText: detailText,
        packCount: packCount,
        specLines: specLines,
        colors: colors,
        isDiscontinued: isDiscontinued,
      };
    }, GARY_BASE_URL);

    log('Extracted: name="' + pageData.name + '", colors=' + pageData.colors.length + ', brand=' + pageData.brand);

    // ----- Enrich color names for chip-based colors -----
    var enrichedColors: ScrapedColor[] = [];
    var colorNameCache: Record<string, string> = {};

    for (var ci = 0; ci < pageData.colors.length; ci++) {
      var c = pageData.colors[ci];
      var colorName = c.name;

      // For chip-based colors (soft baits), look up the color name
      if (c.code && /^\d+/.test(c.code)) {
        if (colorNameCache[c.code]) {
          colorName = colorNameCache[c.code];
        } else {
          try {
            var colorUrl = GARY_BASE_URL + '/color/color.php?clcd=' + c.code;
            var colorPage = await context.newPage();
            await colorPage.goto(colorUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            var colorTitle = await colorPage.title();
            // Title format: "002 Smoke (Solid)"
            if (colorTitle && colorTitle.length > 0) {
              colorName = colorTitle.trim();
            }
            await colorPage.close();
            colorNameCache[c.code] = colorName;
            // Be polite
            await page.waitForTimeout(300);
          } catch (e) {
            log('Warning: Failed to fetch color name for code ' + c.code);
            colorName = '#' + c.code;
          }
        }
      }

      enrichedColors.push({
        name: colorName || ('#' + (c.code || 'unknown')),
        imageUrl: c.imageUrl,
      });
    }

    // ----- Post-process -----
    var slug = extractSlug(url);
    var name = pageData.name || slug.replace(/-/g, ' ');
    var type = detectType(pageData.breadcrumbText, name);

    // Parse specs from detail text
    var specText = pageData.specLines.join(' ');
    var weights = parseWeights(specText);
    var length = parseLength(specText);

    // If no length from specs, try to extract inch size from name
    if (length === null) {
      length = parseLengthFromName(name);
    }

    // Main image
    var mainImage = pageData.mainImageUrl || '';
    if (!mainImage && enrichedColors.length > 0) {
      mainImage = enrichedColors[0].imageUrl;
    }

    // Fallback: if 0 colors but mainImage exists, create default entry
    if (enrichedColors.length === 0 && mainImage) {
      log('Warning: 0 colors found, creating default entry from main image');
      enrichedColors.push({ name: name, imageUrl: mainImage });
    }

    // Gary Yamamoto targets bass primarily
    var targetFish = ['ブラックバス'];
    // YABAI also targets bass
    // Saltwater category targets different fish
    if (/ソルトウォーター|saltwater/i.test(pageData.breadcrumbText + ' ' + name)) {
      targetFish = ['シーバス', 'ロックフィッシュ'];
    }

    // Add description suffix for discontinued items
    var description = pageData.description;
    if (pageData.isDiscontinued) {
      description = (description ? description + ' ' : '') + '※生産終了';
    }

    var result: ScrapedLure = {
      name: name,
      name_kana: name,
      slug: slug,
      manufacturer: 'Gary Yamamoto',
      manufacturer_slug: 'gary-yamamoto',
      type: type,
      target_fish: targetFish,
      description: description,
      price: 0, // Price not available on this site
      colors: enrichedColors,
      weights: weights,
      length: length,
      mainImage: mainImage,
      sourceUrl: url,
    };

    log('Done: ' + name + ' | type=' + type + ' | colors=' + enrichedColors.length + ' | weights=[' + weights.join(',') + '] | length=' + length + 'mm');

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
