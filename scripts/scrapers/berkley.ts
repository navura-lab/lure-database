// scripts/scrapers/berkley.ts
// Berkley (purefishing.jp) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: Movable Type CMS (purefishing.jp)
// No REST API. Static HTML pages.
//
// Product URL patterns:
//   /product/berkley/{series}/{product-name}.html
//   /product/berkley/{product-name}.html
//
// Colors: spec table rows (th: カラー column) + swatch images
// Specs: spec table rows (weight/length for hard baits)
// Price: spec table last column (¥{amount} or &yen;{amount})
//
// Two spec table layouts:
//   Soft bait: 製品コード, JAN/UPC, 製品名, カラー, 入り数, 価格
//   Hard bait: 製品コード, JAN/UPC, 製品名, カラー, 自重, 全長, 価格

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Half-width → Full-width katakana conversion
// ---------------------------------------------------------------------------

var HW_TO_FW: Record<string, string> = {
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
  'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
  'ﾞ': '゛', 'ﾟ': '゜', 'ｰ': 'ー',
};

// Dakuten/Handakuten combinations
var DAKUTEN_MAP: Record<string, string> = {
  'カ゛': 'ガ', 'キ゛': 'ギ', 'ク゛': 'グ', 'ケ゛': 'ゲ', 'コ゛': 'ゴ',
  'サ゛': 'ザ', 'シ゛': 'ジ', 'ス゛': 'ズ', 'セ゛': 'ゼ', 'ソ゛': 'ゾ',
  'タ゛': 'ダ', 'チ゛': 'ヂ', 'ツ゛': 'ヅ', 'テ゛': 'デ', 'ト゛': 'ド',
  'ハ゛': 'バ', 'ヒ゛': 'ビ', 'フ゛': 'ブ', 'ヘ゛': 'ベ', 'ホ゛': 'ボ',
  'ハ゜': 'パ', 'ヒ゜': 'ピ', 'フ゜': 'プ', 'ヘ゜': 'ペ', 'ホ゜': 'ポ',
  'ウ゛': 'ヴ',
};

function halfToFullKatakana(str: string): string {
  // Step 1: Replace individual half-width chars
  var result = '';
  for (var i = 0; i < str.length; i++) {
    var ch = HW_TO_FW[str[i]];
    result += ch !== undefined ? ch : str[i];
  }
  // Step 2: Combine dakuten/handakuten
  for (var combo in DAKUTEN_MAP) {
    while (result.indexOf(combo) >= 0) {
      result = result.replace(combo, DAKUTEN_MAP[combo]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/worm|ワーム|crawler|クローラー/i, 'ワーム'],
  [/craw|クロー|creature|クリーチャー|bug|バグ/i, 'ワーム'],
  [/shad|シャッド|minnow|ミノー|swimbait|スイムベイト/i, 'ワーム'],
  [/hawg|ホッグ|grub|グラブ|tube|チューブ/i, 'ワーム'],
  [/flutter|フラッター|shaker|シェイカー|finesse/i, 'ワーム'],
  [/sardine|サーディン|mullet|マレット|sandworm|サンドワーム/i, 'ワーム'],
  [/crank|クランク|dime|ダイム/i, 'クランクベイト'],
  [/spy|スパイ|frittside/i, 'クランクベイト'],
  [/choppo|チョッポ|popper|ポッパー/i, 'ペンシルベイト'],
  [/finisher|フィニッシャー|badger|バジャー/i, 'ルアー'],
  [/jig.*head|ジグヘッド/i, 'ジグヘッド'],
  [/spintail|スピンテール/i, 'スピンテールジグ'],
];

var URL_TYPE_MAP: [RegExp, string][] = [
  [/pb-fw|pb-maxscent|powerbait/i, 'ワーム'],
  [/pb-sw|gulp/i, 'ワーム'],
  [/hard-bait|hardbait/i, 'ルアー'],
  [/dex/i, 'ルアー'],
  [/jig-head/i, 'ジグヘッド'],
];

function detectType(name: string, url: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  for (var i = 0; i < URL_TYPE_MAP.length; i++) {
    if (URL_TYPE_MAP[i][0].test(url)) return URL_TYPE_MAP[i][1];
  }
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(url: string, name: string): string[] {
  // Saltwater indicators
  if (/pb-sw|gulp.*salt|saltwater|sand.*worm|sardine|mullet/i.test(url + ' ' + name)) {
    return ['シーバス', 'ヒラメ', 'マゴチ'];
  }
  // Freshwater bass by default
  return ['ブラックバス'];
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&yen;/g, '¥')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&yen;/g, '¥')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function(_m, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, function(_m, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    });
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log('[' + new Date().toISOString() + '] [berkley] ' + msg);
}

// ---------------------------------------------------------------------------
// Parse spec table
// ---------------------------------------------------------------------------

interface SpecRow {
  productCode: string;
  productName: string;
  colorName: string;
  weight: string;
  length: string;
  price: string;
  count: string;
}

function parseSpecTable(html: string): { headers: string[]; rows: SpecRow[] } {
  // Find spec table (could be in productSpecArea or free-area)
  var tableMatch = html.match(/specTableWrap[^>]*>[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    return { headers: [], rows: [] };
  }

  var tableHtml = tableMatch[1];

  // Parse headers
  var headerRow = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
  if (!headerRow) return { headers: [], rows: [] };

  var thMatches = headerRow[1].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
  var headers: string[] = [];
  for (var i = 0; i < thMatches.length; i++) {
    headers.push(stripHtml(thMatches[i]));
  }

  // Find column indices
  var colorIdx = -1;
  var weightIdx = -1;
  var lengthIdx = -1;
  var priceIdx = -1;
  var nameIdx = -1;
  var countIdx = -1;
  var codeIdx = -1;

  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (/カラー/.test(h)) colorIdx = i;
    else if (/自重/.test(h)) weightIdx = i;
    else if (/全長/.test(h)) lengthIdx = i;
    else if (/価格|本体価格/.test(h)) priceIdx = i;
    else if (/製品名/.test(h)) nameIdx = i;
    else if (/入り数/.test(h)) countIdx = i;
    else if (/製品コード/.test(h)) codeIdx = i;
  }
  // Price is often the last column
  if (priceIdx < 0) priceIdx = headers.length - 1;

  // Parse data rows
  var rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  var rows: SpecRow[] = [];

  for (var ri = 1; ri < rowMatches.length; ri++) {
    var tdMatches = rowMatches[ri].match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    var cells: string[] = [];
    for (var ci = 0; ci < tdMatches.length; ci++) {
      cells.push(stripHtml(tdMatches[ci]));
    }

    if (cells.length < 3) continue;

    rows.push({
      productCode: codeIdx >= 0 && codeIdx < cells.length ? cells[codeIdx] : '',
      productName: nameIdx >= 0 && nameIdx < cells.length ? cells[nameIdx] : '',
      colorName: colorIdx >= 0 && colorIdx < cells.length ? cells[colorIdx] : '',
      weight: weightIdx >= 0 && weightIdx < cells.length ? cells[weightIdx] : '',
      length: lengthIdx >= 0 && lengthIdx < cells.length ? cells[lengthIdx] : '',
      price: priceIdx >= 0 && priceIdx < cells.length ? cells[priceIdx] : '',
      count: countIdx >= 0 && countIdx < cells.length ? cells[countIdx] : '',
    });
  }

  return { headers: headers, rows: rows };
}

// ---------------------------------------------------------------------------
// Parse weight: "2/5 OZ (10g)" → 10, "10g" → 10
// ---------------------------------------------------------------------------

function parseWeight(str: string): number | null {
  if (!str) return null;
  // Match "(Xg)" pattern
  var gMatch = str.match(/\((\d+(?:\.\d+)?)g\)/);
  if (gMatch) return parseFloat(gMatch[1]);
  // Match standalone "Xg"
  var gMatch2 = str.match(/(\d+(?:\.\d+)?)g/);
  if (gMatch2) return parseFloat(gMatch2[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Parse length: "2 IN (50mm)" → 50, "50mm" → 50
// ---------------------------------------------------------------------------

function parseLength(str: string): number | null {
  if (!str) return null;
  // Match "(Xmm)" pattern
  var mmMatch = str.match(/\((\d+(?:\.\d+)?)mm\)/);
  if (mmMatch) return Math.round(parseFloat(mmMatch[1]));
  // Match standalone "Xmm"
  var mmMatch2 = str.match(/(\d+(?:\.\d+)?)mm/);
  if (mmMatch2) return Math.round(parseFloat(mmMatch2[1]));
  // Match "X IN" pattern → convert to mm
  var inMatch = str.match(/([\d.]+)\s*IN/i);
  if (inMatch) return Math.round(parseFloat(inMatch[1]) * 25.4);
  return null;
}

// ---------------------------------------------------------------------------
// Parse length from product name: "4inch" → 102mm
// ---------------------------------------------------------------------------

function parseLengthFromName(name: string): number | null {
  var m = name.match(/([\d.]+)\s*(?:inch|インチ|in(?:ch)?)/i);
  if (m) return Math.round(parseFloat(m[1]) * 25.4);
  return null;
}

// ---------------------------------------------------------------------------
// Parse price: "¥980" → 980, "&yen;1,500" → 1500
// ---------------------------------------------------------------------------

function parsePrice(str: string): number {
  if (!str) return 0;
  var cleaned = str.replace(/[¥&yen;,\s]/g, '');
  var num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// Color name normalization for matching
// ---------------------------------------------------------------------------

function normalizeColorName(name: string): string {
  // Convert half-width katakana to full-width
  var fw = halfToFullKatakana(name);
  // Remove parenthetical English codes like "BBB(" prefix or "(ベイビーバス)"
  // Trim whitespace
  return fw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeBerkleyPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  // ---------- Fetch HTML ----------
  var maxRetries = 3;
  var response: Response | null = null;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
      });
      if (response.ok) break;
      log('HTTP ' + response.status + ', retrying...');
    } catch (fetchErr: any) {
      if (attempt === maxRetries) throw fetchErr;
      log('Fetch failed: ' + fetchErr.message + ', retrying in 2s...');
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
    }
  }

  if (!response || !response.ok) {
    throw new Error('Failed to fetch: ' + url);
  }

  var html = await response.text();

  // Check if we got redirected to homepage (discontinued product)
  if (!html.match(/contentTitle/) && !html.match(/productSlider/) && !html.match(/specTableWrap/)) {
    throw new Error('Product page not found (possible redirect): ' + url);
  }

  // ---------- Title ----------
  var titleMatch = html.match(/<h1[^>]*class="contentTitle"[^>]*>([\s\S]*?)<\/h1>/);
  var rawName = titleMatch ? stripHtml(decodeHtmlEntities(titleMatch[1])) : '';
  if (!rawName) {
    throw new Error('Could not extract title from: ' + url);
  }
  log('Product: ' + rawName);

  // ---------- Slug ----------
  var urlPath = url.replace(/\/$/, '').replace(/\.html$/, '');
  var slug = urlPath.split('/').pop() || '';
  if (!slug) {
    throw new Error('Could not extract slug from: ' + url);
  }

  // ---------- Kana name ----------
  // Extract Japanese name from parentheses: "English (カタカナ)"
  var kanaMatch = rawName.match(/[（(]([^）)]*[ァ-ヶー]+[^）)]*)[）)]/);
  var nameKana = kanaMatch ? kanaMatch[1].trim() : '';

  // ---------- Description ----------
  var descMatch = html.match(/productTextArea[\s\S]*?<p[^>]*class="contentText"[^>]*>([\s\S]*?)<\/p>/);
  var description = descMatch ? stripHtml(decodeHtmlEntities(descMatch[1])).substring(0, 500) : '';

  // ---------- Main image ----------
  var mainImgMatch = html.match(/productSlider[\s\S]*?<img[^>]*src="([^"]*)"/);
  var mainImage = mainImgMatch ? mainImgMatch[1] : '';
  if (mainImage && !mainImage.startsWith('http')) {
    mainImage = 'https://www.purefishing.jp' + mainImage;
  }

  // ---------- Color swatch images ----------
  var swatchMap: Record<string, string> = {};
  var colorSectionMatch = html.match(/productColorValidationArea([\s\S]*?)(?:<\/section>|<section)/);
  if (colorSectionMatch) {
    var thumbMatches = colorSectionMatch[1].match(/<li[^>]*class="[^"]*thumbListItem[^"]*"[\s\S]*?<\/li>/g) || [];
    for (var ti = 0; ti < thumbMatches.length; ti++) {
      var imgMatch = thumbMatches[ti].match(/<img[^>]*class="thumbImg"[^>]*src="([^"]*)"[^>]*alt="([^"]*)"/);
      if (!imgMatch) continue;

      var imgSrc = imgMatch[1];
      var imgAlt = decodeHtmlEntities(imgMatch[2]).trim();

      // Skip "カラー一覧" (color chart overview images)
      if (/カラー一覧|color.*chart/i.test(imgAlt)) continue;

      // Extract color code from alt: "BBB(ベイビーバス)" → "BBB"
      var codeMatch = imgAlt.match(/^([A-Z0-9]+)\s*[（(]/);
      var code = codeMatch ? codeMatch[1] : '';

      // Extract Japanese name from parentheses
      var jpNameMatch = imgAlt.match(/[（(]([^）)]+)[）)]/);
      var jpName = jpNameMatch ? jpNameMatch[1].trim() : imgAlt;

      if (imgSrc && !imgSrc.startsWith('http')) {
        imgSrc = 'https://www.purefishing.jp' + imgSrc;
      }

      // Store by code and by normalized Japanese name
      if (code) swatchMap[code.toUpperCase()] = imgSrc;
      swatchMap[normalizeColorName(jpName)] = imgSrc;
    }
  }
  log('Swatch images found: ' + Object.keys(swatchMap).length);

  // ---------- Spec table ----------
  var spec = parseSpecTable(html);
  log('Spec table: ' + spec.headers.length + ' headers, ' + spec.rows.length + ' rows');

  // ---------- Extract unique colors ----------
  var colorMap: Record<string, ScrapedColor> = {};
  var weights: number[] = [];
  var lengths: number[] = [];
  var price = 0;

  for (var ri = 0; ri < spec.rows.length; ri++) {
    var row = spec.rows[ri];

    // Color
    if (row.colorName) {
      var fullWidthName = halfToFullKatakana(row.colorName);
      var normalizedKey = normalizeColorName(row.colorName);

      // Extract code from product name: "PBMSFM4-BBB" → "BBB"
      var codeFromName = row.productName.match(/-([A-Z0-9]+)(?:\s|$)/);
      var rowCode = codeFromName ? codeFromName[1].toUpperCase() : '';

      // Try to find matching swatch image
      var imageUrl = '';
      if (rowCode && swatchMap[rowCode]) {
        imageUrl = swatchMap[rowCode];
      }
      if (!imageUrl && swatchMap[normalizedKey]) {
        imageUrl = swatchMap[normalizedKey];
      }

      if (!colorMap[fullWidthName]) {
        colorMap[fullWidthName] = {
          name: fullWidthName,
          imageUrl: imageUrl,
        };
      }
    }

    // Weight
    if (row.weight) {
      var w = parseWeight(row.weight);
      if (w !== null && weights.indexOf(w) < 0) {
        weights.push(w);
      }
    }

    // Length
    if (row.length) {
      var l = parseLength(row.length);
      if (l !== null && lengths.indexOf(l) < 0) {
        lengths.push(l);
      }
    }

    // Price (take first non-zero price)
    if (!price && row.price) {
      price = parsePrice(row.price);
    }
  }

  var colors: ScrapedColor[] = [];
  for (var key in colorMap) {
    colors.push(colorMap[key]);
  }

  // ---------- Length fallback: from product name ----------
  var lengthMm: number | null = lengths.length > 0 ? lengths[0] : parseLengthFromName(rawName);

  // ---------- Sort weights ----------
  weights.sort(function(a, b) { return a - b; });

  // ---------- Type ----------
  var lureType = detectType(rawName, url);

  // ---------- Target fish ----------
  var targetFish = detectTargetFish(url, rawName);

  // ---------- Result ----------
  var result: ScrapedLure = {
    name: rawName,
    name_kana: nameKana,
    slug: slug,
    manufacturer: 'Berkley',
    manufacturer_slug: 'berkley',
    type: lureType,
    target_fish: targetFish,
    description: description,
    price: price,
    colors: colors,
    weights: weights,
    length: lengthMm,
    mainImage: mainImage,
    sourceUrl: url,
  };

  log('Done: ' + result.name + ' | type=' + result.type + ' | colors=' + result.colors.length +
      ' | weights=' + result.weights.length + ' | length=' + result.length + 'mm | price=¥' + result.price);

  return result;
}
