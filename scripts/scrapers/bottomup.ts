// scripts/scrapers/bottomup.ts
// BOTTOMUP (ボトムアップ) product page scraper
// Handles lure products from bottomup.info/products/{slug}/
//
// Site: WordPress 6.4 + custom theme "bottomup", server-side rendered HTML.
// Lazy loading: WP Rocket plugin uses `data-lazy-src` attribute.
// Price: tax-included in spec text "￥X,XXX(税込)"
// All products are bass lures — target_fish is always ブラックバス.
// Colors: ul.list-products-color > li > a.popup[title] + img.img-over[data-lazy-src]
// Spec: table.table01 tr > th/td key-value pairs.
// Type: English type names in spec table, mapped to Japanese.
// Weight: oz-based "3/8oz. 1/2oz." or gram-based.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var OZ_TO_GRAMS = 28.3495;

// ---------------------------------------------------------------------------
// Type detection from spec table "Type" field (English → Japanese)
// ---------------------------------------------------------------------------

var TYPE_MAP: Record<string, string> = {
  'spinner baits': 'スピナーベイト',
  'spinnerbait': 'スピナーベイト',
  'slow floating': 'ルアー',
  'floating': 'ルアー',
  'sinking': 'ルアー',
  'fast sinking': 'ルアー',
  'suspending': 'ルアー',
  'shadtail worm': 'ワーム',
  'shad tail worm': 'ワーム',
  'shrimp worm': 'ワーム',
  'creature worm': 'ワーム',
  'frog': 'フロッグ',
  'pork': 'ワーム',
  'grub': 'ワーム',
  'stick bait': 'ワーム',
  'worm': 'ワーム',
  'jig': 'ラバージグ',
  'swim jig': 'ラバージグ',
  'football jig': 'ラバージグ',
  'rubber jig': 'ラバージグ',
  'crank bait': 'クランクベイト',
  'crankbait': 'クランクベイト',
  'vibration': 'バイブレーション',
  'minnow': 'ミノー',
  'popper': 'ポッパー',
  'buzz bait': 'バズベイト',
  'chatter bait': 'チャターベイト',
  'swimbait': 'スイムベイト',
  'big bait': 'ビッグベイト',
  'blade bait': 'ブレードベイト',
  'spoon': 'スプーン',
};

// Fallback: detect type from product name keywords
var NAME_TYPE_KEYWORDS: [RegExp, string][] = [
  [/ビーブル|Beeble/i, 'スピナーベイト'],
  [/フロッグ|Frog/i, 'フロッグ'],
  [/ジグ|Jig/i, 'ラバージグ'],
  [/クランク|Crank/i, 'クランクベイト'],
  [/スイマー|Swimmer/i, 'ワーム'],
  [/シュリンプ|Shrimp/i, 'ワーム'],
  [/ホグ|Hog/i, 'ワーム'],
  [/フリッシュ|Frish/i, 'ワーム'],
  [/ギミー|Gimmy/i, 'ワーム'],
  [/クネリー|Kunnery/i, 'ワーム'],
  [/ブリーヴァー|Breavor/i, 'ワーム'],
  [/バディ|Daddy|PORK/i, 'ワーム'],
  [/MPS|M\.P\.S/i, 'ワーム'],
  [/ハリースライド|HurrySlide/i, 'ワーム'],
];

// Soft bait keywords by URL category
var SOFTLURE_SLUGS = new Set([
  'kunnery36', 'volupminnow50', 'breavor-micro30', 'breavor2', 'breavorslim8',
  'gimmy24', 'gimmy', 'gimmy45', 'scooperfrogbaby', 'scooperfrog',
  'scooperfrogdaddy', 'scooperfrogmagnum', 'scooperfrogmega',
  'bulls-hog-baby', 'bulls-hog3', 'bullshogdaddy',
  'mps24', 'm-p-s_big', 'hurryshrimp3', 'hurryshrimp40',
  'volupswimmer33', 'volup-swimmer42', 'volupswimmer55',
  'frish35', 'hurryslide', 'bu-daddy-jr', 'budaddy', 'budaddy_l',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [bottomup] ${msg}`);
}

function extractSlug(url: string): string {
  var m = url.match(/\/products\/([^\/]+)\/?/);
  return m ? m[1] : url.replace(/\/$/, '').split('/').pop() || '';
}

function detectType(specType: string, name: string, slug: string): string {
  // 1. Check spec table Type field
  if (specType) {
    var lower = specType.toLowerCase().trim();
    for (var key of Object.keys(TYPE_MAP)) {
      if (lower.includes(key)) return TYPE_MAP[key];
    }
  }

  // 2. Check name keywords
  for (var [re, type] of NAME_TYPE_KEYWORDS) {
    if (re.test(name)) return type;
  }

  // 3. Check if URL slug is in softlure list
  if (SOFTLURE_SLUGS.has(slug)) return 'ワーム';

  return 'ルアー';
}

/**
 * Parse oz-based weight strings like "3/8oz." to grams.
 * Returns array of grams (e.g., "3/8oz. 1/2oz." → [10.6, 14.2]).
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  var weights: number[] = [];

  // Match oz fractions: "3/8oz." "1/2oz." "1oz." etc.
  var ozMatches = text.match(/(\d+\/\d+|\d+(?:\.\d+)?)\s*oz\.?/gi);
  if (ozMatches) {
    for (var m of ozMatches) {
      var cleaned = m.replace(/oz\.?/i, '').trim();
      if (cleaned.includes('/')) {
        var parts = cleaned.split('/');
        var num = parseFloat(parts[0]);
        var den = parseFloat(parts[1]);
        if (den > 0) weights.push(Math.round(num / den * OZ_TO_GRAMS * 10) / 10);
      } else {
        var val = parseFloat(cleaned);
        if (!isNaN(val)) weights.push(Math.round(val * OZ_TO_GRAMS * 10) / 10);
      }
    }
    return weights;
  }

  // Match gram weights: "14g" "3.5g" etc.
  var gMatches = text.match(/(\d+(?:\.\d+)?)\s*g(?:\b|$)/gi);
  if (gMatches) {
    for (var gm of gMatches) {
      var gval = parseFloat(gm.replace(/g$/i, '').trim());
      if (!isNaN(gval)) weights.push(gval);
    }
  }

  return weights;
}

/**
 * Parse length from spec text. Returns mm or null.
 * Examples: "3.3inch" → 83.8, "110mm" → 110, "3インチ" → 76.2
 */
function parseLength(text: string): number | null {
  if (!text) return null;

  // mm
  var mmMatch = text.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (mmMatch) return parseFloat(mmMatch[1]);

  // inch
  var inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:inch|インチ)/i);
  if (inchMatch) return Math.round(parseFloat(inchMatch[1]) * 25.4 * 10) / 10;

  return null;
}

/**
 * Parse price from spec text.
 * Examples: "￥1,540(税込)" → 1540
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  var m = text.match(/[￥¥]([0-9,]+)/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  return 0;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeBottomupPage(url: string): Promise<ScrapedLure> {
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
      // Product name from h3.tit-01
      var h3 = document.querySelector('h3.tit-01');
      var fullName = h3 ? h3.textContent?.trim() || '' : '';

      // Fallback: title tag
      if (!fullName) {
        var titleEl = document.querySelector('title');
        var titleText = titleEl ? titleEl.textContent?.trim() || '' : '';
        fullName = titleText.split(' – ')[0].trim();
      }

      // Parse name: "EnglishName(カタカナ)" or just name
      var nameMatch = fullName.match(/^(.+?)\((.+?)\)/);
      var nameEn = nameMatch ? nameMatch[1].trim() : fullName;
      var nameKana = nameMatch ? nameMatch[2].trim() : '';

      // Main image
      var mainImgEl = document.querySelector('.img-products-main img');
      var mainImage = '';
      if (mainImgEl) {
        mainImage = mainImgEl.getAttribute('data-lazy-src')
          || mainImgEl.getAttribute('src') || '';
        // If src is a data: URL placeholder, try noscript
        if (mainImage.startsWith('data:')) {
          var noscript = mainImgEl.parentElement?.querySelector('noscript');
          if (noscript) {
            var noscriptMatch = noscript.innerHTML.match(/src=["']([^"']+)["']/);
            if (noscriptMatch) mainImage = noscriptMatch[1];
          }
        }
      }

      // Spec table
      var specs: Record<string, string> = {};
      var rows = document.querySelectorAll('table.table01 tr');
      for (var i = 0; i < rows.length; i++) {
        var th = rows[i].querySelector('th');
        var td = rows[i].querySelector('td');
        if (th && td) {
          specs[th.textContent?.trim() || ''] = td.textContent?.trim() || '';
        }
      }

      // Colors
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorItems = document.querySelectorAll('ul.list-products-color > li');
      for (var j = 0; j < colorItems.length; j++) {
        var a = colorItems[j].querySelector('a.popup');
        if (!a) continue;

        var colorName = a.getAttribute('title') || '';
        if (!colorName) {
          // Try img alt
          var img = a.querySelector('img.img-over');
          if (img) colorName = img.getAttribute('alt') || '';
        }
        if (!colorName) continue;

        // Color image: use a.href (full size) or img.data-lazy-src
        var colorImg = a.getAttribute('href') || '';
        if (!colorImg || colorImg === '#') {
          var imgEl = a.querySelector('img.img-over');
          if (imgEl) {
            colorImg = imgEl.getAttribute('data-lazy-src')
              || imgEl.getAttribute('src') || '';
          }
        }

        // Skip if image is a placeholder
        if (colorImg.startsWith('data:')) colorImg = '';

        colors.push({ name: colorName.trim(), imageUrl: colorImg });
      }

      return {
        fullName: fullName,
        nameEn: nameEn,
        nameKana: nameKana,
        mainImage: mainImage,
        specs: specs,
        colors: colors,
      };
    });

    log(`Product: ${data.fullName}`);
    log(`Name EN: ${data.nameEn}, Kana: ${data.nameKana}`);
    log(`Main image: ${data.mainImage}`);
    log(`Spec keys: ${Object.keys(data.specs).join(', ')}`);
    log(`Colors: ${data.colors.length}`);

    // ---------- Post-process extracted data ----------

    var specType = data.specs['Type'] || '';
    var type = detectType(specType, data.fullName, slug);
    log(`Type: ${type} (from spec: "${specType}")`);

    var weights = parseWeights(data.specs['Weight'] || '');
    log(`Weights: ${JSON.stringify(weights)}`);

    var length = parseLength(data.specs['Length'] || '');
    log(`Length: ${length}mm`);

    var price = parsePrice(data.specs['Price'] || '');
    log(`Price: ${price}`);

    var result: ScrapedLure = {
      name: data.nameEn,
      name_kana: data.nameKana,
      slug: slug,
      manufacturer: 'BOTTOMUP',
      manufacturer_slug: 'bottomup',
      type: type,
      target_fish: ['ブラックバス'],
      description: '',
      price: price,
      colors: data.colors,
      weights: weights,
      length: length,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log(`Done: ${result.name} | type=${result.type} | colors=${result.colors.length} | weights=${JSON.stringify(result.weights)} | length=${result.length}mm`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
