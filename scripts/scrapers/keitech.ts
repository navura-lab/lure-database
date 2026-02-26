// scripts/scrapers/keitech.ts
// Keitech (ケイテック) product page scraper
// Handles lure products from keitech.co.jp/pages/{ID}/
//
// Site: Custom CMS (NOT WordPress), server-side rendered HTML.
// No REST API, no sitemap — product URLs enumerated from /pages/636/ listing.
// URL pattern: /pages/{numeric_id}/
// Specs are embedded in body text, NOT in <table> or structured elements.
// Color names: "NNN：ColorName" text nodes, images via <a><img></a> before text.
// Price: "価格：XXX円（税込YYY円）" or "●価格：XXX円" format.
// Weight: "１尾重量： XX ｇ" format (full-width digits + spaces).
// All products are bass lures — target fish = ブラックバス.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product category / name
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/バズベイト|buzzbait/i, 'バズベイト'],
  [/スピナーベイト|spinnerbait/i, 'スピナーベイト'],
  [/ラバージグ|rubber\s*jig|キャスティングジグ|フットボールジグ|モデル[ⅠⅡⅢⅣ]/i, 'ラバージグ'],
  [/ジグヘッド|jig\s*head|ラウンドジグ|フットボールシェイキー/i, 'ジグヘッド'],
  [/スピンジグ/i, 'スピンジグ'],
  [/シャッド|shad/i, 'ワーム'],
  [/インパクト|impact|シャイナー|shiner|フラッパー|flapper|リーチ|leech|シェイカー|shaker|スパイダー|spider|ビーバー|beaver|カマロン|チャンク|chunk|チューブ|tube|ワグ|スプリット|split/i, 'ワーム'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [keitech] ${msg}`);
}

function extractSlug(url: string): string {
  var m = url.match(/\/pages\/(\d+)\/?/);
  if (m) return m[1];
  return url.replace(/\/$/, '').split('/').pop() || '';
}

function detectType(name: string): string {
  for (var [re, type] of NAME_TYPE_MAP) {
    if (re.test(name)) return type;
  }
  return 'ワーム'; // Keitech specializes in soft lures
}

/**
 * Parse price from text. Prefers tax-included price.
 * Format: "価格：740円（税込814円）" or "●価格：1,080円（税込み1,188円）"
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  // Try tax-included first: 税込XXX円 or 税込みXXX円
  var taxIncl = text.match(/税込[み]?\s*([0-9,０-９，]+)\s*円/);
  if (taxIncl) {
    return parseInt(taxIncl[1].replace(/[,，]/g, '').replace(/[０-９]/g, function(c) {
      return String(c.charCodeAt(0) - 0xFF10);
    }), 10);
  }
  // Fallback: first price
  var m = text.match(/([0-9,０-９，]+)\s*円/);
  if (m) {
    return parseInt(m[1].replace(/[,，]/g, '').replace(/[０-９]/g, function(c) {
      return String(c.charCodeAt(0) - 0xFF10);
    }), 10);
  }
  return 0;
}

/**
 * Parse weight from text.
 * Format: "１尾重量： ２．２ ｇ" (full-width digits and spaces)
 */
function parseWeights(text: string): number[] {
  var weights: number[] = [];
  // Normalize full-width chars
  var normalized = text
    .replace(/[０-９]/g, function(c) { return String(c.charCodeAt(0) - 0xFF10); })
    .replace(/．/g, '.')
    .replace(/\s+/g, ' ');

  // Match all weight occurrences
  var re = /[一１1]尾重量[：:]\s*([\d.]+)\s*[ｇg]/g;
  var m;
  var seen = new Set<number>();
  while ((m = re.exec(normalized)) !== null) {
    var w = parseFloat(m[1]);
    if (w > 0 && !seen.has(w)) {
      seen.add(w);
      weights.push(w);
    }
  }
  // Also try oz format: ３/８oz
  var ozRe = /([０-９\d]+)[/／]([０-９\d]+)\s*oz/gi;
  var ozNorm = text.replace(/[０-９]/g, function(c) { return String(c.charCodeAt(0) - 0xFF10); });
  while ((m = ozRe.exec(ozNorm)) !== null) {
    var ozW = Math.round((parseInt(m[1]) / parseInt(m[2])) * 28.3495 * 10) / 10;
    if (ozW > 0 && !seen.has(ozW)) {
      seen.add(ozW);
      weights.push(ozW);
    }
  }
  return weights.sort(function(a, b) { return a - b; });
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeKeitechPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log(`Navigating to ${url} (attempt ${attempt}/${maxRetries})`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      } catch (navErr: any) {
        if (attempt === maxRetries) throw navErr;
        var backoff = attempt * 3000;
        log(`Navigation failed (attempt ${attempt}): ${navErr.message?.substring(0, 80)} — retrying in ${backoff}ms`);
        await new Promise(function(r) { setTimeout(r, backoff); });
      }
    }

    var pageId = extractSlug(url);
    log(`Page ID: ${pageId}`);

    // ---------- Extract all data from page ----------
    var data = await page.evaluate(function() {
      // Title: h2 = English name, first h3 = Japanese name
      var h2 = document.querySelector('h2');
      var titleEn = h2 ? h2.textContent?.trim() || '' : '';

      var h3s = document.querySelectorAll('h3');
      var titleJa = '';
      if (h3s.length > 0) {
        titleJa = h3s[0].textContent?.trim() || '';
      }

      // Main product image: first large image in /files/libs/ (skip logo)
      var mainImage = '';
      var allImgs = document.querySelectorAll('img[src*="/files/libs/"]');
      for (var mi = 0; mi < allImgs.length; mi++) {
        var src = allImgs[mi].getAttribute('src') || '';
        // Skip logo and tiny images
        if (src.includes('/5945/')) continue; // Logo
        if (src.includes('/t/')) continue; // Thumbnails
        mainImage = src;
        break;
      }
      // Make absolute
      if (mainImage && !mainImage.startsWith('http')) {
        mainImage = 'https://keitech.co.jp' + mainImage;
      }

      // Description: first meaningful paragraph
      var description = '';
      var ps = document.querySelectorAll('p');
      for (var pi = 0; pi < ps.length; pi++) {
        var pText = ps[pi].textContent?.trim() || '';
        if (pText.length > 30 && !pText.includes('Copyright') && !pText.includes('cookie')) {
          description = pText.substring(0, 500);
          break;
        }
      }

      // Full body text for specs parsing
      var bodyText = document.body.textContent || '';

      // Color data: structured extraction from block-based CMS
      // Each color lives in a .record div inside a [data-block-id] block
      // whose h3 title contains "Color Chart" or "Color".
      // Record structure: .media img (image) + .text-design-set-area (name)
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorSeen = new Set<string>();

      // Step 1: Find all blocks whose title contains "Color"
      var allBlocks = document.querySelectorAll('[data-block-id]');
      var colorBlocks: Element[] = [];
      for (var bi = 0; bi < allBlocks.length; bi++) {
        var blockTitle = allBlocks[bi].querySelector('h3');
        if (blockTitle) {
          var titleText = blockTitle.textContent || '';
          if (/Color/i.test(titleText)) {
            colorBlocks.push(allBlocks[bi]);
          }
        }
      }

      // Step 2: Extract colors from each color block
      for (var cbi = 0; cbi < colorBlocks.length; cbi++) {
        var records = colorBlocks[cbi].querySelectorAll('.record');
        for (var ri = 0; ri < records.length; ri++) {
          var rec = records[ri];

          // Image: first img inside .media (thumbnail path has /t/)
          var colorImgUrl = '';
          var imgEl = rec.querySelector('.media img');
          if (imgEl) {
            var rawSrc = imgEl.getAttribute('src') || '';
            if (rawSrc) {
              // Convert thumbnail to full-size: /t/ → remove
              rawSrc = rawSrc.replace('/t/', '/');
              if (!rawSrc.startsWith('http')) {
                rawSrc = 'https://keitech.co.jp' + rawSrc;
              }
              colorImgUrl = rawSrc;
            }
          }

          // Text: first div inside .text-design-set-area
          var textArea = rec.querySelector('.text-design-set-area');
          if (!textArea) continue;
          var firstDiv = textArea.querySelector('div');
          if (!firstDiv) continue;
          var colorText = (firstDiv.textContent || '').trim();
          if (!colorText || colorText.length < 2) continue;

          // Clean up: remove notes like ※...
          colorText = colorText.replace(/※.*$/, '').trim();

          // Deduplicate by color name
          if (!colorSeen.has(colorText)) {
            colorSeen.add(colorText);
            colors.push({ name: colorText, imageUrl: colorImgUrl });
          }
        }
      }

      return {
        titleEn: titleEn,
        titleJa: titleJa,
        mainImage: mainImage,
        description: description,
        bodyText: bodyText,
        colors: colors,
      };
    });

    log(`Product: ${data.titleEn} (${data.titleJa})`);
    log(`Main image: ${data.mainImage}`);
    log(`Colors: ${data.colors.length}`);

    // ---------- Post-process ----------

    var name = data.titleEn || data.titleJa;
    var nameKana = data.titleJa;
    var slug = name.toLowerCase()
      .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) slug = 'keitech-' + pageId;

    var type = detectType(name + ' ' + data.titleJa);
    log(`Type: ${type}`);

    // Parse price (use first occurrence)
    var price = parsePrice(data.bodyText);
    log(`Price: ${price}`);

    // Parse weights
    var weights = parseWeights(data.bodyText);
    log(`Weights: ${JSON.stringify(weights)}`);

    // Determine length from size mentions (e.g. "2\"", "3\"" in h3 subtitles)
    // Keitech uses inches — we'll take the primary/first size
    var lengthMm: number | null = null;
    var sizeMatch = data.bodyText.match(/(\d+(?:\.\d+)?)[\"″']\s*[（(]/);
    if (sizeMatch) {
      lengthMm = Math.round(parseFloat(sizeMatch[1]) * 25.4 * 10) / 10;
    }
    log(`Length: ${lengthMm}mm`);

    var result: ScrapedLure = {
      name: name,
      name_kana: nameKana,
      slug: slug,
      manufacturer: 'Keitech',
      manufacturer_slug: 'keitech',
      type: type,
      target_fish: ['ブラックバス'],
      description: data.description.substring(0, 500),
      price: price,
      colors: data.colors,
      weights: weights,
      length: lengthMm,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log(`Done: ${result.name} | type=${result.type} | colors=${result.colors.length} | weights=${JSON.stringify(result.weights)} | length=${result.length}mm | price=${result.price}`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
