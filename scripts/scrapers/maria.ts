// scripts/scrapers/maria.ts
// Maria (Yamaria) product page scraper
// Handles lure products from www.yamaria.co.jp/maria/product/detail/{ID}
//
// Site: Server-rendered HTML (custom CMS), no WAF, headless OK.
// Encoding: UTF-8
// Price: NOT available — e-shop (ec.yamaria.com) sells apparel only, no lures → price = 0
// Spec table: table.bk-th-tbl with variable headers (some have "タイプ" column, some don't)
// Color images: NOT available on most product pages — colors extracted from spec table "カラー" column
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
        colors: [] as Array<{ name: string }>,
      };

      // ---- Product name ----
      var h2 = document.querySelector('h2.item-ttl');
      if (h2) {
        result.name = (h2.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
      }

      // ---- Main image ----
      var mainImgCandidates = document.querySelectorAll('.cont-area img');
      for (var mi = 0; mi < mainImgCandidates.length; mi++) {
        var imgSrc = (mainImgCandidates[mi] as HTMLImageElement).src || '';
        if (imgSrc.indexOf('_main') >= 0 || imgSrc.indexOf('/cms/product/') >= 0) {
          result.mainImage = imgSrc;
          break;
        }
      }

      // ---- Description ----
      // Collect text from .item-body-area .item-cont-box elements
      var descBlocks = document.querySelectorAll('.item-body-area .item-cont-box');
      var descTexts = [];
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

      // ---- Spec table: table.bk-th-tbl ----
      var specTable = document.querySelector('.spec-tbl-area table.bk-th-tbl');
      if (specTable) {
        // Detect column indices from headers
        var headers = specTable.querySelectorAll('th');
        var colLength = -1;
        var colWeight = -1;
        var colType = -1;
        var colColor = -1;
        for (var hi = 0; hi < headers.length; hi++) {
          var hText = (headers[hi].textContent || '').trim();
          if (hText === '全長') colLength = hi;
          if (hText === '重量') colWeight = hi;
          if (hText === 'タイプ') colType = hi;
          if (hText === 'カラー') colColor = hi;
        }

        // Extract data from rows
        var rows = specTable.querySelectorAll('tbody tr');
        var seenWeights: Record<string, boolean> = {};
        var seenLengths: Record<string, boolean> = {};
        var seenColors: Record<string, boolean> = {};

        for (var ri = 0; ri < rows.length; ri++) {
          var cells = rows[ri].querySelectorAll('td');

          // Length
          if (colLength >= 0 && colLength < cells.length) {
            var lenText = (cells[colLength].textContent || '').trim();
            var lenMatch = lenText.match(/(\d+)\s*mm/);
            if (lenMatch && !seenLengths[lenMatch[1]]) {
              seenLengths[lenMatch[1]] = true;
              result.lengths.push(parseInt(lenMatch[1], 10));
            }
          }

          // Weight
          if (colWeight >= 0 && colWeight < cells.length) {
            var wText = (cells[colWeight].textContent || '').trim();
            var wMatch = wText.match(/([\d.]+)\s*g/);
            if (wMatch && !seenWeights[wMatch[1]]) {
              seenWeights[wMatch[1]] = true;
              result.weights.push(parseFloat(wMatch[1]));
            }
          }

          // Type (first non-empty value)
          if (colType >= 0 && colType < cells.length && !result.specType) {
            var tText = (cells[colType].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (tText) result.specType = tText;
          }

          // Color name
          if (colColor >= 0 && colColor < cells.length) {
            var cText = (cells[colColor].textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
            if (cText && !seenColors[cText]) {
              seenColors[cText] = true;
              result.colors.push({ name: cText });
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

    // Colors from spec table (no image URLs available)
    var colors: ScrapedColor[] = [];
    for (var ci = 0; ci < data.colors.length; ci++) {
      colors.push({
        name: data.colors[ci].name,
        imageUrl: '',
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
