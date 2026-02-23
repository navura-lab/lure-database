// scripts/scrapers/nories.ts
// Nories (ノリーズ) product page scraper
// Handles lure products from nories.com/bass/, nories.com/salt/, trout.nories.com/products/
//
// Site: WordPress 6.9 + custom theme, server-side rendered HTML.
// Server: nginx, NO WAF/CDN, HTTPS OK.
// Encoding: UTF-8
// Price: tax-excluded (税抜き) → multiply by 1.1 for tax-included.
// Spec formats:
//   1. Single model: th.w50p / td pairs (Length, Weight, Price)
//   2. Multi-model columnar: header row with model names, then rows per spec
//   3. Wire baits: Weight/Blade/Price columns with multiple oz rows
//   4. Trout: Weight/Price table (spoons), or standard th/td (cranks)
// Colors:
//   - Simple grid: <td> with <img> + text node (code + name)
//   - Matrix: header row with model names, first <td> has image+name, rest have ✓/–
//   - Image URLs: WP thumbnails with -300xN suffix → remove for full size

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var OZ_TO_GRAMS = 28.3495;

// ---------------------------------------------------------------------------
// Type detection from product name + category
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/プロップ|PROP/i, 'プロップベイト'],
  [/バイブ|VIB/i, 'バイブレーション'],
  [/クランク|CRANK|PUPA|SQUARE|HIRA\s*CRANK/i, 'クランクベイト'],
  [/シャッド|SHAD|JETTY/i, 'シャッド'],
  [/ミノー|MINNOW|LAYDOWN/i, 'ミノー'],
  [/スピナーベイト|SPINNER\s*BAIT|CRYSTAL\s*S|SHALLOW\s*ROLL|SUPER\s*SLOW\s*ROLL|DEEPER\s*RANGE|POWER\s*ROLL/i, 'スピナーベイト'],
  [/バズベイト|BUZZ\s*BAIT/i, 'バズベイト'],
  [/チャター|CHATTER|HULA\s*CHAT/i, 'チャターベイト'],
  [/フロッグ|FROG|FUKA[\s-]?BAIT|PADTUE/i, 'フロッグ'],
  [/クローラー|CRAWLER|WASHER/i, 'クローラーベイト'],
  [/スイムベイト|SWIM\s*BAIT/i, 'スイムベイト'],
  [/ビッグベイト|BIG\s*BAIT|BIHADOU/i, 'ビッグベイト'],
  [/ジグ|JIG|TAC[\s-]?JIG|DAIRAKKA|METAL\s*WASAB/i, 'ラバージグ'],
  [/メタルジグ|METAL\s*JIG/i, 'メタルジグ'],
  [/スプーン|SPOON|鱒玄人|MASUKUROUTO|MEET|RICE|RUSH\s*BELL|SWEEK|BOTTOM\s*CHOPPER|FUKADAMA/i, 'スプーン'],
  [/ESCAPE|エスケープ|FLIP[\s-]?GILL|ROCK[\s-]?CLAW|RING[\s-]?MAX|SHRILPIN|LADY|LATTERIE|FRONT[\s-]?FLAPPER|FLIP[\s-]?DOM|SANSUN|HASSUN|SANKAKU|SWITCH[\s-]?ON|MARUNOMI|SINGLE[\s-]?CONTROL|CLIONEX/i, 'ワーム'],
  [/GILL\s*TOP|JOINT/i, 'クローラーベイト'],
  [/WIND\s*RANGE/i, 'スピナーベイト'],
  [/SHOT[\s-]?OVER|SHOT[\s-]?STORMY|WORMING\s*CRANK|SHOT[\s-]?OMEGA|TADAMAKI|COMPLETE|HIRA[\s-]?TOP/i, 'クランクベイト'],
  [/TG[\s-]?RATTLIN/i, 'バイブレーション'],
];

// Soft bait detection for category-based type detection
var SOFT_BAIT_CATEGORY = /soft[\s-]?baits/i;
var WIRE_BAIT_CATEGORY = /wire[\s-]?baits/i;
var JIG_BAIT_CATEGORY = /jig[\s-]?baits/i;

function detectType(name: string, category: string): string {
  // Category-based first (more reliable)
  if (SOFT_BAIT_CATEGORY.test(category)) return 'ワーム';
  if (WIRE_BAIT_CATEGORY.test(category)) return 'スピナーベイト';
  if (JIG_BAIT_CATEGORY.test(category)) return 'ラバージグ';

  // Name-based keywords
  for (var [re, type] of TYPE_KEYWORDS) {
    if (re.test(name)) return type;
  }
  return 'その他';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(url: string): string[] {
  if (url.includes('trout.nories.com')) return ['トラウト'];
  if (url.includes('/salt/')) return ['シーバス'];
  return ['ブラックバス'];
}

// ---------------------------------------------------------------------------
// oz → gram conversion (for wire baits like 3/8oz., 1/2oz.)
// ---------------------------------------------------------------------------

function parseOzToGrams(ozStr: string): number {
  var cleaned = ozStr.replace(/oz\.?\s*$/i, '').trim();
  // Fractional: "3/8"
  var fracMatch = cleaned.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    return Math.round((parseInt(fracMatch[1]) / parseInt(fracMatch[2])) * OZ_TO_GRAMS * 10) / 10;
  }
  // Mixed: "1-3/8"
  var mixedMatch = cleaned.match(/^(\d+)[- ](\d+)\/(\d+)$/);
  if (mixedMatch) {
    var whole = parseInt(mixedMatch[1]);
    var frac = parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
    return Math.round((whole + frac) * OZ_TO_GRAMS * 10) / 10;
  }
  // Plain number
  var num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * OZ_TO_GRAMS * 10) / 10;
}

// ---------------------------------------------------------------------------
// WP thumbnail URL → full-size URL
// ---------------------------------------------------------------------------

function getFullSizeImageUrl(url: string): string {
  // Remove -300x150, -300x161, -768x384 etc. thumbnails
  return url.replace(/-\d+x\d+\.(webp|jpg|jpeg|png)$/i, '.$1');
}

// ---------------------------------------------------------------------------
// Price parsing: ¥1,400 or ￥1,400 → number (tax-excluded → ×1.1)
// ---------------------------------------------------------------------------

function parsePrice(priceStr: string): number {
  var match = priceStr.match(/[¥￥]([\d,]+)/);
  if (!match) return 0;
  var raw = parseInt(match[1].replace(/,/g, ''));
  // All Nories prices are tax-excluded → ×1.1
  return Math.round(raw * 1.1);
}

// ---------------------------------------------------------------------------
// Weight parsing: "12.5g" → 12.5, "3/8oz." → grams
// ---------------------------------------------------------------------------

function parseWeight(weightStr: string): number {
  // oz-based
  if (/oz/i.test(weightStr)) {
    var ozMatch = weightStr.match(/([\d./]+)\s*oz/i);
    if (ozMatch) return parseOzToGrams(ozMatch[1]);
  }
  // gram-based: "12.5g" or "12.5"
  var gMatch = weightStr.match(/([\d.]+)\s*g/i);
  if (gMatch) return parseFloat(gMatch[1]);
  // Just a number
  var num = parseFloat(weightStr);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// Length parsing: "70mm" → 70, "4-1/2\"class / 105mm" → 105
// ---------------------------------------------------------------------------

function parseLength(lengthStr: string): number | null {
  // Prefer mm value
  var mmMatch = lengthStr.match(/(\d+(?:\.\d+)?)\s*mm/i);
  if (mmMatch) return parseFloat(mmMatch[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Color name cleaning
// ---------------------------------------------------------------------------

function cleanColorName(raw: string): string {
  // Remove "NEW" span text, pro-staff notes, leading/trailing whitespace
  var cleaned = raw
    .replace(/NEW/gi, '')
    .replace(/※.*$/g, '')
    .trim();
  return cleaned;
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeNoriesPage(url: string): Promise<ScrapedLure> {
  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Extract slug from URL
    var slugMatch = url.match(/\/([^/]+)\/?$/);
    var slug = slugMatch ? slugMatch[1] : '';

    var data = await page.evaluate(function () {
      // Product name
      var nameEl = document.querySelector('h2.mainh2');
      var name = nameEl ? nameEl.textContent!.trim() : '';

      // Japanese name from h4
      var h4El = document.querySelector('article h4');
      var nameKana = '';
      if (h4El) {
        var h4Text = h4El.textContent || '';
        // Remove surrounding 「」
        nameKana = h4Text.replace(/[「」『』]/g, '').trim();
      }

      // Category from .metabox .newscate
      var cateEls = document.querySelectorAll('.metabox .newscate');
      var category = '';
      for (var i = 0; i < cateEls.length; i++) {
        var cText = cateEls[i].textContent || '';
        if (cText !== 'BASS' && cText !== 'SALT') {
          category = cText.trim();
          break;
        }
      }

      // Main image
      var mainImg = document.querySelector('article img.full-width') as HTMLImageElement | null;
      // Fallback: first large image in article
      if (!mainImg) {
        mainImg = document.querySelector('article .wp-image-') as HTMLImageElement | null;
      }
      if (!mainImg) {
        var allImgs = document.querySelectorAll('article img');
        for (var j = 0; j < allImgs.length; j++) {
          var img = allImgs[j] as HTMLImageElement;
          if (img.src && img.src.includes('MAIN_')) {
            mainImg = img;
            break;
          }
        }
      }
      var mainImageUrl = mainImg ? (mainImg.getAttribute('src') || '') : '';

      // Description: first <p> after h4 (or h3 for trout), fallback to any long <p>
      var articleChildren = document.querySelectorAll('article > *');
      var description = '';
      var foundHeading = false;
      for (var k = 0; k < articleChildren.length; k++) {
        var child = articleChildren[k];
        if (child.tagName === 'H4' || child.tagName === 'H3') { foundHeading = true; continue; }
        if (foundHeading && child.tagName === 'P') {
          var pText = (child.textContent || '').trim();
          if (pText.length > 20) {
            description = pText;
            break;
          }
        }
      }
      // Fallback: find any long paragraph in article
      if (!description) {
        var allPs = document.querySelectorAll('article p');
        for (var pk = 0; pk < allPs.length; pk++) {
          var pTxt = (allPs[pk].textContent || '').trim();
          if (pTxt.length > 50 && !pTxt.includes('※')) {
            description = pTxt;
            break;
          }
        }
      }

      // === SPECS ===
      var specsPanel = document.querySelector('.ChangeElem_Panel.specs');
      var specData: { length: string; weights: string[]; price: string; specFormat: string } = {
        length: '',
        weights: [],
        price: '',
        specFormat: 'unknown',
      };

      if (specsPanel) {
        var tables = specsPanel.querySelectorAll('table');

        for (var t = 0; t < tables.length; t++) {
          var table = tables[t];
          var rows = table.querySelectorAll('tr');
          if (rows.length === 0) continue;

          // Check first row for format detection
          var firstRowThs = rows[0].querySelectorAll('th');
          var firstRowTds = rows[0].querySelectorAll('td');

          // Format 1: th.w50p / td pairs (single model, most common)
          if (firstRowThs.length === 1 && firstRowTds.length >= 1) {
            specData.specFormat = 'single';
            for (var r = 0; r < rows.length; r++) {
              var th = rows[r].querySelector('th');
              var td = rows[r].querySelector('td');
              if (!th || !td) continue;
              var label = (th.textContent || '').trim().toLowerCase();
              var val = (td.textContent || '').trim();

              if (label.includes('length') && !specData.length) {
                specData.length = val;
              }
              if (label.includes('weight') && !label.includes('hook')) {
                specData.weights.push(val);
              }
              if (label === 'price' || label.includes('price')) {
                if (!specData.price) specData.price = val;
              }
            }
          }
          // Format 2: Multi-model columnar (header row with model names)
          else if (firstRowThs.length >= 2 || (firstRowThs.length === 1 && firstRowTds.length >= 2)) {
            specData.specFormat = 'multi';
            for (var r2 = 0; r2 < rows.length; r2++) {
              var th2 = rows[r2].querySelector('th');
              if (!th2) continue;
              var label2 = (th2.textContent || '').trim().toLowerCase();
              var tds2 = rows[r2].querySelectorAll('td');

              if (label2.includes('length') && !specData.length) {
                // Take first model's length
                specData.length = tds2.length > 0 ? (tds2[0].textContent || '').trim() : '';
              }
              if (label2.includes('weight') && !label2.includes('hook')) {
                for (var w = 0; w < tds2.length; w++) {
                  var wt = (tds2[w].textContent || '').trim();
                  if (wt) specData.weights.push(wt);
                }
              }
              if (label2 === 'price' || label2.includes('price')) {
                if (!specData.price && tds2.length > 0) {
                  specData.price = (tds2[0].textContent || '').trim();
                }
              }
              // Wire bait format: th=Weight, td values have oz values
              if (label2 === 'weight' && tds2.length === 0) {
                // This is a header row for wire bait table
                // Subsequent rows will have weight in first td
              }
            }
          }

          // Wire bait format: Weight | Blade | Price columns (all th in first row)
          if (firstRowThs.length >= 2 && specData.specFormat === 'multi') {
            var headerLabels: string[] = [];
            for (var h = 0; h < firstRowThs.length; h++) {
              headerLabels.push((firstRowThs[h].textContent || '').trim().toLowerCase());
            }
            var weightIdx = headerLabels.indexOf('weight');
            var priceIdx = headerLabels.findIndex(function(l) { return l.includes('price'); });

            if (weightIdx >= 0) {
              // Reset and re-parse as wire bait
              specData.weights = [];
              specData.price = '';
              for (var r3 = 1; r3 < rows.length; r3++) {
                var tds3 = rows[r3].querySelectorAll('td');
                if (tds3.length === 0) continue;
                if (weightIdx < tds3.length) {
                  var wtVal = (tds3[weightIdx].textContent || '').trim();
                  if (wtVal) specData.weights.push(wtVal);
                }
                if (priceIdx >= 0 && priceIdx < tds3.length && !specData.price) {
                  specData.price = (tds3[priceIdx].textContent || '').trim();
                }
              }
            }
          }

          // If we found data, break
          if (specData.price || specData.weights.length > 0) break;
        }
      }

      // === COLORS ===
      var colorPanel = document.querySelector('.ChangeElem_Panel.colorchart');
      var colors: { name: string; imageUrl: string }[] = [];

      if (colorPanel) {
        var colorTables = colorPanel.querySelectorAll('table');
        for (var ct = 0; ct < colorTables.length; ct++) {
          var colorTable = colorTables[ct];
          var colorRows = colorTable.querySelectorAll('tr');

          for (var cr = 0; cr < colorRows.length; cr++) {
            var tds = colorRows[cr].querySelectorAll('td');
            for (var cd = 0; cd < tds.length; cd++) {
              var td4 = tds[cd];
              var img4 = td4.querySelector('img') as HTMLImageElement | null;
              if (!img4) continue;

              // Get the text content after the first <br> (color name)
              // Format: <img ...><br/>COLOR_CODE COLOR_NAME<br/>PRO_STAFF_NOTE
              // We want only the first line of text after the image.
              var tdHtml = td4.innerHTML;
              var brRegex = /<br\s*\/?>/gi;
              var brMatches: number[] = [];
              var brMatch2: RegExpExecArray | null;
              while ((brMatch2 = brRegex.exec(tdHtml)) !== null) {
                brMatches.push(brMatch2.index + brMatch2[0].length);
              }
              var colorText = '';
              if (brMatches.length >= 2) {
                // Text between first and second <br>
                colorText = tdHtml.substring(brMatches[0], tdHtml.indexOf('<br', brMatches[0]));
              } else if (brMatches.length === 1) {
                // Text after the only <br>
                colorText = tdHtml.substring(brMatches[0]);
              }

              // Strip HTML tags
              var tempDiv = document.createElement('div');
              tempDiv.innerHTML = colorText;
              var rawName = (tempDiv.textContent || '').trim();

              if (!rawName) continue;
              // Skip if it's just ✓ or – (matrix availability cell)
              if (/^[✓–—-]$/.test(rawName)) continue;

              // Get srcset for full-size, or use src
              var srcset = img4.getAttribute('srcset') || '';
              var imgUrl = img4.getAttribute('src') || '';
              // Try to get the largest from srcset
              if (srcset) {
                var parts = srcset.split(',');
                var lastPart = parts[parts.length - 1].trim().split(/\s+/);
                if (lastPart[0]) imgUrl = lastPart[0];
              }

              colors.push({ name: rawName, imageUrl: imgUrl });
            }
          }
        }
      }

      return {
        name: name,
        nameKana: nameKana,
        category: category,
        mainImageUrl: mainImageUrl,
        description: description,
        specLength: specData.length,
        specWeights: specData.weights,
        specPrice: specData.price,
        specFormat: specData.specFormat,
        colors: colors,
      };
    });

    // Post-process extracted data
    var targetFish = detectTargetFish(url);
    var type = detectType(data.name, data.category);

    // Parse length
    var length = data.specLength ? parseLength(data.specLength) : null;

    // Parse weights
    var weights: number[] = [];
    for (var w of data.specWeights) {
      var parsed = parseWeight(w);
      if (parsed > 0) weights.push(parsed);
    }
    // Deduplicate
    weights = [...new Set(weights)];

    // Parse price
    var price = data.specPrice ? parsePrice(data.specPrice) : 0;

    // Process colors: clean names, get full-size URLs, deduplicate
    var seenColorNames = new Set<string>();
    var colors: { name: string; imageUrl: string }[] = [];
    for (var c of data.colors) {
      var cleanName = cleanColorName(c.name);
      if (!cleanName || seenColorNames.has(cleanName)) continue;
      seenColorNames.add(cleanName);
      var fullUrl = getFullSizeImageUrl(c.imageUrl);
      colors.push({ name: cleanName, imageUrl: fullUrl });
    }

    // Get full-size main image
    var mainImage = data.mainImageUrl ? getFullSizeImageUrl(data.mainImageUrl) : '';

    return {
      name: data.name,
      name_kana: data.nameKana,
      slug: slug,
      manufacturer: 'Nories',
      manufacturer_slug: 'nories',
      type: type,
      target_fish: targetFish,
      description: data.description,
      price: price,
      colors: colors,
      weights: weights,
      length: length,
      mainImage: mainImage,
      sourceUrl: url,
    };
  } finally {
    if (browser) await browser.close();
  }
}
