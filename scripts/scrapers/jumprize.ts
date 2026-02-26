// scripts/scrapers/jumprize.ts
// Jumprize (jumprize.com) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: Jimdo Creator (static HTML), no CMS API, no anti-bot measures.
// sitemap.xml available for URL discovery.
//
// Product URL pattern: /lure/series{N}/{slug}/ or /lure/yukifactory/{slug}/
// Spec: <table> with blue-header rows (<strong> labels in left td, values in right td)
//   - 全長 → length, 総重量/重量 → weight, タイプ → type, 本体価格 → price
// Colors: Jimdo gallery (div.cc-m-gallery-cool-item or cc-m-gallery-stack-item)
//   - Name: a[data-title] or img[alt] (may be empty for metal jigs)
//   - Image: a[data-href] (full size) or img[src]
// Main image: first j-image module's img src (dimension=889x... hero)
// Price: spec table "本体価格" row → X,XXX円（税込X,XXX円） → use 税込 value

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/chata[\s-]*bee|チャタ[\s-]*ビー/i, 'バイブレーション'],
  [/popopen|ポポペン/i, 'ポッパー'],
  [/lalapen|ララペン/i, 'ペンシルベイト'],
  [/lalaswim|ララスイム/i, 'ペンシルベイト'],
  [/lalapop|ララポップ/i, 'ポッパー'],
  [/surface[\s-]*wing|サーフェスウィング/i, 'ミノー'],
  [/rowdy|ロウディー/i, 'ミノー'],
  [/terotero|テロテロ/i, 'ミノー'],
  [/miniterokun|ミニテロ/i, 'ミノー'],
  [/megaterokun|メガテロ/i, 'ミノー'],
  [/buttobi[\s-]*kun|ぶっ飛び君/i, 'シンキングペンシル'],
  [/kattobi[\s-]*bow|かっ飛び棒/i, 'シンキングペンシル'],
  [/tobi[\s-]*king|飛びキング/i, 'メタルジグ'],
  [/petit[\s-]*bomber|プチボンバー/i, 'シンキングペンシル'],
  [/pipi[\s-]*devil|ピピデビル/i, 'シンキングペンシル'],
  [/momopunch|モモパンチ/i, 'メタルジグ'],
  [/buttobispoon|ぶっ飛びスプーン/i, 'スプーン'],
  [/spoon|スプーン/i, 'スプーン'],
  [/jig|ジグ/i, 'メタルジグ'],
  [/minnow|ミノー/i, 'ミノー'],
  [/pencil|ペンシル/i, 'ペンシルベイト'],
  [/vibration|バイブ/i, 'バイブレーション'],
];

function detectType(name: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function toSlug(urlStr: string): string {
  // /lure/series1/rowdy130f/ → rowdy130f
  var parts = urlStr.replace(/\/+$/, '').split('/');
  var last = parts[parts.length - 1] || '';
  return last
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// HTML helpers (no DOM parser needed)
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); }).trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); });
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeJumprizePage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[jumprize] HTTP ' + res.status + ' for ' + url);
  var html = await res.text();

  // -- Product name from <title>
  var titleMatch = html.match(/<title>(.*?)<\/title>/);
  var rawTitle = titleMatch ? decodeEntities(stripTags(titleMatch[1])) : '';
  // Strip " - JUMPRIZE　公式サイト" or " - JUMPRIZE 公式サイト"
  rawTitle = rawTitle.replace(/\s*[-–—]\s*JUMPRIZE.*$/i, '').trim();

  // Split name and kana: "Rowdy130F（ロウディー130F）" → name="Rowdy130F", kana="ロウディー130F"
  var name = rawTitle;
  var nameKana = '';
  var parenMatch = rawTitle.match(/^(.+?)[\s]*[（(](.+?)[)）][\s]*$/);
  if (parenMatch) {
    name = parenMatch[1].trim();
    nameKana = parenMatch[2].trim();
  }

  console.log('[jumprize] Product: ' + name);

  // -- Spec table
  // Find all tables, look for the one containing 【SPEC】 or has 全長/重量 headers
  var specData: Record<string, string> = {};
  var tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  var tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    var tableHtml = tableMatch[1];
    // Check if this is a spec table (contains SPEC or 全長 or 重量)
    if (/SPEC|全[\s　]*長|重[\s　]*量|タイプ|本体価格/i.test(stripTags(tableHtml))) {
      // Extract rows: each row has two tds - label (strong) and value
      var rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      var rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        var cells = rowMatch[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (cells && cells.length >= 2) {
          var label = stripTags(cells[0]).replace(/[\s　]+/g, '');
          var value = stripTags(cells[1]);
          if (label && value && !label.includes('SPEC')) {
            specData[label] = value;
          }
        }
      }
      break; // Use first spec table found
    }
  }

  // -- Length
  var lengthVal: number | null = null;
  var lengthStr = specData['全長'] || specData['全　長'] || '';
  var lengthMatch = lengthStr.match(/([\d.]+)\s*mm/i);
  if (lengthMatch) {
    lengthVal = Math.round(parseFloat(lengthMatch[1]));
  }

  // -- Weight (may be "22g" or "27g（本体重量：25g）" or "30g / 45g")
  var weights: number[] = [];
  var weightStr = specData['重量'] || specData['総重量'] || specData['重　量'] || '';
  // Also check if weight is encoded differently
  Object.keys(specData).forEach(function(k) {
    if (/重量/.test(k) && !weightStr) weightStr = specData[k];
  });
  var weightMatches = weightStr.match(/(\d+(?:\.\d+)?)\s*g/gi);
  if (weightMatches) {
    weightMatches.forEach(function(wm) {
      var n = parseFloat(wm);
      if (n > 0 && weights.indexOf(n) === -1) weights.push(n);
    });
  }

  // -- Price (税込 value preferred)
  var price = 0;
  var priceStr = specData['本体価格'] || '';
  // Also search any spec entry containing 価格
  if (!priceStr) {
    Object.keys(specData).forEach(function(k) {
      if (/価格/.test(k)) priceStr = specData[k];
    });
  }
  // Pattern: X,XXX円（税込X,XXX円）
  var taxIncMatch = priceStr.match(/税込\s*([\d,]+)\s*円/);
  if (taxIncMatch) {
    price = parseInt(taxIncMatch[1].replace(/,/g, ''), 10);
  } else {
    // Fallback: first yen amount
    var yenMatch = priceStr.match(/([\d,]+)\s*円/);
    if (yenMatch) {
      var rawPrice = parseInt(yenMatch[1].replace(/,/g, ''), 10);
      // Assume tax-excluded, multiply by 1.1
      price = Math.round(rawPrice * 1.1);
    }
  }

  // If price not in spec, search page for price pattern near SPEC area
  if (price === 0) {
    var allPrices = html.match(/税込\s*([\d,]+)\s*円/g);
    if (allPrices && allPrices.length > 0) {
      var firstTax = allPrices[0].match(/税込\s*([\d,]+)\s*円/);
      if (firstTax) {
        price = parseInt(firstTax[1].replace(/,/g, ''), 10);
      }
    }
  }

  // -- Type detection
  var type = detectType(name + ' ' + (nameKana || ''));

  // -- Main image (first j-image module with dimension=889x hero)
  var mainImage = '';
  var heroMatch = html.match(/src="(https:\/\/image\.jimcdn\.com\/[^"]*dimension=889x[^"]*)"/);
  if (heroMatch) {
    mainImage = heroMatch[1];
  } else {
    // Fallback: first jimcdn image that's not a logo/icon
    var allImgs = html.match(/src="(https:\/\/image\.jimcdn\.com\/app\/cms\/image\/transf\/[^"]*)"/g);
    if (allImgs && allImgs.length > 0) {
      var m = allImgs[0].match(/src="([^"]*)"/);
      if (m) mainImage = m[1];
    }
  }

  // -- Colors from galleries
  // Jimdo uses cc-m-gallery-cool-item (grid) and cc-m-gallery-stack-item (stack)
  var colors: ScrapedColor[] = [];
  var seenImages: Record<string, boolean> = {};
  var galleryItemRegex = /class="cc-m-gallery-(?:cool|stack)-item"[^>]*>[\s\S]*?<a[^>]*data-href="([^"]*)"[^>]*data-title="([^"]*)"[^>]*>[\s\S]*?<img[^>]*alt="([^"]*)"[\s\S]*?<\/div>\s*<\/div>/gi;
  var gMatch: RegExpExecArray | null;
  while ((gMatch = galleryItemRegex.exec(html)) !== null) {
    var imgUrl = gMatch[1];
    var colorName = decodeEntities(gMatch[2] || gMatch[3] || '').trim();

    // Skip footer/promo images (e.g. "ふるさと納税返礼品")
    if (/ふるさと納税|返礼品|お問い合わせ|公式/.test(colorName)) continue;
    if (!imgUrl) continue;
    if (seenImages[imgUrl]) continue;
    seenImages[imgUrl] = true;

    // If no color name, generate one
    if (!colorName) {
      colorName = 'カラー' + String(colors.length + 1).padStart(2, '0');
    }

    colors.push({ name: colorName, imageUrl: imgUrl });
  }

  // If regex didn't match (different HTML structure), try a simpler approach
  if (colors.length === 0) {
    var itemRegex2 = /data-href="(https:\/\/image\.jimcdn\.com\/[^"]*)"[^>]*data-title="([^"]*)"/gi;
    var gMatch2: RegExpExecArray | null;
    while ((gMatch2 = itemRegex2.exec(html)) !== null) {
      var imgUrl2 = gMatch2[1];
      var colorName2 = decodeEntities(gMatch2[2] || '').trim();

      if (/ふるさと納税|返礼品|お問い合わせ|公式/.test(colorName2)) continue;
      if (!imgUrl2) continue;
      if (seenImages[imgUrl2]) continue;
      seenImages[imgUrl2] = true;

      if (!colorName2) {
        colorName2 = 'カラー' + String(colors.length + 1).padStart(2, '0');
      }

      colors.push({ name: colorName2, imageUrl: imgUrl2 });
    }
  }

  console.log('[jumprize] Colors: ' + colors.length);
  console.log('[jumprize] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: toSlug(url),
    manufacturer: 'Jumprize',
    manufacturer_slug: 'jumprize',
    type: type,
    target_fish: ['シーバス', 'ヒラメ', '青物'],
    description: '',
    price: price,
    colors: colors,
    weights: weights,
    length: lengthVal,
    mainImage: mainImage,
    sourceUrl: url,
  };
}
