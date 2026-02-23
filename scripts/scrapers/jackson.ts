// scripts/scrapers/jackson.ts
// Jackson product page scraper
// Handles lure products from jackson.jp/products/{slug}
//
// Site: WordPress 5.7.14, SSR HTML, no WAF, headless OK.
// Encoding: UTF-8
// Price: Tax-included in spec table — 価格(税込) column → ¥X,XXX
// Images: wp-content/uploads paths — full absolute URLs
// Colors: div.lineup > div.imgBox.accordion > div.photoBox
//   - Image: photoBox > img[src]
//   - Name:  photoBox > p > span.name (or span.lineupNameAddedStyle)
//
// Spec table: div.spec > div.spenTab > table
//   - Dynamic column headers (thead > tr > th)
//   - Common columns: Name, Size, Weight, Type, Hook(&Ring), 価格(税込)
//   - Column order varies per product — must map by header text
//
// Product name: section.pageTitle > h3
//   - span.en = English name
//   - Trailing text node = Japanese name
//
// Categories: Salt, Trout (from ul.tagList01 > li)
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
  [/バイブレーション|VIBRATION|鉄板バイブ/i, 'バイブレーション'],
  [/メタルバイブ/i, 'メタルバイブ'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ダイビングペンシル|ダイペン/i, 'ダイビングペンシル'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/メタルジグ|METAL JIG|ジグ|JIG/i, 'メタルジグ'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ワーム|WORM|シャッドテール|ピンテール|グラブ/i, 'ワーム'],
  [/トップウォーター|TOPWATER|スイッシャー|SWISHER/i, 'トップウォーター'],
  [/ジグヘッド/i, 'ジグヘッド'],
  [/ブレード/i, 'スピンテール'],
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
// Target fish detection from category tags + product name
// ---------------------------------------------------------------------------

function detectTargetFish(tags: string[], name: string, description: string): string[] {
  var combined = (tags.join(' ') + ' ' + name + ' ' + description).toLowerCase();

  // Trout detection
  if (/trout|トラウト|ネイティブ|エリア|渓流/.test(combined)) return ['トラウト'];
  if (/バス\b|bass\b|ブラックバス/.test(combined)) return ['ブラックバス'];
  if (/オフショア|offshore/.test(combined)) return ['青物'];

  // Salt subcategories
  if (/青物|ヒラマサ|ブリ|カンパチ|ショアジギ/.test(combined)) return ['青物'];
  if (/ヒラメ|フラット|マゴチ/.test(combined)) return ['ヒラメ'];
  if (/チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];
  if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
  if (/メバル|メバリング/.test(combined)) return ['メバル'];
  if (/アジ|アジング/.test(combined)) return ['アジ'];
  if (/イカ|エギ|烏賊/.test(combined)) return ['アオリイカ'];
  if (/サワラ|サゴシ/.test(combined)) return ['サワラ'];

  // Default for salt = シーバス
  return ['シーバス'];
}

// ---------------------------------------------------------------------------
// Slug extraction from URL
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  // https://jackson.jp/products/athlete-9s → athlete-9s
  var match = url.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeJacksonPage(url: string): Promise<ScrapedLure> {
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
        nameEn: '',
        nameJa: '',
        description: '',
        mainImage: '',
        tags: [] as string[],
        prices: [] as number[],
        weights: [] as number[],
        lengths: [] as number[],
        colors: [] as Array<{ name: string; imageUrl: string }>,
      };

      // ---- Product name from section.pageTitle h3 ----
      var titleH3 = document.querySelector('.products_detail .pageTitle h3');
      if (titleH3) {
        // English name from span.en
        var enSpan = titleH3.querySelector('span.en');
        if (enSpan) {
          result.nameEn = (enSpan.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        }
        // Japanese name = text nodes after span elements
        var childNodes = titleH3.childNodes;
        var jaTexts: string[] = [];
        for (var ni = 0; ni < childNodes.length; ni++) {
          var node = childNodes[ni];
          if (node.nodeType === 3) { // TEXT_NODE
            var txt = (node.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (txt) jaTexts.push(txt);
          }
        }
        result.nameJa = jaTexts.join(' ').trim();
      }

      // Fallback: og:title meta tag
      if (!result.nameEn && !result.nameJa) {
        var ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          result.nameEn = (ogTitle as HTMLMetaElement).content || '';
        }
      }

      // ---- Category tags from ul.tagList01 ----
      var tagEls = document.querySelectorAll('.products_detail .pageTitle ul.tagList01 li');
      for (var ti = 0; ti < tagEls.length; ti++) {
        var tagText = (tagEls[ti].textContent || '').trim();
        if (tagText) result.tags.push(tagText);
      }

      // ---- Main image from sliderBox ----
      var sliderImg = document.querySelector('.sliderBox .phoList li img');
      if (sliderImg) {
        result.mainImage = (sliderImg as HTMLImageElement).src || '';
      }
      // Fallback: og:image
      if (!result.mainImage) {
        var ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) {
          result.mainImage = (ogImg as HTMLMetaElement).content || '';
        }
      }

      // ---- Description from div.about ----
      var aboutDiv = document.querySelector('.products_detail .about');
      if (aboutDiv) {
        var pEls = aboutDiv.querySelectorAll('p');
        var descParts: string[] = [];
        for (var di = 0; di < pEls.length; di++) {
          var pText = (pEls[di].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          if (pText) descParts.push(pText);
        }
        result.description = descParts.join('\n\n');
      }

      // ---- Spec table from div.spec div.spenTab table ----
      var specTable = document.querySelector('.products_detail .spec .spenTab table');
      if (specTable) {
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

            // Price: 価格 → ¥X,XXX
            if (header.indexOf('価格') >= 0 || header.indexOf('price') >= 0) {
              var priceMatch = cellText.match(/[¥￥]([\d,]+)/);
              if (priceMatch) {
                var priceVal = parseInt(priceMatch[1].replace(/,/g, ''), 10);
                if (priceVal > 0) result.prices.push(priceVal);
              }
            }

            // Size: mm
            if (header === 'size' || header.indexOf('サイズ') >= 0) {
              var sizeMatch = cellText.match(/([\d.]+)\s*mm/i);
              if (sizeMatch) {
                var sizeVal = parseFloat(sizeMatch[1]);
                if (sizeVal > 0) result.lengths.push(sizeVal);
              }
            }

            // Weight: g
            if (header === 'weight' || header.indexOf('ウエイト') >= 0 || header.indexOf('ウェイト') >= 0 || header.indexOf('重量') >= 0) {
              var weightMatch = cellText.match(/([\d.]+)\s*g/i);
              if (weightMatch) {
                var weightVal = parseFloat(weightMatch[1]);
                if (weightVal > 0) result.weights.push(weightVal);
              }
            }

            // Fallback: extract weight from Name column (e.g. "ちぬころバイブ 8g")
            if (header === 'name' || header.indexOf('名') >= 0) {
              var nameWeightMatch = cellText.match(/([\d.]+)\s*g\b/i);
              if (nameWeightMatch) {
                var nameWeightVal = parseFloat(nameWeightMatch[1]);
                if (nameWeightVal > 0) result.weights.push(nameWeightVal);
              }
            }
          }
        }
      }

      // ---- Colors from div.lineup ----
      var colorBoxes = document.querySelectorAll('.products_detail .lineup .imgBox .photoBox');
      var seenColors: Record<string, boolean> = {};
      for (var cbi = 0; cbi < colorBoxes.length; cbi++) {
        var photoBox = colorBoxes[cbi];

        // Color image
        var colorImg = photoBox.querySelector('img');
        var colorImgUrl = colorImg ? (colorImg as HTMLImageElement).src || '' : '';

        // Color name from span.name or span.lineupNameAddedStyle
        var nameSpan = photoBox.querySelector('span.name') || photoBox.querySelector('span.lineupNameAddedStyle');
        var colorName = '';
        if (nameSpan) {
          colorName = (nameSpan.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        }
        // Fallback: p text
        if (!colorName) {
          var colorP = photoBox.querySelector('p');
          if (colorP) {
            colorName = (colorP.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          }
        }

        if (!colorName || seenColors[colorName]) continue;
        seenColors[colorName] = true;

        result.colors.push({ name: colorName, imageUrl: colorImgUrl });
      }

      return result;
    });

    // --- Build result ---
    var slug = extractSlug(url);

    // Compose name: prefer "English name Japanese name", fallback to either
    var name = '';
    if (data.nameEn && data.nameJa) {
      name = data.nameEn + ' ' + data.nameJa;
    } else {
      name = data.nameEn || data.nameJa || 'Unknown';
    }

    var description = data.description || '';
    var type = detectType(name, description);
    var targetFish = detectTargetFish(data.tags, name, description);

    // Price — use first (tax-included) or 0
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
      var cUrl = (data.colors[ci2].imageUrl || '').trim();
      colors.push({
        name: data.colors[ci2].name,
        imageUrl: cUrl,
      });
    }

    var result: ScrapedLure = {
      name: name,
      name_kana: '',
      slug: slug,
      manufacturer: 'Jackson',
      manufacturer_slug: 'jackson',
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
