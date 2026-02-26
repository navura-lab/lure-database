// scripts/scrapers/noike.ts
// NOIKE (noike-m.com) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: WordPress 6.9 (Lightning theme), nginx, no WAF
// REST API: /wp-json/wp/v2/pages — fully open, no auth needed
//
// Product URL pattern: https://noike-m.com/{slug}/
// Spec: figure.wp-block-table > table.has-fixed-layout
//   - Row 1 = header (LENGTH / 入り数 / PRICE or WEIGHT / PRICE)
//   - Row 2+ = data values
//   - IMPORTANT: All numbers are FULL-WIDTH (e.g. ７７０ instead of 770)
// Colors: figure.wp-block-gallery > figure.wp-block-image
//   - Image: a[href] (full-size 800x800 JPG)
//   - Name: figcaption text (e.g. "#01 グリーンパンプキン")
// Main image: 2nd .wp-block-image in .entry-body
// Price: table PRICE cell, "税込￥７７０" format → extract tax-inclusive price
//

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/kaishin|カイシン/i, 'ブレードベイト'],
  [/tiny\s*kaishin/i, 'ブレードベイト'],
];

function detectType(name: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  return 'ワーム'; // NOIKE is primarily a soft bait maker
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullwidthToHalf(str: string): string {
  // Fullwidth digits, letters (A-Z, a-z), and some punctuation → half-width
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/．/g, '.').replace(/，/g, ',').replace(/￥/g, '¥')
    .replace(/（/g, '(').replace(/）/g, ')').replace(/／/g, '/');
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
  var parts = urlStr.replace(/\/$/, '').split('/');
  var last = parts[parts.length - 1] || '';
  return last
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeNoikePage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[noike] HTTP ' + res.status + ' for ' + url);

  var html = await res.text();

  // -- Product name from <h1>
  var nameMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
  var name = nameMatch ? stripTags(nameMatch[1]) : '';
  // Fallback: <title> tag
  if (!name) {
    var titleMatch = html.match(/<title>([^<]*)<\/title>/);
    if (titleMatch) {
      name = titleMatch[1].replace(/\s*[-–—]\s*NOIKE.*$/, '').trim();
    }
  }

  // Decode remaining HTML entities in name
  name = name.replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, '&');

  var nameKana = '';

  console.log('[noike] Product: ' + name);

  // -- Main image (2nd .wp-block-image)
  var mainImage = '';
  var imgBlocks = html.match(/<div[^>]*class="[^"]*wp-block-image[^"]*"[^>]*>[\s\S]*?<\/div>/gi);
  if (imgBlocks && imgBlocks.length >= 2) {
    var srcMatch = imgBlocks[1].match(/src="([^"]*)"/);
    if (srcMatch) {
      mainImage = srcMatch[1];
      // Try to get largest from srcset
      var srcsetMatch = imgBlocks[1].match(/srcset="([^"]*)"/);
      if (srcsetMatch) {
        var srcsetParts = srcsetMatch[1].split(',');
        var maxW = 0;
        for (var si = 0; si < srcsetParts.length; si++) {
          var swMatch = srcsetParts[si].trim().match(/^(\S+)\s+(\d+)w$/);
          if (swMatch) {
            var w = parseInt(swMatch[2], 10);
            if (w > maxW) {
              maxW = w;
              mainImage = swMatch[1];
            }
          }
        }
      }
    }
  }

  // -- Spec from table
  var price = 0;
  var lengthVal: number | null = null;
  var weights: number[] = [];

  var tableMatch = html.match(/class="[^"]*wp-block-table[^"]*"[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (tableMatch) {
    var rows = tableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (rows && rows.length >= 2) {
      // Header row (row 0)
      var headerCells: string[] = [];
      var hMatches = rows[0].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (hMatches) {
        for (var hi = 0; hi < hMatches.length; hi++) {
          headerCells.push(fullwidthToHalf(stripTags(hMatches[hi])).toUpperCase());
        }
      }

      // Data row (row 1)
      var dataCells: string[] = [];
      var dMatches = rows[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (dMatches) {
        for (var di = 0; di < dMatches.length; di++) {
          dataCells.push(fullwidthToHalf(stripTags(dMatches[di])));
        }
      }

      for (var ci = 0; ci < headerCells.length; ci++) {
        if (ci >= dataCells.length) break;
        var header = headerCells[ci];
        var data = dataCells[ci];

        // Price: "¥700(税込¥770)" → extract tax-inclusive 770
        if (header.indexOf('PRICE') !== -1) {
          var taxMatch = data.match(/税込[¥￥]\s*([\d,]+)/);
          if (taxMatch) {
            price = parseInt(taxMatch[1].replace(/,/g, ''), 10);
          } else {
            var priceMatch = data.match(/[¥￥]\s*([\d,]+)/);
            if (priceMatch) {
              price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            }
          }
        }

        // Length: "2.5inch(66mm)" or "66mm"
        if (header.indexOf('LENGTH') !== -1) {
          var mmMatch = data.match(/(\d+(?:\.\d+)?)\s*mm/i);
          if (mmMatch) {
            lengthVal = Math.round(parseFloat(mmMatch[1]));
          } else {
            var inchMatch = data.match(/([\d.]+)\s*inch/i);
            if (inchMatch) {
              lengthVal = Math.round(parseFloat(inchMatch[1]) * 25.4);
            }
          }
        }

        // Weight: "3/8oz(10.5g)" or "10.5g"
        if (header.indexOf('WEIGHT') !== -1) {
          var gMatch = data.match(/(\d+(?:\.\d+)?)\s*g(?!\w)/i);
          if (gMatch) {
            var w = parseFloat(gMatch[1]);
            if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
          } else {
            var ozMatch = data.match(/([\d.]+)\s*oz/i);
            if (ozMatch) {
              var wOz = Math.round(parseFloat(ozMatch[1]) * 28.35 * 10) / 10;
              if (wOz > 0 && weights.indexOf(wOz) === -1) weights.push(wOz);
            }
          }
        }
      }
    }
  }

  // -- Type
  var type = detectType(name);

  // -- Colors
  // Gallery is nested: <figure class="wp-block-gallery ..."> contains many <figure class="wp-block-image ...">
  // Each inner figure has: <a href="full-image-url">, <figcaption>color name</figcaption>
  var colors: ScrapedColor[] = [];

  // Find gallery start
  var galleryStart = html.indexOf('wp-block-gallery has-nested-images');
  if (galleryStart !== -1) {
    // Extract from gallery start to a reasonable distance (galleries < 50KB)
    var gallerySection = html.substring(galleryStart, galleryStart + 50000);

    // Find all inner figure.wp-block-image blocks
    var figRegex = /<figure[^>]*wp-block-image[^>]*>([\s\S]*?)<\/figure>/gi;
    var figMatch;
    while ((figMatch = figRegex.exec(gallerySection)) !== null) {
      var figHtml = figMatch[1];

      // Extract image URL from a[href]
      var imgHrefMatch = figHtml.match(/<a[^>]*href="([^"]*)"[^>]*>/);
      var cImg = imgHrefMatch ? imgHrefMatch[1] : '';

      // Extract color name from figcaption
      var captionMatch = figHtml.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/);
      var cName = '';
      if (captionMatch) {
        cName = stripTags(captionMatch[1]).replace(/^#?\d+[\s\t]*/, '').trim();
      }
      if (!cName) cName = 'カラー' + String(colors.length + 1).padStart(2, '0');

      // Only include colors that have an image URL (skip decorative figures)
      if (cImg) {
        colors.push({ name: cName, imageUrl: cImg });
      }
    }
  }

  console.log('[noike] Colors: ' + colors.length);
  console.log('[noike] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: toSlug(url),
    manufacturer: 'NOIKE',
    manufacturer_slug: 'noike',
    type: type,
    target_fish: ['ブラックバス'],
    description: '',
    price: price,
    colors: colors,
    weights: weights,
    length: lengthVal,
    mainImage: mainImage,
    sourceUrl: url,
  };
}
