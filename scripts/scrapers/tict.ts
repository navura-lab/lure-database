// scripts/scrapers/tict.ts
// TICT (tict-net.com) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: Static HTML (no CMS), nginx, Shift_JIS encoding
// No WAF, no anti-bot measures.
//
// Product URL pattern: /product/{slug}.html
// Spec: <table> with th/td structure
//   - Pattern A (4 cols): 商品名, カラー, 価格, JANコード
//   - Pattern B (5 cols): 商品名, スペック, カラー, 価格, JANコード
//   - rowspan tds contain product name, spec (size/weight/type), price
// Colors: div.worm_color > ul.color
//   - Name: li.name text
//   - Image: li > a[href] (full size, relative path)
// Main image: img#MainPhoto src (relative path) or first 700px width img
// Price: rowspan td containing ￥ or オープン
//
// IMPORTANT: Response is Shift_JIS encoded. Must decode properly.

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/bros|ブロス/i, 'ミノー'],
  [/flopper|フロッパー/i, 'ミノー'],
  [/plapan|プラパン/i, 'バイブレーション'],
  [/cooljig|クールジグ/i, 'メタルジグ'],
  [/spinbow|スピンボウイ/i, 'スピンテール'],
  [/big[\s-]*hip|ビッグヒップ/i, 'ミノー'],
  [/ブリリアント|brilliant|briliant/i, 'ワーム'],
  [/アジボッコ|ajibokko/i, 'ワーム'],
  [/メデューサ|medusa/i, 'ワーム'],
  [/オクトパス|octpus/i, 'ワーム'],
  [/ボムシャッド|bombshad/i, 'ワーム'],
  [/メタボ|metabo/i, 'ワーム'],
  [/ギョピン|gyopin/i, 'ワーム'],
  [/ピーカーブー|peekaboo/i, 'ワーム'],
  [/フィジット|fisit|fisitnude/i, 'ワーム'],
  [/イカシテル|ikashiteru/i, 'ワーム'],
  [/プランクトン|plankton/i, 'ワーム'],
  [/g-ball|ジーボール/i, 'ワーム'],
  [/gg-claw|クロー/i, 'ワーム'],
  [/paddle.*claw|パドル/i, 'ワーム'],
];

function detectType(name: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  return 'ワーム'; // TICT is primarily a worm maker
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function toSlug(urlStr: string): string {
  var parts = urlStr.replace(/\.html$/, '').split('/');
  var last = parts[parts.length - 1] || '';
  return last
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http')) return relative;
  // base: https://tict-net.com/product/bros55.html
  var baseDir = base.replace(/[^/]*$/, '');
  return baseDir + relative;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeTictPage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[tict] HTTP ' + res.status + ' for ' + url);

  // Decode Shift_JIS
  var buffer = await res.arrayBuffer();
  var decoder = new TextDecoder('shift_jis');
  var html = decoder.decode(buffer);

  // -- Product name
  var nameMatch = html.match(/class="product_mane"[^>]*>([\s\S]*?)<\/div>/);
  var name = nameMatch ? stripTags(nameMatch[1]) : '';
  // Clean up: "FLOPPER Bros 55 - ブロス - " → "FLOPPER Bros 55"
  name = name.replace(/\s*[-–—]\s*[^-–—]*\s*[-–—]\s*$/, '').trim();

  var nameKana = '';
  // Extract kana if present in original: "FLOPPER Bros 55 - ブロス -"
  var kanaMatch = (nameMatch ? stripTags(nameMatch[1]) : '').match(/[-–—]\s*([\u30A0-\u30FF\u3040-\u309F]+[^\s-]*)\s*[-–—]/);
  if (kanaMatch) nameKana = kanaMatch[1].trim();

  console.log('[tict] Product: ' + name);

  // -- Main image
  var mainImage = '';
  var mainImgMatch = html.match(/id="MainPhoto"[^>]*src="([^"]*)"/);
  if (!mainImgMatch) mainImgMatch = html.match(/src="([^"]*)"[^>]*id="MainPhoto"/);
  if (mainImgMatch) {
    mainImage = resolveUrl(url, mainImgMatch[1]);
  } else {
    // Fallback: first 700px width image
    var bigImgMatch = html.match(/src="([^"]*)"[^>]*width="700"/);
    if (bigImgMatch) mainImage = resolveUrl(url, bigImgMatch[1]);
  }

  // -- Spec from table (rowspan cells)
  var price = 0;
  var lengthVal: number | null = null;
  var weights: number[] = [];

  var tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/);
  if (tableMatch) {
    var rowspanCells = tableMatch[1].match(/<td[^>]*rowspan[^>]*>([\s\S]*?)<\/td>/gi);
    if (rowspanCells) {
      for (var ri = 0; ri < rowspanCells.length; ri++) {
        var cellText = stripTags(rowspanCells[ri]);

        // Price
        var priceMatch = cellText.match(/￥\s*([\d,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }

        // Spec (e.g. "60mm 4.6g シンキング")
        var mmMatch = cellText.match(/(\d+(?:\.\d+)?)\s*mm/i);
        if (mmMatch && !lengthVal) {
          lengthVal = Math.round(parseFloat(mmMatch[1]));
        }

        var gMatch = cellText.match(/(\d+(?:\.\d+)?)\s*g(?!\w)/i);
        if (gMatch) {
          var w = parseFloat(gMatch[1]);
          if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
        }
      }
    }

    // Also try to get length from product name (e.g. "1.2インチ")
    if (!lengthVal) {
      var inchMatch = name.match(/([\d.]+)\s*インチ/);
      if (inchMatch) {
        lengthVal = Math.round(parseFloat(inchMatch[1]) * 25.4);
      }
    }

    // Fallback: extract bare number from name (e.g. "Bros 55" → 55mm)
    if (!lengthVal) {
      var bareNumMatch = name.match(/\b(\d{2,3})\b/);
      if (bareNumMatch) {
        var num = parseInt(bareNumMatch[1], 10);
        if (num >= 20 && num <= 300) {
          lengthVal = num;
        }
      }
    }
  }

  // -- Type
  var type = detectType(name);

  // -- Colors
  var colors: ScrapedColor[] = [];
  var colorSection = html.match(/class="worm_color\d*"([\s\S]*?)<\/div>/);
  if (colorSection) {
    var colorImgs = colorSection[1].match(/href="([^"]*)"[^>]*data-lightbox/gi);
    var colorNames = colorSection[1].match(/class="name"[^>]*>([\s\S]*?)<\/li>/gi);

    var imgUrls: string[] = [];
    if (colorImgs) {
      for (var ci = 0; ci < colorImgs.length; ci++) {
        var hrefMatch = colorImgs[ci].match(/href="([^"]*)"/);
        if (hrefMatch) imgUrls.push(resolveUrl(url, hrefMatch[1]));
      }
    }

    var nameTexts: string[] = [];
    if (colorNames) {
      for (var ni = 0; ni < colorNames.length; ni++) {
        // Remove the class="name"> prefix that match() with /g flag includes
        var nameContent = colorNames[ni].replace(/^class="name"[^>]*>/, '');
        nameTexts.push(stripTags(nameContent));
      }
    }

    // Match images to names (they appear in same order)
    var maxLen = Math.max(imgUrls.length, nameTexts.length);
    for (var mi = 0; mi < maxLen; mi++) {
      var cName = mi < nameTexts.length ? nameTexts[mi] : 'カラー' + String(mi + 1).padStart(2, '0');
      var cImg = mi < imgUrls.length ? imgUrls[mi] : '';
      if (cName || cImg) {
        colors.push({ name: cName || 'カラー' + String(mi + 1).padStart(2, '0'), imageUrl: cImg });
      }
    }
  }

  console.log('[tict] Colors: ' + colors.length);
  console.log('[tict] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: toSlug(url),
    manufacturer: 'TICT',
    manufacturer_slug: 'tict',
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
