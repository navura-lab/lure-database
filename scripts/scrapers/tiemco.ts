// scripts/scrapers/tiemco.ts
// TIEMCO product page scraper
// Handles lure products from tiemco.co.jp/Form/Product/ProductDetail.aspx
//
// Site: ASP.NET Web Forms, UTF-8, no WAF.
// Structure:
//   - Product name: div.pc h2.itemname (desktop) or document.title
//   - Description: tabbed section under "商品説明" tab
//   - Main image: img#picture → /Contents/ProductImages/0/{PID}_LL.jpg
//   - Specs: plain text block (NOT table) "Length: 70mm Weight: 4g ..."
//   - Price: tax-included ¥2,640(本体価格¥2,400)
//   - Colors: select#ctl00_ContentPlaceHolder1_ddlVariationSelect
//   - Color images: /Contents/ProductImages/0/{PID}_var{VARCODE}_L.jpg
//   - Breadcrumb: category path for target_fish detection
//
// Brands under TIEMCO umbrella: ティムコルアーズ, PDL, Ocean Dominator, Critter Tackle
// manufacturer_slug = 'tiemco' for all products.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIEMCO_BASE = 'https://www.tiemco.co.jp';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  // Popper
  [/ポッパー|Popper/i, 'ポッパー'],
  // Sinking pencil (before Pencil)
  [/シンキングペンシル|Sinking\s*Pencil/i, 'シンキングペンシル'],
  // Pencil bait
  [/ペンシル|Pencil/i, 'ペンシルベイト'],
  // Prop bait (Stealth Pepper etc.)
  [/プロップ|Prop|ペッパー|Pepper/i, 'プロップベイト'],
  // Vibration
  [/バイブ|Vib/i, 'バイブレーション'],
  // Crankbait
  [/クランク|Crank|ダーター|Darter/i, 'クランクベイト'],
  // Shad
  [/シャッド|Shad(?!テール)/i, 'シャッド'],
  // Minnow
  [/ミノー|Minnow/i, 'ミノー'],
  // Metal jig
  [/メタルジグ|Metal\s*Jig/i, 'メタルジグ'],
  // Jig (rubber jig, jighead)
  [/ラバージグ|Rubber\s*Jig/i, 'ラバージグ'],
  // Spinnerbait
  [/スピナーベイト|Spinnerbait/i, 'スピナーベイト'],
  // Buzzbait
  [/バズベイト|Buzzbait/i, 'バズベイト'],
  // Chatterbait / bladed jig
  [/チャター|Chatter/i, 'チャターベイト'],
  // Wire bait (generic)
  [/ワイヤーベイト|Wire\s*Bait/i, 'スピナーベイト'],
  // Frog
  [/フロッグ|Frog|ガエル|ネズミ/i, 'フロッグ'],
  // Crawler bait
  [/クローラー|Crawler|ハッタ/i, 'クローラーベイト'],
  // Swimbait
  [/スイムベイト|Swimbait/i, 'スイムベイト'],
  // Big bait
  [/ビッグベイト|Big\s*Bait/i, 'ビッグベイト'],
  // Spoon
  [/スプーン|Spoon/i, 'スプーン'],
  // Spinner
  [/スピナー|Spinner/i, 'スピナー'],
  // Worm / Soft bait ← ワームもルアーやろ？
  [/ワーム|Worm|シャッドテール|リビングフィッシュ|ホバリング|バグ|フライ|チューブ|クロー|エッグ|シュリンプ|グラブ/i, 'ワーム'],
  // Topwater (generic fallback)
  [/トップウォーター|Topwater|セミ|ムシ|虫/i, 'トップウォーター'],
];

// ---------------------------------------------------------------------------
// Target fish detection from breadcrumb/category
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, catCode: string): string[] {
  // Category code based — most reliable for TIEMCO (catCode from URL)
  // Check catCode FIRST to avoid false positives from sidebar nav text
  if (catCode.startsWith('002005')) return ['雷魚'];           // Snakehead
  if (catCode.startsWith('002004')) return ['アユ'];           // Ayu
  if (catCode.startsWith('002002')) return ['トラウト'];       // Trout

  // Name-based overrides for bass sub-categories (cat=002001*)
  var nameLower = name.toLowerCase();
  if (/メバル|mebaru/i.test(nameLower)) return ['メバル'];
  if (/ナマズ|catfish/i.test(nameLower)) return ['ナマズ'];
  if (/シーバス|seabass/i.test(nameLower)) return ['シーバス'];

  if (catCode.startsWith('002001')) return ['ブラックバス'];   // Bass

  return ['ブラックバス']; // Default for TIEMCO (primarily a bass brand)
}

function detectType(name: string, specType: string, catCode: string): string {
  var combined = name + ' ' + specType;
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(combined)) return TYPE_KEYWORDS[i][1];
  }
  // If spec type mentions Floating/Sinking, likely a minnow
  if (/Floating|Sinking|Suspend/i.test(specType)) return 'ミノー';
  // Category hints: 002001004 = Bass Soft Lures
  if (catCode.startsWith('002001004')) return 'ワーム';
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log('[' + timestamp() + '] [tiemco] ' + message);
}

function pidFromUrl(url: string): string {
  var match = url.match(/[?&]pid=(\d+)/);
  return match ? match[1] : '';
}

function catFromUrl(url: string): string {
  var match = url.match(/[?&]cat=(\d+)/);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// Shared browser
// ---------------------------------------------------------------------------

var _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeTiemcoPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser = await getBrowser();
  var context = await browser.newContext();
  var page = await context.newPage();

  try {
    log('Navigating to ' + url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for product name to appear
    await page.waitForSelector('h2.itemname', { timeout: 10000 }).catch(function () {
      log('Warning: h2.itemname not found within timeout');
    });

    // Small delay for ASP.NET rendering
    await new Promise(function (r) { setTimeout(r, 1000); });

    var data = await page.evaluate(function () {
      var result: any = {};

      // --- Product name ---
      // Use div.pc h2.itemname (desktop version)
      var pcDiv = document.querySelector('div.pc');
      var nameEl = pcDiv ? pcDiv.querySelector('h2.itemname') : document.querySelector('h2.itemname');
      result.name = nameEl ? (nameEl.textContent || '').trim() : '';
      if (!result.name) {
        // Fallback to title
        result.name = (document.title || '').replace(/\s*\|.*$/, '').trim();
      }

      // --- English name / subtitle ---
      // Usually the element right after h2.itemname
      if (nameEl && nameEl.nextElementSibling) {
        var engText = (nameEl.nextElementSibling.textContent || '').trim();
        // Sanity: should look like English text, not a price or long description
        if (engText.length < 80 && /[a-zA-Z]/.test(engText)) {
          result.englishName = engText;
        }
      }

      // --- Main image ---
      var mainImgEl = document.querySelector('img#picture');
      if (mainImgEl) {
        result.mainImage = mainImgEl.getAttribute('src') || '';
        result.mainImageAbs = (mainImgEl as HTMLImageElement).src || '';
      }

      // --- Breadcrumb ---
      var breadcrumbs = document.querySelectorAll('.breadcrumb a, .breadcrumb span, .pankuzu a, .pankuzu span');
      var breadcrumbParts: string[] = [];
      for (var b = 0; b < breadcrumbs.length; b++) {
        var bText = (breadcrumbs[b].textContent || '').trim();
        if (bText) breadcrumbParts.push(bText);
      }
      // Also try generic breadcrumb pattern
      if (breadcrumbParts.length === 0) {
        var allLinks = document.querySelectorAll('a[href*="ProductList.aspx"]');
        for (var al = 0; al < allLinks.length; al++) {
          var linkText = (allLinks[al].textContent || '').trim();
          if (linkText && linkText !== 'HOME' && breadcrumbParts.indexOf(linkText) < 0) {
            breadcrumbParts.push(linkText);
          }
        }
      }
      result.breadcrumb = breadcrumbParts.join(' > ');

      // --- Description ---
      // Try .detail2 .content first, but filter out CSS/script content
      var descEl = document.querySelector('.detail2 .content');
      var rawDesc = descEl ? (descEl.textContent || '').trim() : '';
      // Filter: if it looks like CSS or JS, skip it
      if (rawDesc && !/^\s*[.#@{]|^\s*\/\*|max-width|margin:|padding:|font-size/i.test(rawDesc)) {
        result.description = rawDesc;
      } else {
        result.description = '';
      }

      // If empty, try tab content areas
      if (!result.description) {
        var tabContents = document.querySelectorAll('.tab-content, .tabContent, [role="tabpanel"]');
        for (var tc = 0; tc < tabContents.length; tc++) {
          var tcText = (tabContents[tc].textContent || '').trim();
          if (tcText.length > 30 && !/Length[：:]|Weight[：:]|Type[：:]|Price/i.test(tcText.substring(0, 50))
              && !/^\s*[.#@{]|max-width|margin:|padding:/i.test(tcText)) {
            result.description = tcText;
            break;
          }
        }
      }

      // Try meta description as fallback
      if (!result.description) {
        var metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          result.description = metaDesc.getAttribute('content') || '';
        }
      }

      // Last resort: look for paragraphs with substantial Japanese text
      if (!result.description) {
        var allParagraphs = document.querySelectorAll('p, div.description, div.detail');
        for (var ap = 0; ap < allParagraphs.length; ap++) {
          var apText = (allParagraphs[ap].textContent || '').trim();
          // Must have Japanese characters and be substantial (>50 chars)
          if (apText.length > 50 && /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(apText)
              && !/max-width|margin:|padding:|font-size/i.test(apText)
              && !/Length[：:]|Weight[：:]/i.test(apText.substring(0, 50))) {
            result.description = apText;
            break;
          }
        }
      }

      // --- Spec text ---
      // Specs are in a plain text block, not a table
      // Look for text containing "Length:" and "Weight:"
      result.specText = '';

      // Try all generic elements for spec text
      // Note: TIEMCO uses both ASCII ":" and full-width "：" in specs
      var allElements = document.querySelectorAll('div, p, span, td');
      for (var se = 0; se < allElements.length; se++) {
        var elText = (allElements[se].textContent || '').trim();
        if (/Length\s*[：:]/i.test(elText) && /Weight\s*[：:]/i.test(elText) && elText.length < 500) {
          result.specText = elText;
          break;
        }
      }

      // --- Price ---
      // Look for ¥N,NNN pattern (tax-included)
      result.priceText = '';

      // Try hidden inputs first (more reliable)
      var hiddenInputs = document.querySelectorAll('input[type="hidden"]');
      for (var hi = 0; hi < hiddenInputs.length; hi++) {
        var hVal = (hiddenInputs[hi] as HTMLInputElement).value || '';
        if (/^¥[\d,]+$/.test(hVal)) {
          result.priceText = hVal;
          break;
        }
      }

      // Try visible price text
      if (!result.priceText) {
        for (var pe = 0; pe < allElements.length; pe++) {
          var peText = (allElements[pe].textContent || '').trim();
          // Match ¥2,640 or ¥2,640(本体価格¥2,400)
          if (/^¥[\d,]+(（|[\(])/.test(peText) || /^¥[\d,]+$/.test(peText)) {
            if (peText.length < 50) {
              result.priceText = peText;
              break;
            }
          }
        }
      }

      // --- Color variations from dropdown ---
      result.colors = [];
      var ddl = document.querySelector('select[id*="ddlVariationSelect"]');
      if (ddl) {
        var options = ddl.querySelectorAll('option');
        for (var o = 0; o < options.length; o++) {
          var optText = (options[o].textContent || '').trim();
          var optValue = (options[o] as HTMLOptionElement).value || '';
          if (!optValue || optValue === '') continue;
          // Skip "選択してください" placeholder
          if (/選択/.test(optText)) continue;

          result.colors.push({
            text: optText,
            value: optValue,
          });
        }
      }

      // --- Color images from variation grid ---
      result.colorImages = [];
      var varImgs = document.querySelectorAll('[id*="rVariation"] img, .rVariation img');
      for (var vi = 0; vi < varImgs.length; vi++) {
        var viSrc = (varImgs[vi] as HTMLImageElement).src || '';
        if (viSrc) {
          result.colorImages.push(viSrc);
        }
      }

      // --- Product code ---
      result.productCode = '';
      for (var pc = 0; pc < allElements.length; pc++) {
        var pcText = (allElements[pc].textContent || '').trim();
        if (/^商品コード[：:]/.test(pcText)) {
          result.productCode = pcText.replace(/^商品コード[：:]\s*/, '');
          break;
        }
      }

      return result;
    });

    // --- Post-process ---
    var pid = pidFromUrl(url);
    var catCode = catFromUrl(url);
    var productName = data.name || 'Unknown';

    log('Extracted: name="' + productName + '", pid=' + pid + ', cat=' + catCode + ', colors=' + data.colors.length);

    // Parse spec text: "Length: 70mm Weight: 4g Class Type: Slow Floating"
    // or full-width: "Length：70mm Weight：3.4g class Type：Floating"
    var specText = data.specText || '';
    var weights: number[] = [];
    var length: number | null = null;
    var specType = '';

    // Length (supports both : and ：)
    var lengthMatch = specText.match(/Length\s*[：:]\s*([\d.]+)\s*mm/i);
    if (lengthMatch) {
      length = parseFloat(lengthMatch[1]);
    }

    // Weight: "4g" or "4g class" or "3.5g" (supports both : and ：)
    var weightMatch = specText.match(/Weight\s*[：:]\s*([\d.]+)\s*g/i);
    if (weightMatch) {
      var w = parseFloat(weightMatch[1]);
      if (w > 0) weights.push(w);
    }

    // Type: "Type: Slow Floating" or "Class Type: Slow Floating" or "Type：Floating"
    var typeMatch = specText.match(/(?:Class\s*)?Type\s*[：:]\s*([^\n\r]+?)(?:\s*(?:推奨|ring|hook|Qty|count|$))/i);
    if (typeMatch) {
      specType = typeMatch[1].trim();
    }
    // Simpler fallback
    if (!specType) {
      var typeMatch2 = specText.match(/Type\s*[：:]\s*(\S+(?:\s+\S+)?)/i);
      if (typeMatch2) {
        specType = typeMatch2[1].trim();
      }
    }

    // Type detection
    var type = detectType(productName, specType, catCode);

    // Target fish
    var targetFish = detectTargetFish(productName, catCode);

    // Price: parse tax-included from "¥2,640" or "¥2,640(本体価格¥2,400)"
    var price = 0;
    if (data.priceText) {
      var priceMatch = data.priceText.match(/¥([\d,]+)/);
      if (priceMatch) {
        price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      }
    }

    // Main image: resolve relative to absolute
    var mainImage = data.mainImageAbs || '';
    if (!mainImage && data.mainImage) {
      mainImage = TIEMCO_BASE + data.mainImage;
    }
    // Ensure we use _LL.jpg (largest) for main image
    if (mainImage && !/_LL\.jpg/i.test(mainImage)) {
      mainImage = mainImage.replace(/_[ML]\.jpg/i, '_LL.jpg');
    }

    // Colors: parse from dropdown options
    // Format: "ステルスペッパー70SF-R #279 ギンワカ - 在庫なし"
    var seenColorNames = new Set<string>();
    var colors: ScrapedColor[] = [];

    for (var c = 0; c < data.colors.length; c++) {
      var colorEntry = data.colors[c];
      var colorText = colorEntry.text;
      var colorValue = colorEntry.value;

      // Parse color name from dropdown text
      // Formats observed:
      //   "ステルスペッパー70SF-R #279 ギンワカ - 在庫なし" → "ギンワカ"
      //   "ヴィクセン70Ｆ 114アカキン" → "アカキン"
      //   "Cダーター50R #004 ボウソウブリリアントパール" → "ボウソウブリリアントパール"
      var colorName = '';
      var colorCode = '';

      // Try pattern with #NNN first
      var colorNameMatch = colorText.match(/#(\d+)\s+(.+?)(?:\s*-\s*(?:在庫|SOLD|売り切れ).*)?$/i);
      if (colorNameMatch) {
        colorCode = colorNameMatch[1];
        colorName = colorNameMatch[2].trim();
      }

      // Try pattern without # — "ProductName NNNColorName"
      // Match the last number-then-Japanese-text sequence
      if (!colorName) {
        var altMatch = colorText.match(/\s(\d{2,4})([^\d\s].+?)(?:\s*-\s*(?:在庫|SOLD|売り切れ).*)?$/i);
        if (altMatch) {
          colorCode = altMatch[1];
          colorName = altMatch[2].trim();
        }
      }

      // Last resort: strip known product name prefix + stock status
      if (!colorName) {
        colorName = colorText.replace(/\s*-\s*(?:在庫|SOLD|売り切れ).*$/i, '').trim();
        // Try to extract just the color part after the last space-separated number
        var lastNumIdx = colorName.search(/\d+[^\d]*$/);
        if (lastNumIdx > 0) {
          var afterNum = colorName.substring(lastNumIdx).replace(/^\d+/, '');
          if (afterNum.length > 0) colorName = afterNum;
        }
      }

      if (seenColorNames.has(colorName)) continue;
      seenColorNames.add(colorName);

      // Build color image URL
      // Pattern: /Contents/ProductImages/0/{PID}_var{VARCODE}_L.jpg
      // The VARCODE is the suffix of the option value after the PID part
      var varCode = '';
      if (colorValue && pid) {
        // Option value like "300901870279" → varCode = everything after PID
        // But PID can be variable length. Try to extract var code from option value
        if (colorValue.startsWith(pid)) {
          varCode = colorValue.substring(pid.length);
        } else {
          // Use the full option value
          varCode = colorValue;
        }
      }

      var colorImageUrl = '';
      if (varCode && pid) {
        colorImageUrl = TIEMCO_BASE + '/Contents/ProductImages/0/' + pid + '_var' + varCode + '_L.jpg';
      } else if (data.colorImages && data.colorImages[c]) {
        colorImageUrl = data.colorImages[c];
      }

      if (colorName) {
        colors.push({
          name: colorName,
          imageUrl: colorImageUrl,
        });
      }
    }

    // Fallback main image from first color
    if (!mainImage && colors.length > 0 && colors[0].imageUrl) {
      mainImage = colors[0].imageUrl;
    }

    // If still no main image, construct from PID
    if (!mainImage && pid) {
      mainImage = TIEMCO_BASE + '/Contents/ProductImages/0/' + pid + '_LL.jpg';
    }

    // Description: truncate to 500 chars
    var description = (data.description || '').trim();
    if (description.length > 500) description = description.substring(0, 500);

    // Slug: use PID
    var slug = pid || data.productCode || 'unknown';

    var result: ScrapedLure = {
      name: productName,
      name_kana: '',
      slug: slug,
      manufacturer: 'TIEMCO',
      manufacturer_slug: 'tiemco',
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

    log('Done: ' + productName + ' | type=' + type + ' | colors=' + colors.length + ' | weights=[' + weights.join(',') + '] | length=' + length + 'mm | price=¥' + price + ' | fish=' + targetFish.join(','));

    return result;
  } finally {
    await context.close();
  }
}
