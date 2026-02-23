// scripts/scrapers/bassday.ts
// Bassday product page scraper
// Handles lure products from www.bassday.co.jp/item/?i={ID}
//
// Site: Custom CMS with JS rendering (_websystem4item1), no WAF, headless OK.
// Encoding: UTF-8
// Price: Available in spec text — tax-included price ¥X,XXX（税抜¥X,XXX）
// Images: WebP format at _websystem4item1/webroot/attach/ paths
// Colors: article elements inside div.color — img with data-flyout for hi-res
//
// Multi-size products: Multiple <p> elements inside div.inner each with one
//   size's spec (name/price/size/weight). All p tags must be scanned.
//
// Category→target_fish: Derived from <title> tag category name or _categoryId JS var
//   c=1,2 → トラウト, c=4 → シーバス, c=5 → メバル/アジ, c=6 → 青物, c=7 → ブラックバス
//
// IMPORTANT: No function declarations/expressions inside page.evaluate().
//   tsx + astro tsconfig injects __name which breaks browser-context eval.
//   All helpers must be inlined using var + function() syntax.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/レンジバイブ|VIB|バイブ/i, 'バイブレーション'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ダイビングペンシル|ダイペン/i, 'ダイビングペンシル'],
  [/シュガペン|シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW|シュガーミノー|SUGAR MINNOW|シュガミノー/i, 'ミノー'],
  [/バイブレーション|VIBRATION/i, 'バイブレーション'],
  [/メタルバイブ/i, 'メタルバイブ'],
  [/メタルジグ|ジグ|JIG|バンジー/i, 'メタルジグ'],
  [/クランク|CRANK|シュガディープ|SUGAR DEEP/i, 'クランクベイト'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ワーム|WORM|クロー|CRAW/i, 'ワーム'],
  [/トップウォーター|TOPWATER/i, 'トップウォーター'],
];

function detectType(name: string, description: string): string {
  // Check product name first (most reliable)
  for (var entry of TYPE_KEYWORDS) {
    if (entry[0].test(name)) return entry[1];
  }

  // F/S suffix detection for ambiguous names
  if (/\bF\b/.test(name) && /ミノー|minnow/i.test(description)) return 'フローティングミノー';
  if (/\bS\b/.test(name) && /ミノー|minnow/i.test(description)) return 'シンキングミノー';

  // Check description (first 200 chars)
  var descShort = description.substring(0, 200);
  for (var entry2 of TYPE_KEYWORDS) {
    if (entry2[0].test(descShort)) return entry2[1];
  }

  return 'プラグ';
}

// ---------------------------------------------------------------------------
// Target fish detection from title category name
// ---------------------------------------------------------------------------

function detectTargetFish(titleTag: string, name: string, description: string): string[] {
  // Priority 1: Category from title tag
  // Format: "{商品名} | {カテゴリ名} | 製品情報 | バスデイ株式会社"
  var combined = (titleTag + ' ' + name + ' ' + description).toLowerCase();

  if (/ネイティブトラウト|エリア|フレッシュウォーター|トラウト/.test(combined)) return ['トラウト'];
  if (/バス\s|バスフィッシング|ブラックバス/.test(combined)) return ['ブラックバス'];
  if (/オフショア/.test(combined)) return ['青物'];
  if (/ライトソルト/.test(combined)) {
    // Refine: check product name for specific species
    if (/メバル|メバリング/.test(combined)) return ['メバル'];
    if (/アジ|アジング/.test(combined)) return ['アジ'];
    return ['メバル', 'アジ'];
  }

  // ソルトウォーター — refine by product name
  if (/青物|ヒラマサ|ブリ|カンパチ|ショアジギ|ジギング/.test(combined)) return ['青物'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ'];
  if (/チヌ|クロダイ|黒鯛/.test(combined)) return ['クロダイ'];
  if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];

  // Default for saltwater = シーバス
  return ['シーバス'];
}

// ---------------------------------------------------------------------------
// Slug extraction
// ---------------------------------------------------------------------------

function extractSlug(url: string): string {
  var match = url.match(/[?&]i=(\d+)/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeBassdayPage(url: string): Promise<ScrapedLure> {
  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext();
    var page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // JS rendering needed — wait for content
    await page.waitForTimeout(3000);

    // Wait for spec area to appear
    try {
      await page.waitForSelector('div.colorwrapper', { timeout: 10000 });
    } catch {
      // Some pages may not have this — continue
    }

    // --- Extract all data via page.evaluate ---
    var data = await page.evaluate(function () {
      var result = {
        names: [] as string[],
        prices: [] as number[],
        lengths: [] as number[],
        weights: [] as number[],
        description: '',
        titleTag: '',
        mainImage: '',
        colors: [] as Array<{ name: string; imageUrl: string }>,
      };

      // ---- Title tag (for category detection + name fallback) ----
      result.titleTag = document.title || '';

      // ---- Product name from title tag (most reliable, no HTML noise) ----
      if (result.titleTag) {
        var titleParts = result.titleTag.split(' | ');
        if (titleParts.length > 0 && titleParts[0].trim().length > 0) {
          result.names.push(titleParts[0].trim());
        }
      }

      // ---- Spec extraction from ALL <p> tags inside div.inner ----
      // Multi-size products have multiple p elements, each with one size's spec
      var innerDiv = document.querySelector('div.colorwrapper div.inner');
      if (innerDiv) {
        var pTags = innerDiv.querySelectorAll('p');
        for (var pi = 0; pi < pTags.length; pi++) {
          var pText = (pTags[pi].textContent || '').replace(/[\u3000]+/g, ' ');
          // Split by line breaks (BR tags become \n in textContent)
          var lines = pText.split(/\n/);

          for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();

            // Price: 価格：¥2,255（税抜¥2,050）→ take tax-included (first number)
            var priceMatch = line.match(/価格[：:].*?[¥￥]([\d,]+)/);
            if (priceMatch) {
              var priceVal = parseInt(priceMatch[1].replace(/,/g, ''), 10);
              if (priceVal > 0) result.prices.push(priceVal);
            }

            // Size: サイズ：75㎜  or  サイズ：75mm
            // ㎜ is U+339C (fullwidth mm symbol)
            var sizeMatch = line.match(/サイズ[：:]\s*(\d+)\s*[㎜]/) || line.match(/サイズ[：:]\s*(\d+)\s*mm/i);
            if (sizeMatch) {
              var sizeVal = parseInt(sizeMatch[1], 10);
              if (sizeVal > 0) result.lengths.push(sizeVal);
            }

            // Weight: ウエイト：11g or ウェイト：11g
            var weightMatch = line.match(/ウ[エェ]イト[：:]\s*([\d.]+)\s*g/i);
            if (weightMatch) {
              var weightVal = parseFloat(weightMatch[1]);
              if (weightVal > 0) result.weights.push(weightVal);
            }
          }

          // Also grab name from first line of first p (fallback)
          if (pi === 0 && lines.length > 0) {
            var firstLine = lines[0].trim();
            // First line of spec p is the product name (e.g., "ハーデス75F")
            if (firstLine.length > 0 && firstLine.indexOf('価格') < 0) {
              result.names.push(firstLine);
            }
          }
        }

        // ---- Main image: first img inside div.item ----
        var itemDiv = innerDiv.querySelector('div.item');
        if (itemDiv) {
          var itemImg = itemDiv.querySelector('img');
          if (itemImg) {
            result.mainImage = (itemImg as HTMLImageElement).src || '';
          }
        }
      }

      // ---- Description: div.subject + div.body ----
      var descParts: string[] = [];
      var subjectEl = document.querySelector('div.colorwrapper div.subject');
      if (subjectEl) {
        var subText = (subjectEl.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (subText) descParts.push(subText);
      }
      var bodyEl = document.querySelector('div.colorwrapper div.body');
      if (bodyEl) {
        var bodyText = (bodyEl.textContent || '').replace(/[\s\u3000]+/g, ' ').trim();
        if (bodyText) descParts.push(bodyText);
      }
      result.description = descParts.join('\n\n');

      // ---- Colors: div.color article elements ----
      var colorArticles = document.querySelectorAll('div.color article');
      var seenColors: Record<string, boolean> = {};
      for (var ci = 0; ci < colorArticles.length; ci++) {
        var article = colorArticles[ci];
        // Color name from <p> element
        var colorP = article.querySelector('p');
        var colorName = colorP ? (colorP.textContent || '').replace(/[\s\u3000]+/g, ' ').trim() : '';
        if (!colorName || seenColors[colorName]) continue;
        seenColors[colorName] = true;

        // Color image: prefer data-flyout (hi-res), fallback to src
        var colorImg = article.querySelector('div.img img');
        var colorImgUrl = '';
        if (colorImg) {
          colorImgUrl = (colorImg as HTMLImageElement).getAttribute('data-flyout') || '';
          if (!colorImgUrl) {
            colorImgUrl = (colorImg as HTMLImageElement).src || '';
          }
        }

        result.colors.push({ name: colorName, imageUrl: colorImgUrl });
      }

      return result;
    });

    // --- Resolve relative URLs to absolute ---
    var baseUrl = 'https://www.bassday.co.jp/';

    // Main image
    var mainImage = data.mainImage || '';
    if (mainImage && mainImage.indexOf('http') !== 0) {
      // Remove leading ../ and resolve
      mainImage = mainImage.replace(/^(\.\.\/)+/, '');
      mainImage = baseUrl + mainImage;
    }

    // Color images
    var colors: ScrapedColor[] = [];
    for (var ci2 = 0; ci2 < data.colors.length; ci2++) {
      var cUrl = data.colors[ci2].imageUrl;
      if (cUrl && cUrl.indexOf('http') !== 0) {
        cUrl = cUrl.replace(/^(\.\.\/)+/, '');
        cUrl = baseUrl + cUrl;
      }
      colors.push({
        name: data.colors[ci2].name,
        imageUrl: cUrl,
      });
    }

    // --- Build result ---
    var slug = extractSlug(url);
    var name = data.names.length > 0 ? data.names[0] : 'Unknown';
    var description = data.description || '';
    var titleTag = data.titleTag || '';
    var type = detectType(name, description);
    var targetFish = detectTargetFish(titleTag, name, description);

    // Price — use first (tax-included) or 0
    var price = data.prices.length > 0 ? data.prices[0] : 0;

    // Dedup weights and lengths
    var seenW: Record<string, boolean> = {};
    var uniqueWeights: number[] = [];
    for (var wi = 0; wi < data.weights.length; wi++) {
      var wKey = String(data.weights[wi]);
      if (!seenW[wKey]) {
        seenW[wKey] = true;
        uniqueWeights.push(data.weights[wi]);
      }
    }
    var seenL: Record<string, boolean> = {};
    var uniqueLengths: number[] = [];
    for (var li2 = 0; li2 < data.lengths.length; li2++) {
      var lKey = String(data.lengths[li2]);
      if (!seenL[lKey]) {
        seenL[lKey] = true;
        uniqueLengths.push(data.lengths[li2]);
      }
    }

    var length: number | null = uniqueLengths.length > 0 ? uniqueLengths[0] : null;

    var result: ScrapedLure = {
      name: name,
      name_kana: '',
      slug: slug,
      manufacturer: 'Bassday',
      manufacturer_slug: 'bassday',
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
