// scripts/scrapers/gamakatsu.ts
// Gamakatsu (LUXXE) product page scraper
// Handles lure products from www.gamakatsu.co.jp/products/{ID}/
//
// Site: WordPress 6.8, SSR HTML, no WAF, headless OK.
// Encoding: UTF-8
// Price: hook-group__price span → ¥X,XXX (税抜 = before tax)
//   NOTE: Prices are 税抜 (before tax). We store them as-is.
// Images: wp-content/uploads paths — full absolute URLs
// Colors:
//   1) Color gallery: div.productsBlock-subbody-wrap > div.col-md-2
//      - Image: a[data-lity] > img[src] (300x300 thumbnails, use data-lity href for full)
//      - Name:  p.mt05 > p text (e.g., "#1 メッキハス")
//   2) Color names in spec: div.hook-group__number span text
//
// Spec table: div.table-spec table
//   - Dynamic column headers (thead > tr > th)
//   - Common columns: 品名コード, カラー, ウエイト, 全長, フックサイズ, 入数, 希望本体価格(円), JANコード
//   - Column order varies per product — must map by header text
//
// Product name: h2.productsBlock-ttl
// Description: div.productsBlock-body__item > p
// Categories: dl.hookandtool-catgroup dd a span.txtlink
// Fishing type: dt=釣種 dd a span.txtlink
//
// Main image: .products-images__mainItem__img img#js-frameItem
//   Fallback: .products-images__thumbList li:first-child img
//
// Multi-size products: Multiple hook-group sections with separate prices
//
// IMPORTANT: No function declarations/expressions inside page.evaluate().
//   tsx + astro tsconfig injects __name which breaks browser-context eval.
//   All helpers must be inlined using var + function() syntax.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name / description
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/バイブレーション|VIBRATION|バイブ\b/i, 'バイブレーション'],
  [/メタルバイブ/i, 'メタルバイブ'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ダイビングペンシル|ダイペン/i, 'ダイビングペンシル'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/プロップ|PROP/i, 'トップウォーター'],
  [/スピン$|スピンテール/i, 'スピンテール'],
  [/メタルジグ|METAL JIG/i, 'メタルジグ'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/エギ|エヴォリッジ|EVORIDGE/i, 'エギ'],
  [/スッテ/i, 'スッテ'],
  [/タコエギ/i, 'タコエギ'],
  [/鯛ラバ|タイラバ/i, '鯛ラバ'],
  [/ワーム|WORM|ノレソレ|トレモロ|アーミーシャッド|エクボ|ほぼザリ|ラフィン|アヴィック|ジュリー|マダラ|クロー/i, 'ワーム'],
  [/トップウォーター|TOPWATER/i, 'トップウォーター'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ジグ|JIG/i, 'メタルジグ'],
];

function detectType(name: string, description: string): string {
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(name)) return entry[1];
  }

  // Check description (first 300 chars)
  var descShort = description.substring(0, 300);
  for (var entry2 of TYPE_KEYWORDS) {
    if (entry2[0].test(descShort)) return entry2[1];
  }

  return 'プラグ';
}

// ---------------------------------------------------------------------------
// Target fish detection from fishing categories + product name
// ---------------------------------------------------------------------------

function detectTargetFish(fishingCats: string[], name: string, description: string): string[] {
  var nameLower = name.toLowerCase();
  var combined = (fishingCats.join(' ') + ' ' + name + ' ' + description).toLowerCase();

  // Product-line specific matches (check name first for accuracy)
  if (/オクトライズ/.test(nameLower)) return ['タコ'];
  if (/エヴォリッジ/.test(nameLower)) return ['アオリイカ'];

  if (/バス\b|bass|ブラックバス/.test(combined)) return ['ブラックバス'];
  if (/トラウト|渓流|エリア/.test(combined)) return ['トラウト'];
  if (/アジ|アジング|ajing/.test(combined)) return ['アジ'];
  if (/メバル|メバリング/.test(combined)) return ['メバル'];
  if (/ライトゲーム/.test(combined)) return ['アジ', 'メバル'];
  if (/タコ|タコエギ|octorize/.test(combined)) return ['タコ'];
  if (/イカ|エギ|ティップラン/.test(combined)) return ['アオリイカ'];
  if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
  if (/青物|ヒラマサ|ブリ|ショアジギ|ジギング/.test(combined)) return ['青物'];
  if (/ヒラメ|フラット|マゴチ/.test(combined)) return ['ヒラメ'];
  if (/チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];
  if (/鯛|タイ|マダイ|桜幻/.test(combined)) return ['マダイ'];
  if (/マダラ|タラ/.test(combined)) return ['マダラ'];

  // Default for salt = シーバス
  return ['シーバス'];
}

// ---------------------------------------------------------------------------
// Slug extraction from URL
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  // https://www.gamakatsu.co.jp/products/80-604/ → 80-604
  // https://www.gamakatsu.co.jp/products/19327/ → 19327
  var match = url.match(/\/products\/([^/?#]+)/);
  return match ? match[1].replace(/\/$/, '') : 'unknown';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeGamakatsuPage(url: string): Promise<ScrapedLure> {
  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext();
    var page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // --- Extract all data via page.evaluate ---
    var data = await page.evaluate(function () {
      var result = {
        name: '',
        catchCopy: '',
        description: '',
        mainImage: '',
        prices: [] as number[],
        weights: [] as number[],
        lengths: [] as number[],
        colors: [] as Array<{ name: string; imageUrl: string }>,
        categories: [] as string[],
        fishingTypes: [] as string[],
      };

      // ---- Product name from h2.productsBlock-ttl ----
      var titleEl = document.querySelector('h2.productsBlock-ttl');
      if (titleEl) {
        result.name = (titleEl.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }
      // Fallback: title tag
      if (!result.name) {
        var titleTag = document.title || '';
        var parts = titleTag.split('|');
        if (parts.length > 0) {
          result.name = parts[0].trim();
        }
      }

      // ---- Catch copy ----
      var catchEl = document.querySelector('p.productsBlock-catch');
      if (catchEl) {
        result.catchCopy = (catchEl.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }

      // ---- Main image from #js-frameItem or first thumb ----
      var mainImg = document.querySelector('#js-frameItem');
      if (mainImg) {
        result.mainImage = (mainImg as HTMLImageElement).src || '';
      }
      if (!result.mainImage) {
        var thumbImg = document.querySelector('.products-images__thumbItem img');
        if (thumbImg) {
          result.mainImage = (thumbImg as HTMLImageElement).src || '';
        }
      }
      // Fallback: og:image
      if (!result.mainImage) {
        var ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) {
          result.mainImage = (ogImg as HTMLMetaElement).content || '';
        }
      }

      // ---- Description from productsBlock-body__item ----
      var descEls = document.querySelectorAll('.productsBlock-body__item');
      var descParts: string[] = [];
      for (var di = 0; di < descEls.length; di++) {
        var pEls = descEls[di].querySelectorAll('p');
        for (var pi = 0; pi < pEls.length; pi++) {
          var pText = (pEls[pi].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          if (pText) descParts.push(pText);
        }
      }
      result.description = descParts.join('\n\n');

      // ---- Prices from hook-group__price ----
      var priceEls = document.querySelectorAll('.hook-group__price span');
      for (var pri = 0; pri < priceEls.length; pri++) {
        var priceText = (priceEls[pri].textContent || '').trim();
        var priceMatch = priceText.match(/[¥￥]?([\d,]+)/);
        if (priceMatch) {
          var priceVal = parseInt(priceMatch[1].replace(/,/g, ''), 10);
          if (priceVal > 0) result.prices.push(priceVal);
        }
      }

      // ---- Spec table from div.table-spec table ----
      var specTables = document.querySelectorAll('.table-spec table');
      for (var sti = 0; sti < specTables.length; sti++) {
        var specTable = specTables[sti];
        // Map column headers by index
        var headerMap: Record<number, string> = {};
        var thEls = specTable.querySelectorAll('thead tr th');
        for (var hi = 0; hi < thEls.length; hi++) {
          var hText = (thEls[hi].textContent || '').replace(/[\s\u3000]+/g, ' ').trim().toLowerCase();
          headerMap[hi] = hText;
        }

        // Parse data rows
        var rows = specTable.querySelectorAll('tbody tr');
        for (var ri = 0; ri < rows.length; ri++) {
          var cells = rows[ri].querySelectorAll('th, td');
          for (var ci = 0; ci < cells.length; ci++) {
            var cellText = (cells[ci].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            var header = headerMap[ci] || '';

            // Price: 希望本体価格
            if (header.indexOf('価格') >= 0 || header.indexOf('price') >= 0) {
              var specPriceMatch = cellText.match(/([\d,]+)/);
              if (specPriceMatch) {
                var specPriceVal = parseInt(specPriceMatch[1].replace(/,/g, ''), 10);
                if (specPriceVal > 0 && result.prices.indexOf(specPriceVal) < 0) {
                  result.prices.push(specPriceVal);
                }
              }
            }

            // Weight: ウエイト or ウェイト
            if (header.indexOf('ウエイト') >= 0 || header.indexOf('ウェイト') >= 0 || header === 'weight') {
              var weightMatch = cellText.match(/([\d.]+)\s*g/i);
              if (weightMatch) {
                var weightVal = parseFloat(weightMatch[1]);
                if (weightVal > 0) result.weights.push(weightVal);
              }
              // Sometimes weight is just "24g" without space
              if (!weightMatch) {
                var weightMatch2 = cellText.match(/^([\d.]+)g$/i);
                if (weightMatch2) {
                  var weightVal2 = parseFloat(weightMatch2[1]);
                  if (weightVal2 > 0) result.weights.push(weightVal2);
                }
              }
            }

            // Length: 全長 or サイズ
            if (header.indexOf('全長') >= 0 || header.indexOf('サイズ') >= 0 || header === 'size') {
              var sizeMatch = cellText.match(/([\d.]+)\s*mm/i);
              if (sizeMatch) {
                var sizeVal = parseFloat(sizeMatch[1]);
                if (sizeVal > 0) result.lengths.push(sizeVal);
              }
              // Sometimes just "75mm"
              if (!sizeMatch) {
                var sizeMatch2 = cellText.match(/^([\d.]+)mm$/i);
                if (sizeMatch2) {
                  var sizeVal2 = parseFloat(sizeMatch2[1]);
                  if (sizeVal2 > 0) result.lengths.push(sizeVal2);
                }
              }
            }

            // Fallback: weight from name column (e.g., "24g" in the name)
            if (header.indexOf('品名') >= 0 || header === 'name') {
              var nameWeightMatch = cellText.match(/([\d.]+)\s*g\b/i);
              if (nameWeightMatch) {
                var nameWeightVal = parseFloat(nameWeightMatch[1]);
                if (nameWeightVal > 0) result.weights.push(nameWeightVal);
              }
            }
          }
        }
      }

      // ---- Color gallery from productsBlock-subbody-wrap ----
      var colorDivs = document.querySelectorAll('.productsBlock-subbody-wrap > .col-md-2');
      var seenColors: Record<string, boolean> = {};
      for (var cdi = 0; cdi < colorDivs.length; cdi++) {
        var colorDiv = colorDivs[cdi];

        // Color name: HTML has <p class="mt05 fsz08"><p>#1 Name</p></p>
        // Browser auto-corrects this into 3 sibling <p> elements.
        // The name is in a <p> without class that has actual text content.
        var allPs = colorDiv.querySelectorAll('p');
        var colorName = '';
        for (var pi2 = 0; pi2 < allPs.length; pi2++) {
          var pText2 = (allPs[pi2].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          if (pText2 && !allPs[pi2].classList.contains('mt05')) {
            colorName = pText2;
            break;
          }
        }
        // Fallback: if all <p> have mt05 class, use the one with text
        if (!colorName) {
          for (var pi3 = 0; pi3 < allPs.length; pi3++) {
            var pText3 = (allPs[pi3].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (pText3) {
              colorName = pText3;
              break;
            }
          }
        }

        // Color image from a[data-lity] href (full-size) or img src (thumbnail)
        var colorImgUrl = '';
        var colorLink = colorDiv.querySelector('a[data-lity]');
        if (colorLink) {
          colorImgUrl = (colorLink as HTMLAnchorElement).href || '';
        }
        if (!colorImgUrl) {
          var colorImg = colorDiv.querySelector('img');
          if (colorImg) {
            colorImgUrl = (colorImg as HTMLImageElement).src || '';
          }
        }

        if (!colorName || seenColors[colorName]) continue;
        seenColors[colorName] = true;

        result.colors.push({ name: colorName, imageUrl: colorImgUrl });
      }

      // ---- Fallback colors from hook-group__number spans ----
      if (result.colors.length === 0) {
        var colorSpans = document.querySelectorAll('.hook-group__number span');
        for (var csi = 0; csi < colorSpans.length; csi++) {
          var spanText = (colorSpans[csi].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          if (spanText && !seenColors[spanText]) {
            seenColors[spanText] = true;
            result.colors.push({ name: spanText, imageUrl: '' });
          }
        }
      }

      // ---- Categories & fishing types from hookandtool-catgroup ----
      var catGroups = document.querySelectorAll('dl.hookandtool-catgroup');
      for (var cgi = 0; cgi < catGroups.length; cgi++) {
        var dtEl = catGroups[cgi].querySelector('dt');
        var dtText = dtEl ? (dtEl.textContent || '').trim() : '';
        var ddLinks = catGroups[cgi].querySelectorAll('dd a span.txtlink');

        for (var dli = 0; dli < ddLinks.length; dli++) {
          var linkText = (ddLinks[dli].textContent || '').trim();
          if (dtText === '釣種') {
            result.fishingTypes.push(linkText);
          } else {
            result.categories.push(linkText);
          }
        }
      }

      return result;
    });

    // --- Build result ---
    var slug = extractSlug(url);

    var name = (data.name || 'Unknown').replace(/^NEW\s+/i, '').replace(/^生産終了\s*/i, '').trim();
    var description = data.description || '';
    if (data.catchCopy) {
      description = data.catchCopy + '\n\n' + description;
    }

    var type = detectType(name, description);
    var targetFish = detectTargetFish(data.fishingTypes, name, description);

    // Price — use first or 0
    var price = data.prices.length > 0 ? data.prices[0] : 0;

    // Main image (already absolute from WordPress)
    var mainImage = data.mainImage || '';

    // Dedup weights
    var seenW: Record<string, boolean> = {};
    var uniqueWeights: number[] = [];
    for (var wi = 0; wi < data.weights.length; wi++) {
      var wKey = String(data.weights[wi]);
      if (!seenW[wKey]) {
        seenW[wKey] = true;
        uniqueWeights.push(data.weights[wi]);
      }
    }

    // Dedup lengths
    var seenL: Record<string, boolean> = {};
    var uniqueLengths: number[] = [];
    for (var li = 0; li < data.lengths.length; li++) {
      var lKey = String(data.lengths[li]);
      if (!seenL[lKey]) {
        seenL[lKey] = true;
        uniqueLengths.push(data.lengths[li]);
      }
    }

    var length: number | null = uniqueLengths.length > 0 ? uniqueLengths[0] : null;

    // Color images — already absolute from WordPress
    var colors: ScrapedColor[] = [];
    for (var ci2 = 0; ci2 < data.colors.length; ci2++) {
      colors.push({
        name: data.colors[ci2].name,
        imageUrl: data.colors[ci2].imageUrl || '',
      });
    }

    var result: ScrapedLure = {
      name: name,
      name_kana: '',
      slug: slug,
      manufacturer: 'がまかつ',
      manufacturer_slug: 'gamakatsu',
      type: type,
      target_fish: targetFish,
      description: description,
      price: price,
      colors: colors,
      weights: uniqueWeights,
      length: length,
      mainImage: mainImage,
      sourceUrl: url,
    };

    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
