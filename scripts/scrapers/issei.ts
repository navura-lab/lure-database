// scripts/scrapers/issei.ts
// issei [一誠] product page scraper
// Handles lure products from issei.tv (bass: green_cray_fish, salt: umitaro)
//
// Site: WordPress + Cocoon theme, nginx, no WAF, headless OK.
// Encoding: UTF-8
// Price: spec table → ¥X,XXX (税別 = before tax)
// Images: /wordpress/wp-content/uploads/ paths — relative, need base URL prepend
// Colors:
//   - CSS-only tab system inside section.marginbtm
//   - Tab inputs: input.tab-switch (id=TAB-01, TAB-02 ...)
//   - Tab labels: label.tab-label (size/weight variant names: "10g", "8号" etc.)
//   - Color images: ul.tab-content > li > img
//   - Color name from img[alt]: "#XX カラー名" format
//
// Page structure (article children):
//   h2                         — product name
//   div.p_icon_list            — NEW COLOR badge etc.
//   div.products_catch         — catch copy / description
//   figure.wp-block-image      — product images (1-4)
//   ul.grid-2                  — grid variants (optional)
//   figure.wp-block-table      — spec table (price, size, hook etc.)
//   section.marginbtm          — color chart tab section
//   details.accordion-01       — JAN code table
//
// Two CPTs:
//   green_cray_fish (bass) — body class: single-green_cray_fish
//   umitaro (salt)         — body class: single-umitaro
//
// URL pattern: https://issei.tv/{cpt}/{id}.html
//
// IMPORTANT: No arrow functions or named function declarations inside page.evaluate().
//   Use var + function() syntax only.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var ISSEI_BASE_URL = 'https://issei.tv';

// ---------------------------------------------------------------------------
// Type detection from product name / spec / category
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  // Soft baits
  [/ワーム|ホッグ|クロー|クリーチャー|シュリンプ|バグ|ヤゴ|イモ|ビビビ|ネコリグ|沈み蟲|ライアミノー/i, 'ワーム'],
  [/グラブ|カーリー/i, 'ワーム'],
  // Jig heads
  [/ジグヘッド|JH|jig\s*head/i, 'ジグヘッド'],
  // Chatter / bladed jig
  [/チャター|chatter/i, 'チャタベイト'],
  // Spinner bait
  [/スピナーベイト|spinner/i, 'スピナーベイト'],
  // Buzz bait
  [/バズベイト|buzz/i, 'バズベイト'],
  // Crank
  [/クランク|crank/i, 'クランクベイト'],
  // Vibration
  [/バイブ|vibration/i, 'バイブレーション'],
  // Rubber jig (must be before metal jig to catch "ラバージグ" first)
  [/ラバージグ|rubber\s*jig/i, 'ラバージグ'],
  // Spoon
  [/スプーン|spoon/i, 'スプーン'],
  // Metal jig
  [/メタルジグ|metal\s*jig|ジグ(?!ヘッド)/i, 'メタルジグ'],
  // Minnow
  [/ミノー|minnow/i, 'ミノー'],
  // Popper
  [/ポッパー|popper/i, 'ポッパー'],
  // Pencil
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  // Top water
  [/トップウォーター|topwater/i, 'トップウォーター'],
  // Squid jig / Sutte
  [/スッテ|sutte/i, 'スッテ'],
  [/エギ|egi/i, 'エギ'],
  // Tai rubber
  [/タイラバ|鯛ラバ/i, '鯛ラバ'],
  // Rubber jig
  [/ラバージグ|rubber\s*jig/i, 'ラバージグ'],
  // Sinker
  [/シンカー|sinker/i, 'シンカー'],
  // Hook
  [/フック|hook|ハリ/i, 'フック'],
  // Swimbait
  [/スイムベイト|swim/i, 'スイムベイト'],
  // Rod (should be excluded at URL registration, but detect anyway)
  [/ロッド|rod/i, 'ロッド'],
];

function detectType(name: string, catchText: string, bodyClass: string): string {
  var combined = name + ' ' + catchText;
  for (var i = 0; i < TYPE_KEYWORDS.length; i++) {
    if (TYPE_KEYWORDS[i][0].test(combined)) return TYPE_KEYWORDS[i][1];
  }
  // Default based on CPT
  if (bodyClass.indexOf('green_cray_fish') >= 0) return 'ワーム';
  return 'プラグ';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(bodyClass: string, name: string, catchText: string): string[] {
  var combined = (name + ' ' + catchText).toLowerCase();

  // Salt water CPT
  if (bodyClass.indexOf('umitaro') >= 0) {
    if (/アジ|アジング/.test(combined)) return ['アジ'];
    if (/メバル|メバリング/.test(combined)) return ['メバル'];
    if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
    if (/イカ|エギ|スッテ/.test(combined)) return ['アオリイカ'];
    if (/タコ/.test(combined)) return ['タコ'];
    if (/ヒラメ|フラット|マゴチ/.test(combined)) return ['ヒラメ'];
    if (/青物|ショアジギ/.test(combined)) return ['青物'];
    if (/チヌ|クロダイ/.test(combined)) return ['クロダイ'];
    if (/鯛|タイラバ/.test(combined)) return ['マダイ'];
    if (/ロック|根魚/.test(combined)) return ['ロックフィッシュ'];
    return ['シーバス'];
  }

  // Bass CPT
  if (/トラウト|渓流/.test(combined)) return ['トラウト'];
  return ['ブラックバス'];
}

// ---------------------------------------------------------------------------
// Slug extraction from URL
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  // https://issei.tv/green_cray_fish/165.html → 165
  // https://issei.tv/umitaro/227.html → 227
  var match = url.match(/\/(\d+)\.html/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeIsseiPage(url: string): Promise<ScrapedLure> {
  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    var response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 404 check — issei.tv returns 200 with a custom 404 page
    var pageTitle = await page.title();
    if ((response && response.status() === 404) || /404|NOT FOUND|ページが見つかりません/.test(pageTitle)) {
      throw new Error('Page not found (404): ' + url);
    }

    await page.waitForTimeout(2000);

    // --- Extract all data via page.evaluate ---
    var data = await page.evaluate(function (baseUrl) {
      var result = {
        name: '',
        catchText: '',
        description: '',
        mainImage: '',
        ogImage: '',
        prices: [] as number[],
        weights: [] as number[],
        lengths: [] as number[],
        colors: [] as Array<{ name: string; imageUrl: string }>,
        bodyClass: document.body.className || '',
        iconText: '',
        specHeaders: [] as string[],
      };

      var article = document.querySelector('article');
      if (!article) return result;

      // ---- Product name from h2 ----
      var h2 = article.querySelector('h2');
      if (h2) {
        result.name = (h2.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }
      // Fallback: title tag
      if (!result.name) {
        var titleTag = document.title || '';
        var pipeIdx = titleTag.indexOf(' | ');
        if (pipeIdx > 0) {
          result.name = titleTag.substring(0, pipeIdx).trim();
        }
      }

      // ---- Icon list text (NEW COLOR etc.) ----
      var iconList = article.querySelector('.p_icon_list');
      if (iconList) {
        result.iconText = (iconList.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }

      // ---- Catch copy / description ----
      var catchDiv = article.querySelector('.products_catch');
      if (catchDiv) {
        result.catchText = (catchDiv.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }

      // ---- Main image from first figure.wp-block-image ----
      var mainFigure = article.querySelector('figure.wp-block-image img');
      if (mainFigure) {
        var mainSrc = mainFigure.getAttribute('src') || '';
        if (mainSrc && !mainSrc.startsWith('http')) {
          mainSrc = baseUrl + mainSrc;
        }
        result.mainImage = mainSrc;
      }

      // ---- OG image fallback ----
      var ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) {
        var ogSrc = ogImg.getAttribute('content') || '';
        if (ogSrc && !ogSrc.startsWith('http')) {
          ogSrc = baseUrl + ogSrc;
        }
        result.ogImage = ogSrc;
      }

      // ---- Spec table from figure.wp-block-table ----
      var specFigure = article.querySelector('figure.wp-block-table table');
      if (specFigure) {
        var rows = specFigure.querySelectorAll('tr');
        // Parse headers
        if (rows.length > 0) {
          var headerCells = rows[0].querySelectorAll('th, td');
          for (var hi = 0; hi < headerCells.length; hi++) {
            result.specHeaders.push((headerCells[hi].textContent || '').replace(/[\s\u3000]+/g, ' ').trim());
          }
        }

        // Find price, weight, size columns
        var priceColIdx = -1;
        var weightColIdx = -1;
        var sizeColIdx = -1;
        for (var hj = 0; hj < result.specHeaders.length; hj++) {
          var hText = result.specHeaders[hj].toLowerCase();
          if (hText.indexOf('価格') >= 0 || hText.indexOf('price') >= 0) {
            priceColIdx = hj;
          }
          if (hText.indexOf('ウエイト') >= 0 || hText.indexOf('ウェイト') >= 0 || hText.indexOf('自重') >= 0 || hText === 'weight') {
            weightColIdx = hj;
          }
          if (hText.indexOf('サイズ') >= 0 || hText.indexOf('全長') >= 0 || hText === 'size') {
            sizeColIdx = hj;
          }
        }

        // Parse data rows
        for (var ri = 1; ri < rows.length; ri++) {
          var cells = rows[ri].querySelectorAll('th, td');

          // Price
          if (priceColIdx >= 0 && priceColIdx < cells.length) {
            var priceText = (cells[priceColIdx].textContent || '').trim();
            var priceMatch = priceText.match(/[¥￥]?([\d,]+)/);
            if (priceMatch) {
              var priceVal = parseInt(priceMatch[1].replace(/,/g, ''), 10);
              if (priceVal > 0 && result.prices.indexOf(priceVal) < 0) {
                result.prices.push(priceVal);
              }
            }
          }
          // Also check for price in any cell (some tables have merged headers)
          for (var ci = 0; ci < cells.length; ci++) {
            var cellText = (cells[ci].textContent || '').trim();
            if (priceColIdx < 0 && /[¥￥][\d,]+/.test(cellText)) {
              var pMatch = cellText.match(/[¥￥]([\d,]+)/);
              if (pMatch) {
                var pVal = parseInt(pMatch[1].replace(/,/g, ''), 10);
                if (pVal > 0 && result.prices.indexOf(pVal) < 0) {
                  result.prices.push(pVal);
                }
              }
            }
          }

          // Weight — from column or from product name in first cell
          if (weightColIdx >= 0 && weightColIdx < cells.length) {
            var wText = (cells[weightColIdx].textContent || '').trim();
            var wMatch = wText.match(/([\d.]+)\s*g/i);
            if (wMatch) {
              var wVal = parseFloat(wMatch[1]);
              if (wVal > 0 && wVal < 10000) result.weights.push(wVal);
            }
          }
          // Also check first cell for weight (e.g., "AKチャター 10g")
          if (cells.length > 0) {
            var nameCell = (cells[0].textContent || '').trim();
            var nwMatch = nameCell.match(/([\d.]+)\s*g\b/i);
            if (nwMatch) {
              var nwVal = parseFloat(nwMatch[1]);
              if (nwVal > 0 && nwVal < 10000) {
                var exists = false;
                for (var wi = 0; wi < result.weights.length; wi++) {
                  if (result.weights[wi] === nwVal) { exists = true; break; }
                }
                if (!exists) result.weights.push(nwVal);
              }
            }
          }

          // Size
          if (sizeColIdx >= 0 && sizeColIdx < cells.length) {
            var sText = (cells[sizeColIdx].textContent || '').trim();
            var sMatch = sText.match(/([\d.]+)\s*mm/i);
            if (sMatch) {
              var sVal = parseFloat(sMatch[1]);
              if (sVal > 0 && sVal < 5000) result.lengths.push(sVal);
            }
            // Try cm
            if (!sMatch) {
              var cmMatch = sText.match(/([\d.]+)\s*cm/i);
              if (cmMatch) {
                var cmVal = Math.round(parseFloat(cmMatch[1]) * 10);
                if (cmVal > 0 && cmVal < 5000) result.lengths.push(cmVal);
              }
            }
          }
        }
      }

      // ---- Color images from section.marginbtm > ul.tab-content > li > img ----
      var section = article.querySelector('section.marginbtm');
      if (section) {
        var tabContents = section.querySelectorAll('ul.tab-content');
        var seenAlts: Record<string, boolean> = {};

        // Use the first tab (largest size variant usually has all colors)
        // But scan ALL tabs to catch any unique colors
        for (var ti = 0; ti < tabContents.length; ti++) {
          var lis = tabContents[ti].querySelectorAll('li');
          for (var li = 0; li < lis.length; li++) {
            var img = lis[li].querySelector('img');
            if (!img) continue;
            var alt = (img.getAttribute('alt') || '').trim();
            var src = img.getAttribute('src') || '';
            if (!alt || seenAlts[alt]) continue;
            seenAlts[alt] = true;

            if (src && !src.startsWith('http')) {
              src = baseUrl + src;
            }
            result.colors.push({ name: alt, imageUrl: src });
          }
        }
      }

      // ---- Fallback: colors from article > img with alt starting with # ----
      if (result.colors.length === 0) {
        var allImgs = article.querySelectorAll('img');
        var seenFallback: Record<string, boolean> = {};
        for (var fi = 0; fi < allImgs.length; fi++) {
          var fAlt = (allImgs[fi].getAttribute('alt') || '').trim();
          var fSrc = allImgs[fi].getAttribute('src') || '';
          if (/^#\d/.test(fAlt) && !seenFallback[fAlt]) {
            seenFallback[fAlt] = true;
            if (fSrc && !fSrc.startsWith('http')) {
              fSrc = baseUrl + fSrc;
            }
            result.colors.push({ name: fAlt, imageUrl: fSrc });
          }
        }
      }

      // ---- Description from meta description or catch text ----
      var metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        result.description = (metaDesc.getAttribute('content') || '').trim();
      }
      if (!result.description) {
        result.description = result.catchText;
      }

      return result;
    }, ISSEI_BASE_URL);

    // --- Build result ---
    var slug = extractSlug(url);
    var name = (data.name || 'Unknown').replace(/^海太郎\s*/, '海太郎 ').trim();
    var type = detectType(name, data.catchText, data.bodyClass);
    var targetFish = detectTargetFish(data.bodyClass, name, data.catchText);

    // Price — use lowest (most common variant)
    var price = 0;
    if (data.prices.length > 0) {
      data.prices.sort(function (a, b) { return a - b; });
      price = data.prices[0];
    }

    // Main image
    var mainImage = data.mainImage || data.ogImage || '';

    // Dedup weights
    var seenW: Record<string, boolean> = {};
    var uniqueWeights: number[] = [];
    for (var wi = 0; wi < data.weights.length; wi++) {
      var wKey = String(Math.round(data.weights[wi] * 10) / 10);
      if (!seenW[wKey]) {
        seenW[wKey] = true;
        uniqueWeights.push(Math.round(data.weights[wi] * 10) / 10);
      }
    }
    uniqueWeights.sort(function (a, b) { return a - b; });

    // Length — use first unique
    var seenL: Record<string, boolean> = {};
    var uniqueLengths: number[] = [];
    for (var li2 = 0; li2 < data.lengths.length; li2++) {
      var lKey = String(Math.round(data.lengths[li2]));
      if (!seenL[lKey]) {
        seenL[lKey] = true;
        uniqueLengths.push(Math.round(data.lengths[li2]));
      }
    }
    var length: number | null = uniqueLengths.length > 0 ? uniqueLengths[0] : null;

    // Colors
    var colors: ScrapedColor[] = [];
    for (var ci = 0; ci < data.colors.length; ci++) {
      colors.push({
        name: data.colors[ci].name,
        imageUrl: data.colors[ci].imageUrl || '',
      });
    }

    // Description
    var description = data.description || data.catchText || '';
    if (description.length > 500) {
      description = description.substring(0, 500);
    }

    var result: ScrapedLure = {
      name: name,
      name_kana: '',
      slug: slug,
      manufacturer: 'issei',
      manufacturer_slug: 'issei',
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
