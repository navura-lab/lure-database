// scripts/scrapers/thirtyfour.ts
// 34 / THIRTY FOUR (34net.jp) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: WordPress + custom theme "34", WP REST API available
// No WAF, no anti-bot measures.
//
// Product URL pattern: /products/worm/{slug}/
// Spec: table.product_tbl (th/td pairs)
//   - 全長 → length (inches), 販売価格 → price (税込)
// Colors: li.cosGrid_Inner4 within "Color variation" section
//   - Name: first <strong> text
//   - Image: a[href] (full size) or img[src]
// Main image: first wp-content/uploads image in content area
// アジング専門メーカー。ワーム中心。

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); })
    .trim();
}

function toSlug(urlStr: string): string {
  var parts = urlStr.replace(/\/+$/, '').split('/');
  var last = parts[parts.length - 1] || '';
  return last
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// inches to mm conversion
function inchesToMm(inches: number): number {
  return Math.round(inches * 25.4);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeThirtyfourPage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[thirtyfour] HTTP ' + res.status + ' for ' + url);
  var html = await res.text();

  // -- Product name from <title>
  // "MEDUSA - アジング ライトゲーム フィッシング｜THIRTY34FOUR（サーティフォー）"
  var titleMatch = html.match(/<title>(.*?)<\/title>/);
  var rawTitle = titleMatch ? stripTags(titleMatch[1]) : '';
  var name = rawTitle.replace(/\s*[-–—]\s*アジング.*$/i, '').replace(/\s*[-–—]\s*THIRTY.*$/i, '').trim();

  // Check for kana name: "ビーディー" in title means the title IS kana
  var nameKana = '';
  // If name contains katakana, it IS the kana; try to get English name from h3
  var h3Match = html.match(/class="modProductsContent-Title[^"]*"[^>]*>(.*?)<\/h3>/);
  var h3Name = h3Match ? stripTags(h3Match[1]).replace(/\s*\d+\.?\d*\s*in\.?$/i, '').trim() : '';
  if (h3Name && h3Name !== name) {
    // If h3 has the English name and title has kana
    if (/[\u30A0-\u30FF]/.test(name) && /^[A-Za-z]/.test(h3Name)) {
      nameKana = name;
      name = h3Name;
    } else if (/^[A-Za-z]/.test(name) && /[\u30A0-\u30FF]/.test(h3Name)) {
      nameKana = h3Name;
    }
  }

  console.log('[thirtyfour] Product: ' + name);

  // -- Spec table
  var specData: Record<string, string> = {};
  var tableMatch = html.match(/<table class="product_tbl">([\s\S]*?)<\/table>/);
  if (tableMatch) {
    var rowRegex = /<th>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/gi;
    var rMatch: RegExpExecArray | null;
    while ((rMatch = rowRegex.exec(tableMatch[1])) !== null) {
      var label = stripTags(rMatch[1]);
      var value = stripTags(rMatch[2]);
      if (label && value) specData[label] = value;
    }
  }

  // -- Length (inches → mm)
  var lengthVal: number | null = null;
  var lengthStr = specData['全長'] || '';
  var inchMatch = lengthStr.match(/([\d.]+)\s*in/i);
  if (inchMatch) {
    lengthVal = inchesToMm(parseFloat(inchMatch[1]));
  } else {
    var mmMatch = lengthStr.match(/([\d.]+)\s*mm/i);
    if (mmMatch) lengthVal = Math.round(parseFloat(mmMatch[1]));
  }

  // -- Weight (ワーム系は重量記載なしが多い)
  var weights: number[] = [];
  var weightStr = specData['重量'] || specData['重さ'] || '';
  var weightMatches = weightStr.match(/(\d+(?:\.\d+)?)\s*g/gi);
  if (weightMatches) {
    weightMatches.forEach(function(wm) {
      var n = parseFloat(wm);
      if (n > 0 && weights.indexOf(n) === -1) weights.push(n);
    });
  }

  // -- Price (税込)
  var price = 0;
  var priceStr = specData['販売価格'] || specData['価格'] || '';
  var taxMatch = priceStr.match(/([\d,]+)\s*円\s*[（(]?\s*税込/);
  if (taxMatch) {
    price = parseInt(taxMatch[1].replace(/,/g, ''), 10);
  } else {
    var yenMatch = priceStr.match(/([\d,]+)\s*円/);
    if (yenMatch) {
      price = parseInt(yenMatch[1].replace(/,/g, ''), 10);
    }
  }

  // -- Type
  var type = 'ワーム'; // 34 is almost exclusively worms for lure category

  // -- Main image
  var mainImage = '';
  var imgMatch = html.match(/src="(https:\/\/34net\.jp\/wp-content\/uploads\/[^"]*\.(jpg|png|webp)[^"]*)"/i);
  if (imgMatch) {
    mainImage = imgMatch[1];
  }

  // -- Colors
  var colors: ScrapedColor[] = [];
  var colorItemRegex = /<li class="cosGrid_Inner4">([\s\S]*?)<\/li>/gi;
  var cMatch: RegExpExecArray | null;
  while ((cMatch = colorItemRegex.exec(html)) !== null) {
    var itemHtml = cMatch[1];

    // Image: prefer a[href] (full size), fallback to img[src]
    var imgUrl = '';
    var linkMatch = itemHtml.match(/<a[^>]*href="([^"]*\.(jpg|png|webp)[^"]*)"/i);
    if (linkMatch) {
      imgUrl = linkMatch[1];
    } else {
      var srcMatch = itemHtml.match(/<img[^>]*src="([^"]*\.(jpg|png|webp)[^"]*)"/i);
      if (srcMatch) imgUrl = srcMatch[1];
    }

    // Name: first <strong> that is NOT a JAN code
    var strongs = itemHtml.match(/<strong>([\s\S]*?)<\/strong>/gi);
    var colorName = '';
    if (strongs) {
      for (var si = 0; si < strongs.length; si++) {
        var sText = stripTags(strongs[si]);
        if (sText && !/JAN|^\d{10,}/.test(sText)) {
          colorName = sText;
          break;
        }
      }
    }

    if (!colorName) colorName = 'カラー' + String(colors.length + 1).padStart(2, '0');

    colors.push({ name: colorName, imageUrl: imgUrl });
  }

  console.log('[thirtyfour] Colors: ' + colors.length);
  console.log('[thirtyfour] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: toSlug(url),
    manufacturer: '34',
    manufacturer_slug: 'thirtyfour',
    type: type,
    target_fish: ['アジ', 'メバル'],
    description: '',
    price: price,
    colors: colors,
    weights: weights,
    length: lengthVal,
    mainImage: mainImage,
    sourceUrl: url,
  };
}
