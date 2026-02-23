// scripts/scrapers/maria.ts
// Maria (Yamaria) product page scraper
// Handles lure products from www.yamaria.co.jp/maria/product/detail/{ID}
//
// Site: Server-rendered HTML (custom CMS), no WAF, headless OK.
// Encoding: UTF-8
// Price: NOT available — e-shop (ec.yamaria.com) sells apparel only, no lures → price = 0
//
// TWO page layouts exist:
//   "Standard" (26/33): table.bk-th-tbl with <th> headers
//   "Legacy" (7/33): table.wh-tbl or unstyled table, headers in <td> inside tr.bg_color02
//
// Color images: Extracted from ul.spec-item-list (modern) or div.spec_ > ul > li > dl (legacy)
//
// IMPORTANT: No function declarations/expressions inside page.evaluate().
//   tsx + astro tsconfig injects __name which breaks browser-context eval.
//   All helpers must be inlined using var + function() syntax.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name / spec table type column
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ダイビングペンシル|ダイペン/i, 'ダイビングペンシル'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシルベイト/i, 'ペンシルベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/バイブレーション|VIBRATION/i, 'バイブレーション'],
  [/メタルジグ|ジグ|JIG/i, 'メタルジグ'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/トップウォーター|TOPWATER/i, 'トップウォーター'],
];

function detectType(name: string, description: string, specType: string): string {
  // Step 1: Check product NAME only for specific type keywords (name is reliable)
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(name)) return entry[1];
  }

  // Step 2: Use spec table type if available (authoritative)
  if (specType) {
    var descShortForType = description.substring(0, 200);
    // Check if name or short description hints at pencil
    var hasPencilHint = /ペンシル/.test(name) || /ペンシル/.test(descShortForType);
    if (hasPencilHint && /シンキング/i.test(specType)) return 'シンキングペンシル';
    if (/フローティング/i.test(specType)) return 'フローティングミノー';
    if (/スローシンキング/i.test(specType)) return 'シンキングミノー';
    if (/シンキング/i.test(specType)) return 'シンキングミノー';
    return specType;
  }

  // Step 3: Check description for type keywords (less reliable — may have false positives)
  // Only use the FIRST paragraph / first 150 chars of description to avoid false positives
  var descShort = description.substring(0, 150);
  for (var entry2 of TYPE_KEYWORDS) {
    if (entry2[0].test(descShort)) return entry2[1];
  }

  return 'プラグ';
}

// ---------------------------------------------------------------------------
// Target fish detection — Maria is 100% saltwater
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, description: string): string[] {
  var combined = (name + ' ' + description).toLowerCase();

  // Specific species detection
  if (/メバル|メバリング/.test(combined)) return ['メバル'];
  if (/アジ|アジング/.test(combined)) return ['アジ'];
  if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ'];
  if (/マゴチ/.test(combined)) return ['マゴチ'];
  if (/イカ|エギ|squid/i.test(combined)) return ['イカ'];
  if (/チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];

  // 青物 keywords — very common for Maria products
  if (/青物|ヒラマサ|ブリ|カンパチ|gt|ショアジギ|キャスティング|オフショア|ジギング|磯/.test(combined)) {
    return ['青物'];
  }

  // Default for Maria = シーバス
  return ['シーバス'];
}

// ---------------------------------------------------------------------------
// Slug extraction
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  var match = url.match(/\/detail\/(\d+)/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeMariaPage(url: string): Promise<ScrapedLure> {
  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext();
    var page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Wait for product name
    try {
      await page.waitForSelector('h2.item-ttl', { timeout: 10000 });
    } catch {
      // Some pages may not have the selector — continue anyway
    }

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

      // ---- Product name ----
      var h2 = document.querySelector('h2.item-ttl');
      if (h2) {
        result.name = (h2.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }
      // Fallback: extract from <title> tag  "商品名 - マリア製品情報詳細..."
      result.titleTag = document.title || '';
      if (!result.name && result.titleTag) {
        var titleParts = result.titleTag.split(' - ');
        if (titleParts.length > 0) {
          result.name = titleParts[0].trim();
        }
      }

      // ---- Main image ----
      // Priority 1: image with _main in filename
      var allPageImgs = document.querySelectorAll('img');
      for (var mi = 0; mi < allPageImgs.length; mi++) {
        var imgSrc = (allPageImgs[mi] as HTMLImageElement).src || '';
        if (imgSrc.indexOf('/cms/product/maria/') >= 0 && imgSrc.indexOf('_main') >= 0) {
          result.mainImage = imgSrc;
          break;
        }
      }
      // Fallback: first /cms/product/maria/ image that isn't a title/icon/common image
      if (!result.mainImage) {
        for (var fi = 0; fi < allPageImgs.length; fi++) {
          var fSrc = (allPageImgs[fi] as HTMLImageElement).src || '';
          if (fSrc.indexOf('/cms/product/maria/') >= 0 &&
              fSrc.indexOf('title') < 0 &&
              fSrc.indexOf('common') < 0 &&
              fSrc.indexOf('icon') < 0 &&
              fSrc.indexOf('banner') < 0) {
            // Check it's a meaningful image (not tiny)
            var w = (allPageImgs[fi] as HTMLImageElement).naturalWidth || 0;
            if (w === 0 || w >= 100) {
              result.mainImage = fSrc;
              break;
            }
          }
        }
      }

      // ---- Description ----
      // Collect text from .item-body-area .item-cont-box elements
      var descBlocks = document.querySelectorAll('.item-body-area .item-cont-box');
      var descTexts: string[] = [];
      for (var di = 0; di < descBlocks.length; di++) {
        var txt = (descBlocks[di].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (txt.length > 0) descTexts.push(txt);
      }
      result.description = descTexts.join('\n\n');

      // If description is empty, try the catch copy area
      if (!result.description) {
        var catchArea = document.querySelector('.cont-area .item-body-area, .cont-area p');
        if (catchArea) {
          result.description = (catchArea.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        }
      }

      // ================================================================
      // COLOR EXTRACTION — Primary: ul.spec-item-list (with images)
      // ================================================================

      var seenColors: Record<string, boolean> = {};

      // --- Primary: ul.spec-item-list > li (has both name + image) ---
      var specItemList = document.querySelectorAll('ul.spec-item-list > li');
      for (var sli = 0; sli < specItemList.length; sli++) {
        var liEl = specItemList[sli];

        // Color name from h3.item-ttl (strip <span> tags like "NEW")
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

        // Color image from div.ph
        var colorImgUrl = '';
        var phDiv = liEl.querySelector('div.ph');
        if (phDiv) {
          // Priority 1: hover image (bg-hover-img01 = _off version = normal display)
          var hoverImg = phDiv.querySelector('img.bg-hover-img01');
          if (hoverImg) {
            colorImgUrl = (hoverImg as HTMLImageElement).src || '';
          }
          // Priority 2: regular single image
          if (!colorImgUrl) {
            var regularImg = phDiv.querySelector('img');
            if (regularImg) {
              colorImgUrl = (regularImg as HTMLImageElement).src || '';
            }
          }
        }

        result.colors.push({ name: colorName, imageUrl: colorImgUrl });
      }

      // --- Secondary: Legacy layout — div.spec_ > ul > li > dl (dt=img, dd=name) ---
      if (result.colors.length === 0) {
        var specDiv = document.querySelector('div.spec_');
        if (specDiv) {
          var legacyUls = specDiv.querySelectorAll('ul');
          for (var lui = 0; lui < legacyUls.length; lui++) {
            var legUl = legacyUls[lui];
            // Skip if it has a class (nav lists etc)
            if (legUl.className) continue;
            var legLis = legUl.querySelectorAll('li');
            if (legLis.length < 2) continue; // Need at least 2 colors to be a color list

            for (var lli = 0; lli < legLis.length; lli++) {
              var legLi = legLis[lli];
              // Image from dt > img
              var dtImg = legLi.querySelector('dl > dt > img');
              var legImgUrl = dtImg ? (dtImg as HTMLImageElement).getAttribute('src') || '' : '';
              // Color name from first <p> text in dd
              var ddP = legLi.querySelector('dl > dd > p');
              if (!ddP) {
                // Some pages nest: dl > dd > dl > dd > p
                ddP = legLi.querySelector('dl > dd > dl > dd > p');
              }
              var legColorName = ddP ? (ddP.textContent || '').replace(/[\s\u3000]+/g, ' ').trim() : '';
              if (!legColorName || seenColors[legColorName]) continue;
              seenColors[legColorName] = true;
              result.colors.push({ name: legColorName, imageUrl: legImgUrl });
            }
            // If we found colors from this ul, stop
            if (result.colors.length > 0) break;
          }
        }
      }

      // ================================================================
      // SPEC TABLE EXTRACTION — supports two layouts
      // Extracts weights, lengths, type, and colors (fallback if
      // ul.spec-item-list was empty)
      // ================================================================

      var seenWeights: Record<string, boolean> = {};
      var seenLengths: Record<string, boolean> = {};

      // --- Layout A: Standard — table.bk-th-tbl with <th> headers ---
      var specTableA = document.querySelector('.spec-tbl-area table.bk-th-tbl');
      if (specTableA) {
        var headersA = specTableA.querySelectorAll('th');
        var colLenA = -1, colWtA = -1, colTypeA = -1, colColorA = -1;
        for (var ha = 0; ha < headersA.length; ha++) {
          var htA = (headersA[ha].textContent || '').trim();
          if (htA === '全長') colLenA = ha;
          if (htA === '重量') colWtA = ha;
          if (htA === 'タイプ') colTypeA = ha;
          if (htA === 'カラー') colColorA = ha;
        }

        var rowsA = specTableA.querySelectorAll('tbody tr');
        for (var ra = 0; ra < rowsA.length; ra++) {
          var cellsA = rowsA[ra].querySelectorAll('td');

          if (colLenA >= 0 && colLenA < cellsA.length) {
            var ltA = (cellsA[colLenA].textContent || '').trim();
            var lmA = ltA.match(/(\d+)\s*mm/);
            if (lmA && !seenLengths[lmA[1]]) {
              seenLengths[lmA[1]] = true;
              result.lengths.push(parseInt(lmA[1], 10));
            }
          }
          if (colWtA >= 0 && colWtA < cellsA.length) {
            var wtA = (cellsA[colWtA].textContent || '').trim();
            var wmA = wtA.match(/([\d.]+)\s*g/);
            if (wmA && !seenWeights[wmA[1]]) {
              seenWeights[wmA[1]] = true;
              result.weights.push(parseFloat(wmA[1]));
            }
          }
          if (colTypeA >= 0 && colTypeA < cellsA.length && !result.specType) {
            var ttA = (cellsA[colTypeA].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (ttA) result.specType = ttA;
          }
          // Only add colors from spec table if primary source (spec-item-list) found none
          if (result.colors.length === 0 && colColorA >= 0 && colColorA < cellsA.length) {
            var ctA = (cellsA[colColorA].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (ctA && !seenColors[ctA]) {
              seenColors[ctA] = true;
              result.colors.push({ name: ctA, imageUrl: '' });
            }
          }
        }
      }

      // --- Layout B: Legacy — table.wh-tbl or unstyled table with <td> headers ---
      // Only use if Layout A found nothing
      if (result.colors.length === 0 && result.weights.length === 0) {
        // Find all tables: first inside .spec-tbl-area, then any table on the page
        var allSpecTables = document.querySelectorAll('.spec-tbl-area table, .cont-area table, table');
        for (var ti = 0; ti < allSpecTables.length; ti++) {
          var tbl = allSpecTables[ti];
          // Skip if it's the bk-th-tbl we already processed
          if (tbl.classList.contains('bk-th-tbl')) continue;

          // Detect header row: look for tr.bg_color02 specifically (the darkest header row)
          // NOTE: data rows also have bg_color00/bg_color01 classes (alternating zebra rows)
          // so we ONLY match bg_color02 as the header
          var allRows = tbl.querySelectorAll('tr');
          var headerRow: Element | null = null;
          var dataRows: Element[] = [];
          for (var tri = 0; tri < allRows.length; tri++) {
            var rowCls = (allRows[tri] as HTMLElement).className || '';
            if (rowCls.indexOf('bg_color02') >= 0) {
              headerRow = allRows[tri];
            } else if (headerRow) {
              dataRows.push(allRows[tri]);
            }
          }
          // If no bg_color02 row, try first row as header if it contains spec-like text
          if (!headerRow && allRows.length > 1) {
            var firstRowText = (allRows[0].textContent || '').trim();
            if (firstRowText.indexOf('カラー') >= 0 || firstRowText.indexOf('全長') >= 0 || firstRowText.indexOf('製品名') >= 0) {
              headerRow = allRows[0];
              for (var dri = 1; dri < allRows.length; dri++) {
                dataRows.push(allRows[dri]);
              }
            }
          }

          if (!headerRow || dataRows.length === 0) continue;

          // Map columns from header <td> elements
          var hCells = headerRow.querySelectorAll('td, th');
          var colLenB = -1, colWtB = -1, colTypeB = -1, colColorB = -1;
          for (var hb = 0; hb < hCells.length; hb++) {
            var htB = (hCells[hb].textContent || '').trim();
            if (htB === '全長') colLenB = hb;
            if (htB === '重量') colWtB = hb;
            if (htB === 'タイプ') colTypeB = hb;
            if (htB === 'カラー名' || htB === 'カラー') colColorB = hb;
          }

          // Extract data rows
          for (var rb = 0; rb < dataRows.length; rb++) {
            var cellsB = dataRows[rb].querySelectorAll('td');

            if (colLenB >= 0 && colLenB < cellsB.length) {
              var ltB = (cellsB[colLenB].textContent || '').trim();
              var lmB = ltB.match(/(\d+)\s*mm/);
              if (lmB && !seenLengths[lmB[1]]) {
                seenLengths[lmB[1]] = true;
                result.lengths.push(parseInt(lmB[1], 10));
              }
            }
            if (colWtB >= 0 && colWtB < cellsB.length) {
              var wtB = (cellsB[colWtB].textContent || '').trim();
              var wmB = wtB.match(/([\d.]+)\s*g/);
              if (wmB && !seenWeights[wmB[1]]) {
                seenWeights[wmB[1]] = true;
                result.weights.push(parseFloat(wmB[1]));
              }
            }
            if (colTypeB >= 0 && colTypeB < cellsB.length && !result.specType) {
              var ttB = (cellsB[colTypeB].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
              if (ttB) result.specType = ttB;
            }
            if (colColorB >= 0 && colColorB < cellsB.length) {
              var ctB = (cellsB[colColorB].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
              if (ctB && !seenColors[ctB]) {
                seenColors[ctB] = true;
                result.colors.push({ name: ctB, imageUrl: '' });
              }
            }
          }

          // If we found data from this table, stop
          if (result.colors.length > 0 || result.weights.length > 0) break;
        }
      }

      // --- Fallback C: .spec-cate-tbl-area summary tables ---
      // These contain per-size summary (length/weight) but no color info
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

      // --- Fallback D: scan entire page text for weight/length patterns ---
      // Last resort for pages with no structured spec data
      if (result.weights.length === 0 && result.lengths.length === 0) {
        var bodyText = document.body ? (document.body.textContent || '') : '';
        // Extract all "Xmm" patterns
        var lenMatches = bodyText.match(/(\d+)\s*mm/g);
        if (lenMatches) {
          for (var li = 0; li < lenMatches.length && result.lengths.length < 5; li++) {
            var lVal = lenMatches[li].match(/(\d+)/);
            if (lVal) {
              var lNum = parseInt(lVal[1], 10);
              // Filter reasonable lure lengths (20mm - 500mm)
              if (lNum >= 20 && lNum <= 500 && !seenLengths[String(lNum)]) {
                seenLengths[String(lNum)] = true;
                result.lengths.push(lNum);
              }
            }
          }
        }
        // Extract all "Xg" patterns
        var wtMatches = bodyText.match(/([\d.]+)\s*g/g);
        if (wtMatches) {
          for (var wi = 0; wi < wtMatches.length && result.weights.length < 5; wi++) {
            var wVal = wtMatches[wi].match(/([\d.]+)/);
            if (wVal) {
              var wNum = parseFloat(wVal[1]);
              // Filter reasonable lure weights (1g - 500g)
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
    var targetFish = detectTargetFish(name, description);

    // Colors — use imageUrl from page.evaluate (primary: spec-item-list, fallback: spec table)
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
      manufacturer: 'Maria',
      manufacturer_slug: 'maria',
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
