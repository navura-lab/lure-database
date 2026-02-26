// scripts/scrapers/baitbreath.ts
// BAIT BREATH (baitbreath.net) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: Static HTML (no CMS), Apache, HTTP-only (no SSL)
// Built with JustSystems Homepage Builder — table-based layouts
// No WAF, no anti-bot, no REST API, no sitemap
//
// Product URL pattern: http://www.baitbreath.net/{slug}.html
// Spec patterns:
//   A) Worms: <tr> row containing SIZE + PRICE header, next <tr> has data
//   B) Hard baits: ■Weight:X / colors:Y / Hook:Z / Price:W inline text
// Colors: alternating <tr> image-row / <tr> name-row (3 or 4 columns)
//   - Names: ＃１０６Ｂ format (full-width chars)
//   - Images: small swatches (130x58 or 190x100)
// NOTE: All content is inside ONE big <table>. No semantic HTML.
// IMPORTANT: Full-width characters throughout (￥７８０ etc.)
//

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/cherry\s*spin/i, 'スピナーベイト'],
  [/wan\s*gan|ワンガン/i, 'ミノー'],
  [/bait\s*vibration|バイブレーション/i, 'バイブレーション'],
  [/wan\s*60|wan.*60/i, 'シンキングペンシル'],
  [/jig/i, 'メタルジグ'],
  [/seabass|sea\s*bass/i, 'ミノー'],
  [/warp|wonder.*baits?|honey.*curly|tap\s*tail|trout/i, 'ワーム'],
];

function detectType(name: string, url: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  if (/cherry/i.test(url)) return 'スピナーベイト';
  return 'ワーム'; // BAIT BREATH is primarily a worm maker
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullwidthToHalf(str: string): string {
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/．/g, '.').replace(/，/g, ',').replace(/￥/g, '¥')
    .replace(/（/g, '(').replace(/）/g, ')').replace(/／/g, '/')
    .replace(/＃/g, '#').replace(/＋/g, '+').replace(/　/g, ' ')
    .replace(/：/g, ':');
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function toSlug(urlStr: string): string {
  var parts = urlStr.replace(/\.html$/i, '').split('/');
  var last = decodeURIComponent(parts[parts.length - 1] || '');
  return last
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http')) return relative;
  if (relative.startsWith('//')) return 'http:' + relative;
  var baseDir = base.replace(/[^/]*$/, '');
  while (relative.startsWith('../')) {
    relative = relative.substring(3);
    baseDir = baseDir.replace(/[^/]*\/$/, '');
  }
  return baseDir + relative;
}

function detectTargetFish(name: string, url: string): string[] {
  var lower = (name + ' ' + url).toLowerCase();
  if (/salt|seabass|wan.?gan|アジ|メバル|チヌ|ロック/i.test(lower)) return ['シーバス'];
  if (/trout|トラウト/i.test(lower)) return ['トラウト'];
  return ['ブラックバス'];
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeBaitBreathPage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[baitbreath] HTTP ' + res.status + ' for ' + url);

  var html = await res.text();

  // -- Product name from <title>
  var name = '';
  var nameKana = '';
  var titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) {
    var rawTitle = stripTags(titleMatch[1]).trim();
    rawTitle = fullwidthToHalf(rawTitle);
    var slashSplit = rawTitle.split(/\s*[/／]\s*/);
    if (slashSplit.length >= 2) {
      name = slashSplit[0].trim();
      nameKana = slashSplit[1].trim();
    } else {
      var kanjiMatch = rawTitle.match(/^(.+?)\s+([\u3000-\u9FFF\u30A0-\u30FF\u3040-\u309F].+)$/);
      if (kanjiMatch) {
        name = kanjiMatch[1].trim();
        nameKana = kanjiMatch[2].trim();
      } else {
        name = rawTitle;
      }
    }
  }

  console.log('[baitbreath] Product: ' + name);

  // -- Main image: find first large product image, skip nav/button images
  var mainImage = '';
  var slugBase = toSlug(url);
  // Strategy 1: Look for image with product slug in filename or folder
  var imgRegex = /<img[^>]*src="([^"]*)"[^>]*>/gi;
  var imgMatch;
  var allProductImages: string[] = [];
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    var src = imgMatch[1];
    // Skip known non-product images
    if (/baitbreathbar|btn\d|bottun|facebook|twitter|instagram|youtube|copylight|copylightbar|fecomark|arrow|pankuzu/i.test(src)) continue;
    var widthMatch = imgMatch[0].match(/width="(\d+)"/);
    var w = widthMatch ? parseInt(widthMatch[1], 10) : 0;
    // Product banner images are 950 or 543+ wide, with slug-related filenames
    if (w >= 400 && src.toLowerCase().indexOf(slugBase.substring(0, 3)) !== -1) {
      if (!mainImage) mainImage = resolveUrl(url, src);
    }
    // Collect all large images as fallback
    if (w >= 400) {
      allProductImages.push(resolveUrl(url, src));
    }
  }
  // Fallback: first large non-nav image
  if (!mainImage && allProductImages.length > 0) {
    mainImage = allProductImages[0];
  }

  // -- Extract ALL <tr> rows from HTML for spec and color parsing
  var allRows: string[] = [];
  var rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    allRows.push(rowMatch[0]);
  }

  // -- Spec extraction: find row with SIZE and PRICE headers
  var price = 0;
  var lengthVal: number | null = null;
  var weights: number[] = [];

  // Strategy A: Find header row with SIZE+PRICE, then parse next rows
  var headerRowIdx = -1;
  var headerCells: string[] = [];
  for (var ri = 0; ri < allRows.length; ri++) {
    var rowText = fullwidthToHalf(stripTags(allRows[ri])).toUpperCase();
    if (rowText.indexOf('SIZE') !== -1 && rowText.indexOf('PRICE') !== -1) {
      headerRowIdx = ri;
      // Extract header cell texts
      var hCells = allRows[ri].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (hCells) {
        for (var hi = 0; hi < hCells.length; hi++) {
          headerCells.push(fullwidthToHalf(stripTags(hCells[hi])).toUpperCase().trim());
        }
      }
      break;
    }
  }

  if (headerRowIdx >= 0 && headerCells.length > 0) {
    // Parse data rows after header
    for (var dri = headerRowIdx + 1; dri < allRows.length; dri++) {
      var dCells = allRows[dri].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (!dCells) continue;
      // Stop if this row looks like a section header or has images (color row)
      var rowCleanText = fullwidthToHalf(stripTags(allRows[dri])).trim();
      if (/COLOR\s*(LINE|CHART)|FECO|＊|撮影環境/i.test(rowCleanText)) break;
      if (/<img/i.test(allRows[dri]) && dCells.length <= 2) break;

      // Check if this row has same column count as header
      if (dCells.length < headerCells.length - 1) continue;

      for (var ci = 0; ci < headerCells.length && ci < dCells.length; ci++) {
        var header = headerCells[ci];
        var data = fullwidthToHalf(stripTags(dCells[ci]));

        if (header.indexOf('PRICE') !== -1 && price === 0) {
          var priceMatch = data.match(/[¥]\s*([\d,]+)/);
          if (priceMatch) {
            price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
          }
        }
        if (header.indexOf('SIZE') !== -1 && !lengthVal) {
          var mmMatch = data.match(/(\d+(?:\.\d+)?)\s*mm/i);
          if (mmMatch) {
            lengthVal = Math.round(parseFloat(mmMatch[1]));
          } else {
            var inchMatch = data.match(/([\d.]+)\s*(?:インチ|inch|ｲﾝﾁ)/i);
            if (inchMatch) {
              lengthVal = Math.round(parseFloat(inchMatch[1]) * 25.4);
            }
          }
        }
      }
    }
  }

  // Strategy B: ■ delimited inline specs (hard baits like Cherry Spin)
  if (price === 0) {
    var halfHtml = fullwidthToHalf(html);
    var specLines = halfHtml.match(/■[^■]{10,200}/g);
    if (specLines) {
      for (var si = 0; si < specLines.length; si++) {
        var line = stripTags(specLines[si]);
        // Weight
        var gMatch = line.match(/(\d+(?:\.\d+)?)\s*g(?:\s|\)|,|$)/i);
        if (gMatch) {
          var wg = parseFloat(gMatch[1]);
          if (wg > 0 && weights.indexOf(wg) === -1) weights.push(wg);
        } else {
          var ozMatch = line.match(/([\d./]+)\s*oz/i);
          if (ozMatch) {
            var ozStr = ozMatch[1];
            var ozVal = 0;
            if (ozStr.indexOf('/') !== -1) {
              var parts = ozStr.split('/');
              ozVal = parseFloat(parts[0]) / parseFloat(parts[1]);
            } else {
              ozVal = parseFloat(ozStr);
            }
            var wOz = Math.round(ozVal * 28.35 * 10) / 10;
            if (wOz > 0 && weights.indexOf(wOz) === -1) weights.push(wOz);
          }
        }
        // Price
        if (price === 0) {
          var prMatch = line.match(/Price\s*[:：]\s*[¥￥]\s*([\d,]+)/i);
          if (prMatch) {
            price = parseInt(prMatch[1].replace(/,/g, ''), 10);
          }
        }
      }
    }
  }

  // -- Type + target fish
  var type = detectType(name, url);
  var targetFish = detectTargetFish(name, url);

  // -- Colors: scan all <tr> rows for alternating image-row / name-row pattern
  var colors: ScrapedColor[] = [];

  for (var cri = 0; cri < allRows.length - 1; cri++) {
    var currentRow = allRows[cri];
    var nextRow = allRows[cri + 1];

    // Check if current row contains small color swatch images
    var rowImgs = currentRow.match(/<img[^>]*src="([^"]*)"[^>]*>/gi);
    if (!rowImgs || rowImgs.length === 0) continue;

    // Filter for color swatch images (small size, not nav/banner)
    var swatchImgs: string[] = [];
    for (var ii = 0; ii < rowImgs.length; ii++) {
      var imgTag = rowImgs[ii];
      var srcMatch = imgTag.match(/src="([^"]*)"/i);
      if (!srcMatch) continue;
      var imgSrc = srcMatch[1];
      // Skip non-color images
      if (/baitbreathbar|btn|bottun|facebook|twitter|instagram|youtube|copylight|copylightbar|fecomark|arrow|pankuzu|_age|photo/i.test(imgSrc)) continue;
      // Check for small swatch dimensions (58-100px height, 130-200px width)
      var hMatch = imgTag.match(/height="(\d+)"/);
      var wMatch = imgTag.match(/width="(\d+)"/);
      var imgH = hMatch ? parseInt(hMatch[1], 10) : 0;
      var imgW = wMatch ? parseInt(wMatch[1], 10) : 0;
      if (imgH >= 40 && imgH <= 150 && imgW >= 100 && imgW <= 250) {
        swatchImgs.push(resolveUrl(url, imgSrc));
      }
    }
    if (swatchImgs.length === 0) continue;

    // Check if next row has ＃ or # prefixed color names
    var nextRowHalf = fullwidthToHalf(stripTags(nextRow));
    if (!/#\d/.test(nextRowHalf)) continue;

    // Extract color names from next row's cells
    var nextCells = nextRow.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    var nameTexts: string[] = [];
    if (nextCells) {
      for (var ni = 0; ni < nextCells.length; ni++) {
        var cellText = fullwidthToHalf(stripTags(nextCells[ni])).trim();
        if (cellText && /#\d/.test(cellText)) {
          // Remove leading # + code, keep descriptive name
          var cleanName = cellText.replace(/^#\s*\d+[A-Za-z]*\s*/, '').trim();
          if (!cleanName) cleanName = cellText;
          nameTexts.push(cleanName);
        }
      }
    }

    // Pair images with names
    var pairLen = Math.min(swatchImgs.length, nameTexts.length);
    for (var pi = 0; pi < pairLen; pi++) {
      colors.push({ name: nameTexts[pi], imageUrl: swatchImgs[pi] });
    }
    // Extra images without names
    for (var ei = pairLen; ei < swatchImgs.length; ei++) {
      colors.push({
        name: 'カラー' + String(colors.length + 1).padStart(2, '0'),
        imageUrl: swatchImgs[ei],
      });
    }

    cri++; // Skip name row
  }

  console.log('[baitbreath] Colors: ' + colors.length);
  console.log('[baitbreath] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: toSlug(url),
    manufacturer: 'BAIT BREATH',
    manufacturer_slug: 'baitbreath',
    type: type,
    target_fish: targetFish,
    description: '',
    price: price,
    colors: colors,
    weights: weights,
    length: lengthVal,
    mainImage: mainImage,
    sourceUrl: url,
  };
}
