// scripts/scrapers/yamashita.ts
// YAMASHITA product page scraper
// Handles lure products from www.yamaria.co.jp/yamashita/product/detail/{ID}
//
// Site: Server-rendered HTML (same CMS as Maria), no WAF, headless OK.
// Encoding: UTF-8
// Price: NOT available — e-shop (ec.yamaria.com) is separate, no lure prices → price = 0
//
// DOM structure shares CSS classes with Maria (same CMS):
//   - Colors: ul.spec-item-list > li > h3.item-ttl + div.ph > img
//   - Spec tables: table.bk-th-tbl (full SKU table) + table.wh-tbl (summary)
//   - Main image: div.ph > img[src*="/cms/product/yamashita/"]
//   - Product name: <title> tag (h2 is sidebar, NOT product name!)
//
// Product types: エギ (egi), スッテ (sutte), タコベイト (octopus bait), etc.
// Target fish: primarily イカ (squid) and タコ (octopus)
//
// IMPORTANT: No function declarations/expressions inside page.evaluate().
//   tsx + astro tsconfig injects __name which breaks browser-context eval.
//   All helpers must be inlined using var + function() syntax.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection — YAMASHITA is primarily エギ / スッテ / タコベイト
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/エギ王|エギーノ|エギング|EGALM|EZ-Q/i, 'エギ'],
  [/スッテ|SUTTE/i, 'スッテ'],
  [/タコベイト|TAKOBEITO|蛸ベイト/i, 'タコベイト'],
  [/ナオリー|NAORY/i, 'スッテ'],
  [/ウィジェット|WIDGETS/i, 'メタルジグ'],
  [/ジグ|JIG/i, 'メタルジグ'],
  [/タイラバ/i, 'タイラバ'],
  [/インチク/i, 'インチク'],
  [/クッション/i, 'クッション天秤'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/バイブレーション/i, 'バイブレーション'],
  [/ワーム|WORM/i, 'ワーム'],
];

function detectType(name: string, description: string, specType: string): string {
  // Step 1: Product name — most reliable for YAMASHITA
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(name)) return entry[1];
  }

  // Step 2: Spec table type column
  if (specType) {
    if (/エギ/i.test(specType)) return 'エギ';
    if (/スッテ/i.test(specType)) return 'スッテ';
    return specType;
  }

  // Step 3: Description (first 200 chars)
  var descShort = description.substring(0, 200);
  for (var entry2 of TYPE_KEYWORDS) {
    if (entry2[0].test(descShort)) return entry2[1];
  }

  return 'エギ'; // YAMASHITA default
}

// ---------------------------------------------------------------------------
// Target fish detection — YAMASHITA = primarily squid/octopus
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, description: string, urlPath: string): string[] {
  var combined = (name + ' ' + description + ' ' + urlPath).toLowerCase();

  // URL path hints (category)
  if (/eging|エギング/.test(combined)) return ['イカ'];
  if (/squid|イカ/.test(combined)) return ['イカ'];
  if (/octpass|タコ|蛸|octopus/.test(combined)) return ['タコ'];
  if (/hairtail|太刀魚|タチウオ/.test(combined)) return ['タチウオ'];
  if (/takobeito/.test(combined)) return ['タコ'];

  // Name-based
  if (/エギ王|エギーノ|EGALM|EZ-Q/i.test(name)) return ['イカ'];
  if (/スッテ|SUTTE|ナオリー|NAORY/i.test(name)) return ['イカ'];
  if (/タコベイト|タコエギ/i.test(name)) return ['タコ'];
  if (/タイラバ/i.test(name)) return ['マダイ'];
  if (/アジ|アジング/i.test(combined)) return ['アジ'];
  if (/メバル/i.test(combined)) return ['メバル'];
  if (/青物|ブリ|カンパチ|ヒラマサ/i.test(combined)) return ['青物'];
  if (/シーバス/i.test(combined)) return ['シーバス'];

  // Default for YAMASHITA = イカ
  return ['イカ'];
}

// ---------------------------------------------------------------------------
// Slug extraction
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  var match = url.match(/\/detail\/([^/?#]+)/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeYamashitaPage(url: string): Promise<ScrapedLure> {
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
        description: '',
        mainImage: '',
        specType: '',
        lengths: [] as number[],
        weights: [] as number[],
        colors: [] as Array<{ name: string; imageUrl: string }>,
        titleTag: '',
      };

      // ---- Product name from <title> tag ----
      // Format: "商品名｜YAMASHITA｜イカ釣りで世界トップクラス"
      // The first <h2> is the SIDEBAR heading "カテゴリで絞り込む", NOT the product name!
      result.titleTag = document.title || '';
      if (result.titleTag) {
        // Split on fullwidth pipe ｜ or regular pipe |
        var titleParts = result.titleTag.split(/[｜|]/);
        if (titleParts.length > 0) {
          result.name = titleParts[0].trim();
        }
      }

      // ---- Main image ----
      // div.ph > img with /cms/product/yamashita/ in src — first one is the hero
      var allPageImgs = document.querySelectorAll('img');
      for (var mi = 0; mi < allPageImgs.length; mi++) {
        var imgSrc = (allPageImgs[mi] as HTMLImageElement).src || '';
        if (imgSrc.indexOf('/cms/product/yamashita/') >= 0) {
          // Skip tiny icons, body color icons, and common assets
          var imgAlt = (allPageImgs[mi] as HTMLImageElement).alt || '';
          if (imgSrc.indexOf('/body/') >= 0) continue; // body color icons like GOLD.png
          if (imgSrc.indexOf('_icon') >= 0) continue;
          if (imgSrc.indexOf('banner') >= 0) continue;
          if (imgSrc.indexOf('common') >= 0) continue;

          // Check if it's inside spec-item-list (color images — skip for main image)
          var parentCheck = allPageImgs[mi].parentElement;
          var isInColorList = false;
          for (var pc = 0; pc < 5 && parentCheck; pc++) {
            if (parentCheck.classList && parentCheck.classList.contains('spec-item-list')) {
              isInColorList = true;
              break;
            }
            parentCheck = parentCheck.parentElement;
          }
          if (isInColorList) continue;

          result.mainImage = imgSrc;
          break;
        }
      }

      // ---- Description ----
      // Collect text from <p> elements inside div.cont-area or div.item-cont-box
      var descBlocks = document.querySelectorAll('.item-body-area .item-cont-box p, .cont-area p');
      var descTexts: string[] = [];
      var seenDesc: Record<string, boolean> = {};
      for (var di = 0; di < descBlocks.length; di++) {
        var txt = (descBlocks[di].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (txt.length > 10 && !seenDesc[txt]) {
          seenDesc[txt] = true;
          descTexts.push(txt);
        }
      }
      result.description = descTexts.join('\n\n');

      // If description is still empty, try first <p> with substantial text
      if (!result.description) {
        var allPs = document.querySelectorAll('p');
        for (var pi = 0; pi < allPs.length; pi++) {
          var pText = (allPs[pi].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
          if (pText.length > 30) {
            result.description = pText;
            break;
          }
        }
      }

      // ================================================================
      // COLOR EXTRACTION — Primary: ul.spec-item-list (with images)
      // Same DOM structure as Maria
      // ================================================================

      var seenColors: Record<string, boolean> = {};

      // --- Primary: ul.spec-item-list > li ---
      var specItemList = document.querySelectorAll('ul.spec-item-list > li');
      for (var sli = 0; sli < specItemList.length; sli++) {
        var liEl = specItemList[sli];

        // Color name from h3.item-ttl (strip <span> tags like "NEW")
        // YAMASHITA format: "001 金アジ" (3-digit number + color name)
        var colorH3 = liEl.querySelector('h3.item-ttl');
        if (!colorH3) continue;
        // Clone to strip child elements like <span>
        var h3Clone = colorH3.cloneNode(true) as HTMLElement;
        var spans = h3Clone.querySelectorAll('span');
        for (var sp = 0; sp < spans.length; sp++) {
          spans[sp].parentNode && spans[sp].parentNode.removeChild(spans[sp]);
        }
        var colorName = (h3Clone.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (!colorName || seenColors[colorName]) continue;
        seenColors[colorName] = true;

        // Color image — two layout patterns exist:
        //   Pattern A (ホバー, アッパー etc): li > div.ph > img
        //   Pattern B (エギ王K etc): li > img (direct child, no div.ph wrapper)
        var colorImgUrl = '';
        var phDiv = liEl.querySelector('div.ph');
        if (phDiv) {
          // Pattern A: image inside div.ph wrapper
          var hoverImg = phDiv.querySelector('img.bg-hover-img01');
          if (hoverImg) {
            colorImgUrl = (hoverImg as HTMLImageElement).src || '';
          }
          if (!colorImgUrl) {
            var regularImg = phDiv.querySelector('img');
            if (regularImg) {
              colorImgUrl = (regularImg as HTMLImageElement).src || '';
            }
          }
        }
        if (!colorImgUrl) {
          // Pattern B: img is direct child of li (no div.ph wrapper)
          // Skip body color icons (/body/) and item-txt description images
          var liImgs = liEl.querySelectorAll(':scope > img');
          for (var lii = 0; lii < liImgs.length; lii++) {
            var liImgSrc = (liImgs[lii] as HTMLImageElement).src || '';
            if (liImgSrc.indexOf('/body/') >= 0) continue;
            if (liImgSrc.indexOf('_icon') >= 0) continue;
            colorImgUrl = liImgSrc;
            break;
          }
        }
        if (!colorImgUrl) {
          // Fallback: first img anywhere in li that's not in item-txt (body icon)
          var anyImgs = liEl.querySelectorAll('img');
          for (var aii = 0; aii < anyImgs.length; aii++) {
            var anySrc = (anyImgs[aii] as HTMLImageElement).src || '';
            if (anySrc.indexOf('/body/') >= 0) continue;
            if (anySrc.indexOf('_icon') >= 0) continue;
            // Skip images inside item-txt (description area body icons)
            var inItemTxt = anyImgs[aii].closest('.item-txt');
            if (inItemTxt) continue;
            colorImgUrl = anySrc;
            break;
          }
        }

        result.colors.push({ name: colorName, imageUrl: colorImgUrl });
      }

      // ================================================================
      // SPEC TABLE EXTRACTION
      // ================================================================

      var seenWeights: Record<string, boolean> = {};
      var seenLengths: Record<string, boolean> = {};

      // --- Layout A: Standard — table.bk-th-tbl with <th> headers ---
      var specTableA = document.querySelector('.spec-tbl-area table.bk-th-tbl');
      if (specTableA) {
        var headersA = specTableA.querySelectorAll('th');
        var colLenA = -1, colWtA = -1, colTypeA = -1, colSizeA = -1, colColorA = -1;
        for (var ha = 0; ha < headersA.length; ha++) {
          var htA = (headersA[ha].textContent || '').trim();
          if (htA === '全長' || htA === '全長（針ヌキ）') colLenA = ha;
          if (htA === '重量') colWtA = ha;
          if (htA === 'タイプ' || htA === '沈下タイプ') colTypeA = ha;
          if (htA === 'サイズ') colSizeA = ha;
          if (htA === 'カラー名') colColorA = ha;
        }

        var rowsA = specTableA.querySelectorAll('tbody tr');
        for (var ra = 0; ra < rowsA.length; ra++) {
          var cellsA = rowsA[ra].querySelectorAll('td');

          // Length from 全長 column
          if (colLenA >= 0 && colLenA < cellsA.length) {
            var ltA = (cellsA[colLenA].textContent || '').trim();
            var lmA = ltA.match(/(\d+)\s*mm/);
            if (lmA && !seenLengths[lmA[1]]) {
              seenLengths[lmA[1]] = true;
              result.lengths.push(parseInt(lmA[1], 10));
            }
          }
          // Weight from 重量 column
          if (colWtA >= 0 && colWtA < cellsA.length) {
            var wtA = (cellsA[colWtA].textContent || '').trim();
            var wmA = wtA.match(/([\d.]+)\s*g/);
            if (wmA && !seenWeights[wmA[1]]) {
              seenWeights[wmA[1]] = true;
              result.weights.push(parseFloat(wmA[1]));
            }
          }
          // Type from タイプ/沈下タイプ column
          if (colTypeA >= 0 && colTypeA < cellsA.length && !result.specType) {
            var ttA = (cellsA[colTypeA].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (ttA) result.specType = ttA;
          }
          // Size (for エギ — size like "3.5号")
          if (colSizeA >= 0 && colSizeA < cellsA.length) {
            var szA = (cellsA[colSizeA].textContent || '').trim();
            // Extract mm length from size if present
            var szMm = szA.match(/(\d+)\s*mm/);
            if (szMm && !seenLengths[szMm[1]]) {
              seenLengths[szMm[1]] = true;
              result.lengths.push(parseInt(szMm[1], 10));
            }
          }
          // Only add colors from spec table if primary source found none
          if (result.colors.length === 0 && colColorA >= 0 && colColorA < cellsA.length) {
            var ctA = (cellsA[colColorA].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (ctA && !seenColors[ctA]) {
              seenColors[ctA] = true;
              result.colors.push({ name: ctA, imageUrl: '' });
            }
          }
        }
      }

      // --- Layout B: Summary table — table.wh-tbl in spec-cate-tbl-area ---
      if (result.weights.length === 0) {
        var cateTables = document.querySelectorAll('.spec-cate-tbl-area table.wh-tbl');
        for (var ct = 0; ct < cateTables.length; ct++) {
          var cateRows = cateTables[ct].querySelectorAll('tr');
          for (var cr = 0; cr < cateRows.length; cr++) {
            var cTh = cateRows[cr].querySelector('th, td:first-child');
            var cTd = cateRows[cr].querySelector('td:last-child, td:nth-child(2)');
            if (!cTh || !cTd) continue;
            var label = (cTh.textContent || '').trim();
            var value = (cTd.textContent || '').trim();

            if (label === '全長' || label.indexOf('サイズ') >= 0) {
              var clm = value.match(/(\d+)\s*mm/);
              if (clm && !seenLengths[clm[1]]) {
                seenLengths[clm[1]] = true;
                result.lengths.push(parseInt(clm[1], 10));
              }
            }
            if (label === '重量' || label.indexOf('ウェイト') >= 0 || label.indexOf('ウエイト') >= 0) {
              var cwm = value.match(/([\d.]+)\s*g/);
              if (cwm && !seenWeights[cwm[1]]) {
                seenWeights[cwm[1]] = true;
                result.weights.push(parseFloat(cwm[1]));
              }
            }
            if ((label === 'タイプ' || label === 'Type') && !result.specType) {
              result.specType = value;
            }
          }
        }
      }

      // --- Fallback C: scan page text for weight/length patterns ---
      if (result.weights.length === 0 && result.lengths.length === 0) {
        var bodyText = document.body ? (document.body.textContent || '') : '';
        var lenMatches = bodyText.match(/(\d+)\s*mm/g);
        if (lenMatches) {
          for (var li = 0; li < lenMatches.length && result.lengths.length < 5; li++) {
            var lVal = lenMatches[li].match(/(\d+)/);
            if (lVal) {
              var lNum = parseInt(lVal[1], 10);
              if (lNum >= 20 && lNum <= 500 && !seenLengths[String(lNum)]) {
                seenLengths[String(lNum)] = true;
                result.lengths.push(lNum);
              }
            }
          }
        }
        var wtMatches = bodyText.match(/([\d.]+)\s*g/g);
        if (wtMatches) {
          for (var wi = 0; wi < wtMatches.length && result.weights.length < 5; wi++) {
            var wVal = wtMatches[wi].match(/([\d.]+)/);
            if (wVal) {
              var wNum = parseFloat(wVal[1]);
              if (wNum >= 1 && wNum <= 500 && !seenWeights[String(wNum)]) {
                seenWeights[String(wNum)] = true;
                result.weights.push(wNum);
              }
            }
          }
        }
      }

      return result;
    });

    // --- Build ScrapedLure ---
    var slug = extractSlug(url);
    var name = data.name || 'Unknown';
    var description = data.description || '';
    var specType = data.specType || '';
    var type = detectType(name, description, specType);
    var targetFish = detectTargetFish(name, description, url);

    // Colors — use imageUrl from page.evaluate
    var colors: ScrapedColor[] = [];
    for (var ci = 0; ci < data.colors.length; ci++) {
      var imgUrl = (data.colors[ci].imageUrl || '').trim().replace(/\s+/g, '');
      // Relative URL → absolute URL conversion
      if (imgUrl && imgUrl.indexOf('http') !== 0) {
        imgUrl = 'https://www.yamaria.co.jp' + imgUrl;
      }
      colors.push({
        name: data.colors[ci].name,
        imageUrl: imgUrl,
      });
    }

    // Length — use first unique length
    var length: number | null = data.lengths.length > 0 ? data.lengths[0] : null;

    var result: ScrapedLure = {
      name: name,
      name_kana: '',
      slug: slug,
      manufacturer: 'YAMASHITA',
      manufacturer_slug: 'yamashita',
      type: type,
      target_fish: targetFish,
      description: description,
      price: 0,
      colors: colors,
      weights: data.weights,
      length: length,
      mainImage: data.mainImage || '',
      sourceUrl: url,
    };

    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
