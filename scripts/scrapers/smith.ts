// scripts/scrapers/smith.ts
// SMITH product page scraper
// Handles lure products from smith.jp/product/{category}/{slug}/{slug}.html
//
// Site: Static HTML, Apache, jQuery 1.10.2, Lightbox. No WAF.
// Encoding: Product detail pages are Shift_JIS (Playwright auto-decodes).
// Structure:
//   - Product name: <title> tag
//   - Catch copy: .pro_toptext_komidashi > span.tx12
//   - Description: .pro_toptext > p.mb20
//   - Main image: .pro_topimg img (relative path)
//   - Spec tables: .pro_jouhou_in table × N (one per model variant)
//     - td.l1 "LENGTH" → td.r1 "50mm"
//     - td.l1 "WEIGHT" → td.r1 "4.5g"
//     - td.l1 "TYPE"   → td.r1 "ヘビーシンキング"
//     - td.l2 "PRICE"  → td.r1 "￥1,750+税" (tax-excluded!)
//   - Colors: .pro_content_color (p.tx11 = name, a > img = image)
//   - Images: relative paths → base from page URL
//
// Multiple model variants per page (e.g., D-Contact 50/63/72):
//   Each has its own .pro_jouhou_in table.
//   Weight: collect all models. Length: first model. Price: min × 1.1.
//
// Includes Heddon brand (distributed by Smith in Japan).
// manufacturer_slug = 'smith' for all products.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SMITH_BASE = 'https://www.smith.jp';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Popper (before Pencil — Torpedo/Chug'n Spook are poppers)
  [/ポッパー|Popper|Torpedo|Chug|Pop'?n/i, 'ポッパー'],
  // Sinking pencil (before Pencil)
  [/シンキングペンシル|Sinking\s*Pencil/i, 'シンキングペンシル'],
  // Pencil bait / Spook / Zara
  [/ペンシル|Pencil|Spook|Zara|ザラ/i, 'ペンシルベイト'],
  // Vibration / Sonar
  [/バイブ|Vib|ソナー|Sonar/i, 'バイブレーション'],
  // Crank
  [/クランク|Crank/i, 'クランクベイト'],
  // Shad
  [/シャッド|Shad/i, 'シャッド'],
  // Minnow (D-Contact, Cherry Blood, Panish, Saruna etc.)
  [/ミノー|Minnow|D-コンタクト|D-Contact|D-Compact|D-Concept|D-Incite|Cherry\s*Blood|チェリーブラッド|パニッシュ|Panish|サラナ|Saruna|Haluca|ハルカ|Still|スティル|CB.*LL/i, 'ミノー'],
  // Metal jig (Masamune, Nagamasa, etc.)
  [/メタルジグ|Metal\s*Jig|マサムネ|Masamune|ナガマサ|Nagamasa|Misago|ミサゴ|TG\s*Slow|Bay\s*Blue/i, 'メタルジグ'],
  // Blade / spin tail
  [/ブレード|Blade|スピンテール/i, 'バイブレーション'],
  // Spoon (ARS, Pure, Bisen, Heaven, etc.)
  [/スプーン|Spoon|ARS|Pure|ピュア|Bisen|美泉|Heaven|ヘブン|Back\s*&\s*Forth|Edge\s*Dia|Drop\s*Dia|F-Select/i, 'スプーン'],
  // Spinner
  [/スピナー|Spinner|Niakis|ニアキス|AR-S|Hyper\s*Blade/i, 'スピナー'],
  // Jighead
  [/ジグヘッド|Jighead/i, 'ジグヘッド'],
  // Frog
  [/フロッグ|Frog|Strike\s*Frog/i, 'フロッグ'],
  // Crawler bait
  [/クローラー|Crawler|Crazy\s*Crawler/i, 'クローラーベイト'],
  // Buzzbait
  [/バズベイト|Buzzbait/i, 'バズベイト'],
  // Jig (after specific jig types)
  [/ジグ|Jig/i, 'メタルジグ'],
  // Worm / Soft bait ← ワームもルアーやろ？
  [/ワーム|Worm|Curly|Grub|Shrimp|シュリンプ|クロー|Craw|IMO|イモ|Swimmy/i, 'ワーム'],
  // Topwater (generic fallback)
  [/トップウォーター|Topwater|Bud|Moss\s*Boss/i, 'トップウォーター'],
];

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, category: string): string[] {
  var combined = (name + ' ' + category).toLowerCase();

  // Specific keywords in product name
  if (/メバル|mebaru|luna\s*mebaru/i.test(combined)) return ['メバル'];
  if (/アジ|aji|ace/i.test(combined) && /salt/i.test(category)) return ['アジ'];
  if (/青物|ヒラマサ|カンパチ|ブリ|gunship/i.test(combined)) return ['青物'];
  if (/ヒラメ|フラット/i.test(combined)) return ['ヒラメ', 'マゴチ'];
  if (/タチウオ/i.test(combined)) return ['タチウオ'];
  if (/チヌ|クロダイ|黒鯛/i.test(combined)) return ['クロダイ'];
  if (/イカ|エギ|egisharpner/i.test(combined)) return ['アオリイカ'];
  if (/マゴチ/i.test(combined)) return ['マゴチ'];
  if (/ナマズ|catfish/i.test(category)) return ['ナマズ'];

  // Category-based
  if (/trout/i.test(category)) return ['トラウト'];
  if (/heddon|bass/i.test(category)) return ['ブラックバス'];
  if (/salt/i.test(category)) return ['シーバス'];

  return ['シーバス'];
}

function detectType(name: string, specType: string): string {
  var combined = name + ' ' + specType;
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(combined)) return TYPE_KEYWORDS[i][1];
  }
  // If spec type mentions シンキング or フローティング, likely a minnow
  if (/シンキング|フローティング|サスペンド/i.test(specType)) return 'ミノー';
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log('[' + timestamp() + '] [smith] ' + message);
}

function slugFromUrl(url: string): string {
  // /product/trout/dcontact/dcontact.html → "trout-dcontact"
  var match = url.match(/\/product\/([^/]+)\/([^/]+)\//);
  if (match) return match[1] + '-' + match[2];
  // Fallback
  var parts = url.replace(/\.html$/, '').split('/');
  return parts.slice(-2).join('-') || 'unknown';
}

function categoryFromUrl(url: string): string {
  // /product/trout/dcontact/dcontact.html → "trout"
  var match = url.match(/\/product\/([^/]+)\//);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// Shared browser
// ---------------------------------------------------------------------------

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeSmithPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser = await getBrowser();
  var context = await browser.newContext();
  var page = await context.newPage();

  try {
    log('Navigating to ' + url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for main content
    await page.waitForSelector('.pro_toptext', { timeout: 10000 }).catch(function () {
      log('Warning: .pro_toptext not found within timeout');
    });

    var data = await page.evaluate(function () {
      var result: any = {};

      // --- Product name from title ---
      result.name = (document.title || '').trim();

      // --- Catch copy ---
      var catchEl = document.querySelector('.pro_toptext_komidashi span.tx12');
      result.catchCopy = catchEl ? (catchEl.textContent || '').trim() : '';

      // --- Description from .pro_toptext p.mb20 ---
      var descEl = document.querySelector('.pro_toptext p.mb20');
      result.description = descEl ? (descEl.textContent || '').trim() : '';

      // If no p.mb20, try any p inside .pro_toptext
      if (!result.description) {
        var altDescEl = document.querySelector('.pro_toptext p');
        result.description = altDescEl ? (altDescEl.textContent || '').trim() : '';
      }

      // --- Main image ---
      var mainImgEl = document.querySelector('.pro_topimg img');
      result.mainImage = mainImgEl ? mainImgEl.getAttribute('src') || '' : '';
      // Get absolute URL via .src property
      if (mainImgEl && (mainImgEl as HTMLImageElement).src) {
        result.mainImageAbs = (mainImgEl as HTMLImageElement).src;
      }

      // --- Spec tables: .pro_jouhou_in table ---
      result.specs = [];
      var jouhouDivs = document.querySelectorAll('.pro_jouhou_in');
      for (var j = 0; j < jouhouDivs.length; j++) {
        var spec: any = {};
        var rows = jouhouDivs[j].querySelectorAll('tr');
        for (var r = 0; r < rows.length; r++) {
          var cells = rows[r].querySelectorAll('td');
          if (cells.length >= 2) {
            var label = (cells[0].textContent || '').trim().toUpperCase();
            var value = (cells[1].textContent || '').trim();
            if (label === 'LENGTH') spec.length = value;
            if (label === 'WEIGHT') spec.weight = value;
            if (label === 'TYPE') spec.type = value;
            if (label === 'PRICE') spec.price = value;
            if (label === 'HOOK') spec.hook = value;
            if (label === 'RANGE') spec.range = value;
          }
        }
        if (spec.length || spec.weight || spec.price) {
          result.specs.push(spec);
        }
      }

      // --- Model names (b tags before spec tables) ---
      // The b tag right before .pro_jouhou contains model name like "D-コンタクト50"
      result.modelNames = [];
      var jouhouParents = document.querySelectorAll('.pro_jouhou');
      for (var jp = 0; jp < jouhouParents.length; jp++) {
        var prevSibling = jouhouParents[jp].previousElementSibling;
        // Walk back to find the text block containing the model name
        while (prevSibling) {
          var bEl = prevSibling.querySelector('b');
          if (bEl) {
            var bText = (bEl.textContent || '').trim();
            if (bText.length > 0) {
              result.modelNames.push(bText);
              break;
            }
          }
          prevSibling = prevSibling.previousElementSibling;
        }
      }

      // --- Colors ---
      result.colors = [];
      var colorDivs = document.querySelectorAll('.pro_content_color');
      for (var c = 0; c < colorDivs.length; c++) {
        var nameEl = colorDivs[c].querySelector('p.tx11');
        var imgEl = colorDivs[c].querySelector('a > img') || colorDivs[c].querySelector('img');
        var colorName = nameEl ? (nameEl.textContent || '').trim() : '';
        var colorImgSrc = '';
        if (imgEl) {
          colorImgSrc = (imgEl as HTMLImageElement).src || '';
        }
        if (colorName && colorImgSrc) {
          result.colors.push({ name: colorName, imageUrl: colorImgSrc });
        }
      }

      // --- Color group headers ---
      var colorHeaders = document.querySelectorAll('.pro_content_color_komidashi');
      result.colorGroupHeaders = [];
      for (var ch = 0; ch < colorHeaders.length; ch++) {
        result.colorGroupHeaders.push((colorHeaders[ch].textContent || '').trim());
      }

      return result;
    });

    // --- Post-process ---
    var productName = data.name || 'Unknown';
    var category = categoryFromUrl(url);
    var slug = slugFromUrl(url);

    log('Extracted: name="' + productName + '", category="' + category + '", specs=' + data.specs.length + ', colors=' + data.colors.length);

    // Parse specs from tables
    var weights: number[] = [];
    var lengths: number[] = [];
    var prices: number[] = [];
    var specTypes: string[] = [];

    for (var s = 0; s < data.specs.length; s++) {
      var spec = data.specs[s];

      // Weight: "4.5g" or "4.5ｇ" or multi "4.5g / 7g" or "3/4oz 13.0g"
      if (spec.weight) {
        var wParts = spec.weight.match(/([\d.]+)\s*[gｇ]/g);
        if (wParts) {
          for (var wi = 0; wi < wParts.length; wi++) {
            var wNum = parseFloat(wParts[wi]);
            if (wNum > 0 && weights.indexOf(wNum) < 0) weights.push(wNum);
          }
        }
        // Fallback: oz only (some Heddon don't have grams)
        if ((!wParts || wParts.length === 0) && /oz/i.test(spec.weight)) {
          var ozMatch = spec.weight.match(/([\d.]+)\s*oz/i);
          if (ozMatch) {
            var ozNum = parseFloat(ozMatch[1]) * 28.35;
            if (ozNum > 0) weights.push(Math.round(ozNum * 10) / 10);
          }
          // Also handle fractional oz: "3/4oz"
          var fracMatch = spec.weight.match(/(\d+)\/(\d+)\s*oz/i);
          if (fracMatch && weights.length === 0) {
            var fracOz = parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
            var fracG = Math.round(fracOz * 28.35 * 10) / 10;
            if (fracG > 0) weights.push(fracG);
          }
        }
      }

      // Length: "50mm" or "11.4cm" (Heddon uses cm) or "4-1/2inch 11.4cm"
      if (spec.length) {
        // Try mm first
        var lParts = spec.length.match(/([\d.]+)\s*(?:mm|㎜|ミリ)/g);
        if (lParts) {
          for (var li = 0; li < lParts.length; li++) {
            var lNum = parseFloat(lParts[li]);
            if (lNum > 0 && lengths.indexOf(lNum) < 0) lengths.push(lNum);
          }
        }
        // Fall back to cm (Heddon products: "11.4cm" → 114mm)
        if (!lParts || lParts.length === 0) {
          var cmParts = spec.length.match(/([\d.]+)\s*cm/g);
          if (cmParts) {
            for (var ci = 0; ci < cmParts.length; ci++) {
              var cmNum = parseFloat(cmParts[ci]);
              if (cmNum > 0) {
                var mmNum = Math.round(cmNum * 10);
                if (lengths.indexOf(mmNum) < 0) lengths.push(mmNum);
              }
            }
          }
        }
      }

      // Price: "￥1,750+税" or "￥640＋税" → tax-excluded
      if (spec.price) {
        var priceMatch = spec.price.match(/[￥¥]([\d,]+)/);
        if (priceMatch) {
          var pNum = parseInt(priceMatch[1].replace(/,/g, ''), 10);
          if (pNum > 0 && prices.indexOf(pNum) < 0) prices.push(pNum);
        }
      }

      // Type
      if (spec.type) {
        var t = spec.type.trim();
        if (t && specTypes.indexOf(t) < 0) specTypes.push(t);
      }
    }

    // Type detection
    var specTypeStr = specTypes.join(' ');
    var type = detectType(productName, specTypeStr);

    // Target fish
    var targetFish = detectTargetFish(productName, category);

    // Length: first model
    var length = lengths.length > 0 ? lengths[0] : null;

    // Price: minimum, tax-excluded → × 1.1 for tax-included
    var priceExcTax = prices.length > 0 ? Math.min.apply(null, prices) : 0;
    var price = priceExcTax > 0 ? Math.round(priceExcTax * 1.1) : 0;

    // Main image
    var mainImage = data.mainImageAbs || '';
    if (!mainImage && data.mainImage) {
      // Resolve relative path
      var pageBase = url.replace(/\/[^/]*$/, '/');
      mainImage = pageBase + data.mainImage;
    }

    // Colors
    var seenColors = new Set<string>();
    var colors: ScrapedColor[] = [];
    for (var c = 0; c < data.colors.length; c++) {
      var colorData = data.colors[c];
      var colorName = colorData.name;

      // Parse: "01.キンクロ" → "キンクロ"
      var colorMatch = colorName.match(/^[\d]+\.\s*(.+)$/);
      if (colorMatch) {
        colorName = colorMatch[1].trim();
      }

      if (seenColors.has(colorName)) continue;
      seenColors.add(colorName);

      if (colorData.imageUrl) {
        colors.push({
          name: colorName,
          imageUrl: colorData.imageUrl,
        });
      }
    }

    // Fallback main image from first color
    if (!mainImage && colors.length > 0) {
      mainImage = colors[0].imageUrl;
    }

    // Description: combine catch copy + description
    var description = '';
    if (data.catchCopy) description = data.catchCopy;
    if (data.description) {
      if (description) description += '\n';
      description += data.description;
    }
    if (description.length > 500) description = description.substring(0, 500);

    var result: ScrapedLure = {
      name: productName,
      name_kana: '',
      slug: slug,
      manufacturer: 'SMITH',
      manufacturer_slug: 'smith',
      type: type,
      target_fish: targetFish,
      description: description,
      price: price,
      colors: colors,
      weights: weights,
      length: length,
      mainImage: mainImage,
      sourceUrl: url,
    };

    log('Done: ' + productName + ' | type=' + type + ' | colors=' + colors.length + ' | weights=[' + weights.join(',') + '] | length=' + length + 'mm | price=' + price + ' (tax-incl) | fish=' + targetFish.join(','));

    return result;
  } finally {
    await context.close();
  }
}
