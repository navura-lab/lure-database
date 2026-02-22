// scripts/scrapers/zipbaits.ts
// ZIPBAITS product page scraper
// Handles lure products from zipbaits.com/item/?i={id}
//
// Site: Custom PHP, no CMS, no jQuery, server-rendered HTML.
// Structure:
//   - Product name: title tag → "{商品名} | {カテゴリ} | 製品情報 | ZIPBAITS ジップベイツ"
//   - Category: title tag second segment (シーバス, トラウト, etc.)
//   - Main content: #colorArea
//   - Spec data: .item > div > div > p (inline text: サイズ, ウェイト, 価格, タイプ)
//   - Colors: #colorArea .color article (p = name, .img img = image)
//   - Main image: .item > div > div img (first model photo)
//   - Description: .subject + .body text
//   - Images: /_websystem4item1/webroot/attach/items/... (main)
//              /_websystem4item1/webroot/attach/itemcolors/... (colors)
//   - Prices: ￥1,958（税抜￥1,780） format → tax-included
//
// One page may contain multiple model variants (e.g., 15HD-F / 15HD-S)
// with shared or separate color charts per model group.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZB_BASE = 'https://www.zipbaits.com';

// ---------------------------------------------------------------------------
// Type detection based on product name + spec type field
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  // Popper
  [/ポッパー|Popper/i, 'ポッパー'],
  // Pencil
  [/ペンシル|Pencil/i, 'ペンシルベイト'],
  // Sinking pencil
  [/シンキングペンシル|Sinking\s*Pencil/i, 'シンキングペンシル'],
  // Vibration
  [/バイブ|Vib|Vibration/i, 'バイブレーション'],
  // Crank
  [/クランク|Crank/i, 'クランクベイト'],
  // Shad
  [/シャッド|Shad/i, 'シャッド'],
  // Minnow (broad — catch after more specific types)
  [/ミノー|Minnow|System\s*Minnow|Rigge|リッジ|Orbit|オービット|ZBL/i, 'ミノー'],
  // Metal jig
  [/メタルジグ|Metal\s*Jig/i, 'メタルジグ'],
  // Blade bait / spin tail
  [/ブレード|Blade|スピンテール/i, 'バイブレーション'],
  // Spoon
  [/スプーン|Spoon/i, 'スプーン'],
  // Jighead
  [/ジグヘッド|Jighead/i, 'ジグヘッド'],
  // Jig (after metal jig and jighead to avoid false matches)
  [/ジグ|Jig/i, 'メタルジグ'],
  // Worm / Soft bait ← ワームもルアーやろ？
  [/ワーム|Worm/i, 'ワーム'],
  // Topwater (generic fallback)
  [/トップウォーター|Topwater/i, 'トップウォーター'],
];

// ---------------------------------------------------------------------------
// Target fish detection from category + product name
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, category: string): string[] {
  var combined = (name + ' ' + category).toLowerCase();

  // Specific fish keywords in product name (override category)
  if (/青物|ヒラマサ|カンパチ|ブリ/.test(combined)) return ['青物'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ', 'マゴチ'];
  if (/タチウオ/.test(combined)) return ['タチウオ'];
  if (/メバル|ロック/.test(combined)) return ['メバル'];
  if (/アジ/.test(combined)) return ['アジ', 'メバル'];
  if (/チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];

  // Category-based mapping (シーバス before バス to avoid false match)
  if (/trout|トラウト/.test(combined)) return ['トラウト'];
  if (/kurodai|クロダイ/.test(combined)) return ['クロダイ'];
  if (/light\s*salt|ライトソルト/.test(combined)) return ['メバル', 'アジ'];
  if (/sea\s*bass|シーバス/.test(combined)) return ['シーバス'];
  if (/bass|バス/.test(combined)) return ['ブラックバス'];

  // Default: seabass (ZIPBAITS is primarily a saltwater brand)
  return ['シーバス'];
}

function detectType(name: string, specType: string): string {
  // Check spec type field first (e.g., "フローティング", "シンキング" → not useful alone)
  // But some spec types are specific enough
  var combined = name + ' ' + specType;
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(combined)) return TYPE_KEYWORDS[i][1];
  }
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log('[' + timestamp() + '] [zipbaits] ' + message);
}

function idFromUrl(url: string): string {
  // /item/?i=23 → "23"
  var match = url.match(/[?&]i=(\d+)/);
  if (match) return match[1];
  // Fallback: last numeric segment
  var numMatch = url.match(/(\d+)\s*$/);
  return numMatch ? numMatch[1] : 'unknown';
}

function resolveUrl(src: string): string {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('../')) return ZB_BASE + '/' + src.replace(/^\.\.\//g, '');
  if (src.startsWith('/')) return ZB_BASE + src;
  return ZB_BASE + '/' + src;
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

export async function scrapeZipbaitsPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser = await getBrowser();
  var context = await browser.newContext();
  var page = await context.newPage();

  try {
    log('Navigating to ' + url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for main content area and colors to be present
    await page.waitForSelector('#colorArea .item', { timeout: 10000 }).catch(function () {
      log('Warning: #colorArea .item not found within timeout');
    });
    await page.waitForSelector('#colorArea .color article', { timeout: 5000 }).catch(function () {
      log('Warning: #colorArea .color article not found within timeout');
    });

    var data = await page.evaluate(function () {
      var result: any = {};

      // --- Title tag: "{商品名} | {カテゴリ} | 製品情報 | ZIPBAITS ジップベイツ" ---
      var titleParts = document.title.split('|');
      result.name = titleParts.length > 0 ? titleParts[0].trim() : '';
      result.category = titleParts.length > 1 ? titleParts[1].trim() : '';

      // --- Main content area ---
      var colorArea = document.querySelector('#colorArea');
      if (!colorArea) {
        result.models = [];
        result.colors = [];
        result.subject = '';
        result.body = '';
        result.mainImage = '';
        return result;
      }

      // --- Description: .subject + .body ---
      var subjectEl = colorArea.querySelector('.subject');
      result.subject = subjectEl ? (subjectEl.textContent || '').trim() : '';

      var bodyEl = colorArea.querySelector('.body');
      result.body = bodyEl ? (bodyEl.textContent || '').trim() : '';

      // --- Models from .item p elements ---
      // Structure: .item > div (wrapper) > div (inner) > [div (img), p (specs)]
      // Each p contains a complete model's specs as inline text.
      // Multiple models separated by BR between wrapper divs.
      result.models = [];
      var itemEl = colorArea.querySelector('.item');
      if (itemEl) {
        var pEls = itemEl.querySelectorAll('p');
        for (var mp = 0; mp < pEls.length; mp++) {
          var pText = (pEls[mp].textContent || '').trim();
          if (pText.length < 10) continue; // Skip empty/trivial p elements

          var model: any = {};
          model.specText = pText;

          // Get sibling/nearby image: the p's parent div should also have an img
          var parentDiv = pEls[mp].parentElement;
          var imgEl = parentDiv ? parentDiv.querySelector('img') : null;
          model.imageUrl = imgEl ? (imgEl.getAttribute('src') || '') : '';

          result.models.push(model);
        }
      }

      // --- Colors from .color article elements ---
      result.colors = [];
      var articles = colorArea.querySelectorAll('.color article');
      for (var a = 0; a < articles.length; a++) {
        var article = articles[a];

        // Color name from p element: "269 ウォーターアルモニー"
        var nameEl = article.querySelector('p');
        var colorText = nameEl ? (nameEl.textContent || '').trim() : '';

        // Color image from .img img or just img
        var colorImg = article.querySelector('.img img') || article.querySelector('img');
        var colorImgSrc = colorImg ? (colorImg.getAttribute('src') || '') : '';

        if (colorText && colorImgSrc) {
          result.colors.push({
            text: colorText,
            imageUrl: colorImgSrc,
          });
        }
      }

      // --- Main image: .logo img (product logo/main photo) ---
      result.mainImage = '';
      var logoImg = colorArea.querySelector('.logo img');
      if (logoImg) {
        var logoSrc = logoImg.getAttribute('src') || '';
        // Skip SVGs (logo graphics, not product photos)
        if (logoSrc && logoSrc.indexOf('.svg') < 0) {
          result.mainImage = logoSrc;
        }
      }

      return result;
    });

    // --- Post-process ---
    var productName = data.name || 'Unknown';
    var category = data.category || '';

    log('Extracted: name="' + productName + '", category="' + category + '", models=' + data.models.length + ', colors=' + data.colors.length);

    // Slug from URL ID
    var slug = idFromUrl(url);

    // Parse specs from model text blocks
    var weights: number[] = [];
    var lengths: number[] = [];
    var prices: number[] = [];
    var specTypes: string[] = [];
    var mainImage = '';

    for (var m = 0; m < data.models.length; m++) {
      var model = data.models[m];
      var specText = model.specText || '';

      // Weight: "ウェイト：4.5g" or "ウェイト：30g" or multiple "4.5g/6.5g"
      var weightMatches = specText.match(/ウェイト[：:]\s*(.+)/);
      if (weightMatches) {
        var wLine = weightMatches[1];
        var wParts = wLine.match(/([\d.]+)\s*g/g);
        if (wParts) {
          for (var wi = 0; wi < wParts.length; wi++) {
            var wNum = parseFloat(wParts[wi]);
            if (wNum > 0 && weights.indexOf(wNum) < 0) weights.push(wNum);
          }
        }
      }

      // Length: "サイズ：70mm" or "サイズ：93㎜" or "サイズ：70mm/50mm"
      var lengthMatches = specText.match(/サイズ[：:]\s*(.+)/);
      if (lengthMatches) {
        var lLine = lengthMatches[1];
        // Match mm, ㎜ (U+339C fullwidth), or ミリ
        var lParts = lLine.match(/([\d.]+)\s*(?:mm|㎜|ミリ)/g);
        if (lParts) {
          for (var li = 0; li < lParts.length; li++) {
            var lNum = parseFloat(lParts[li]);
            if (lNum > 0 && lengths.indexOf(lNum) < 0) lengths.push(lNum);
          }
        }
      }

      // Price: "￥1,958（税抜￥1,780）" → 1958 (tax-included)
      var priceMatches = specText.match(/￥([\d,]+)（税抜/g);
      if (priceMatches) {
        for (var pri = 0; pri < priceMatches.length; pri++) {
          var pMatch = priceMatches[pri].match(/￥([\d,]+)/);
          if (pMatch) {
            var pNum = parseInt(pMatch[1].replace(/,/g, ''), 10);
            if (pNum > 0 && prices.indexOf(pNum) < 0) prices.push(pNum);
          }
        }
      }
      // Also try standalone ￥ pattern (some pages have different format)
      if (prices.length === 0) {
        var altPriceMatches = specText.match(/[￥¥]([\d,]+)/g);
        if (altPriceMatches) {
          for (var api = 0; api < altPriceMatches.length; api++) {
            var apMatch = altPriceMatches[api].match(/[￥¥]([\d,]+)/);
            if (apMatch) {
              var apNum = parseInt(apMatch[1].replace(/,/g, ''), 10);
              if (apNum > 0 && prices.indexOf(apNum) < 0) prices.push(apNum);
            }
          }
        }
      }

      // Type from spec: "タイプ：フローティング"
      var typeMatch = specText.match(/タイプ[：:]\s*(.+)/);
      if (typeMatch) {
        var t = typeMatch[1].trim().split(/[\s　]/)[0]; // First word only
        if (t && specTypes.indexOf(t) < 0) specTypes.push(t);
      }

      // Main image: use first model's image
      if (!mainImage && model.imageUrl) {
        mainImage = resolveUrl(model.imageUrl);
      }
    }

    // Resolve main image from data.mainImage if models didn't have one
    if (!mainImage && data.mainImage) {
      mainImage = resolveUrl(data.mainImage);
    }

    // Type detection: combine product name + spec type fields
    var specTypeStr = specTypes.join(' ');
    var type = detectType(productName, specTypeStr);

    // Target fish from category
    var targetFish = detectTargetFish(productName, category);

    // Length: use first (smallest) size as representative
    var length = lengths.length > 0 ? lengths[0] : null;

    // Price: use minimum price
    var price = prices.length > 0 ? Math.min.apply(null, prices) : 0;

    // Process colors: parse name and resolve URLs
    var seenColors = new Set<string>();
    var colors: ScrapedColor[] = [];
    for (var c = 0; c < data.colors.length; c++) {
      var colorData = data.colors[c];
      var colorText = colorData.text;
      var colorName = colorText;

      // Parse: "269 ウォーターアルモニー" → "ウォーターアルモニー"
      // Pattern: {number(s)} {name} or {code} {name}
      var colorMatch = colorText.match(/^[\dA-Za-z]+[\s　]+(.+)$/);
      if (colorMatch) {
        colorName = colorMatch[1].trim();
      }

      // Resolve image URL
      var imageUrl = resolveUrl(colorData.imageUrl);

      // Deduplicate by color name
      if (seenColors.has(colorName)) continue;
      seenColors.add(colorName);

      if (imageUrl) {
        colors.push({
          name: colorName,
          imageUrl: imageUrl,
        });
      }
    }

    // Fallback main image from first color
    if (!mainImage && colors.length > 0) {
      mainImage = colors[0].imageUrl;
    }

    // Description: combine subject + body
    var description = '';
    if (data.subject) description = data.subject;
    if (data.body) {
      if (description) description += ' ';
      description += data.body;
    }
    if (description.length > 500) description = description.substring(0, 500);

    var result: ScrapedLure = {
      name: productName,
      name_kana: '',
      slug: slug,
      manufacturer: 'ZIPBAITS',
      manufacturer_slug: 'zipbaits',
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

    log('Done: ' + productName + ' | type=' + type + ' | colors=' + colors.length + ' | weights=[' + weights.join(',') + '] | length=' + length + 'mm | price=' + price + ' | fish=' + targetFish.join(','));

    return result;
  } finally {
    await context.close();
  }
}
