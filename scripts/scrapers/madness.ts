// scripts/scrapers/madness.ts
// MADNESS JAPAN (madness.co.jp) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: WordPress 6.8.3, Twenty Fourteen theme
// WP install path: /c/ (wp-content under /c/wp-content/)
// No WAF, no anti-bot. REST API exists but content.rendered is empty.
//
// Product URL pattern: /products/{category}/{slug}
// Product name: .entry-header h1 img[alt]
// Main image: .entry-header h1 img[src]
// Spec: .spec div p span > strong (SIZE/WEIGHT/HOOKS/PRICE/LOT)
//   - Price format: "¥1,881（税込）" (tax-inclusive)
//   - Multiple spec sections possible (NORMAL, silver, night, other)
// Colors: ul.chart li
//   - Name: li .modal .name or li .color_name
//   - Image: li a > img src (thumbnail 190px) or li .modal img src (400px)
// Description: .entry-header .lead
//

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/vibe|バイブ/i, 'バイブレーション'],
  [/balam|バラム/i, 'ビッグベイト'],
  [/sinpen|シンペン/i, 'シンキングペンシル'],
  [/baguette|バゲット/i, 'シンキングペンシル'],
  [/spin|スピン/i, 'スピンテール'],
  [/blade|ブレード/i, 'ブレードベイト'],
  [/silicon.*tail/i, 'ワーム'],
  [/separ|セパル/i, 'ワーム'],
  [/bakuree\s*fish|バクリーフィッシュ/i, 'ワーム'],
  [/jig|ジグ/i, 'メタルジグ'],
  [/shiriten\s*\d/i, 'ミノー'], // shiriten 50/70/100 = minnows
  [/ebeech/i, 'ミノー'],
];

function detectType(name: string, category: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  if (/worm/i.test(category)) return 'ワーム';
  if (/trout/i.test(category)) return 'バイブレーション';
  return 'ルアー';
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
    .replace(/&quot;/g, '"')
    .replace(/&yen;/g, '¥')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function toSlug(urlStr: string): string {
  // URL: /products/salt/shiriten-vibe73
  var parts = urlStr.replace(/\/$/, '').split('/');
  var last = parts[parts.length - 1] || '';
  return last
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractCategory(urlStr: string): string {
  // URL: /products/salt/shiriten-vibe73 → "salt"
  var match = urlStr.match(/\/products\/([^/]+)\//);
  if (match) return match[1];
  return '';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeMadnessPage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[madness] HTTP ' + res.status + ' for ' + url);

  var html = await res.text();

  // -- Product name from h1 > img[alt]
  var name = '';
  var mainImage = '';

  var h1ImgMatch = html.match(/<h1[^>]*>\s*<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*/i);
  if (h1ImgMatch) {
    name = h1ImgMatch[1].trim();
    mainImage = h1ImgMatch[2].trim();
  }
  // Fallback: try src then alt in different order
  if (!name) {
    var h1ImgMatch2 = html.match(/<h1[^>]*>\s*<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*/i);
    if (h1ImgMatch2) {
      mainImage = h1ImgMatch2[1].trim();
      name = h1ImgMatch2[2].trim();
    }
  }
  // Fallback: <title>
  if (!name) {
    var titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) {
      name = titleMatch[1].split(/\s*[|｜]\s*/)[0].trim();
    }
  }

  var nameKana = '';
  var category = extractCategory(url);

  console.log('[madness] Product: ' + name + ' (category: ' + category + ')');

  // -- Description from .lead
  var description = '';
  var leadMatch = html.match(/class="lead"[^>]*>([\s\S]*?)<\/div>/i);
  if (leadMatch) {
    description = stripTags(leadMatch[1]).substring(0, 200);
  }

  // -- Spec from .spec div p span strong
  var price = 0;
  var lengthVal: number | null = null;
  var weights: number[] = [];

  // Find ALL .spec sections (including inside .special sections)
  var specRegex = /class="spec"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  var specMatch;
  while ((specMatch = specRegex.exec(html)) !== null) {
    var specHtml = specMatch[1];
    // Find all <span> with <strong> inside <p> tags
    var spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/gi;
    var spanMatch;
    while ((spanMatch = spanRegex.exec(specHtml)) !== null) {
      var spanContent = spanMatch[1];
      var strongMatch = spanContent.match(/<strong[^>]*>([\s\S]*?)<\/strong>\s*([\s\S]*)/i);
      if (!strongMatch) continue;

      var key = stripTags(strongMatch[1]).toUpperCase().trim();
      var value = stripTags(strongMatch[2]).trim();

      if (key === 'SIZE' && !lengthVal) {
        // "73mm" or "73㎜" or "5inch"
        var mmMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:mm|㎜)/i);
        if (mmMatch) {
          lengthVal = Math.round(parseFloat(mmMatch[1]));
        } else {
          var inchMatch = value.match(/([\d.]+)\s*inch/i);
          if (inchMatch) {
            lengthVal = Math.round(parseFloat(inchMatch[1]) * 25.4);
          }
        }
      }

      if (key === 'WEIGHT') {
        var gMatch = value.match(/(\d+(?:\.\d+)?)\s*g(?:\s|$)/i);
        if (gMatch) {
          var w = parseFloat(gMatch[1]);
          if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
        }
      }

      if (key === 'PRICE' && price === 0) {
        // "¥1,881（税込）"
        var priceMatch = value.match(/[¥￥]\s*([\d,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }
    }
  }

  // -- Type detection
  var type = detectType(name, category);

  // -- Target fish
  var targetFish: string[] = [];
  if (category === 'trout') {
    targetFish = ['トラウト'];
  } else if (category === 'bass') {
    targetFish = ['ブラックバス'];
  } else if (category === 'worm') {
    targetFish = ['ブラックバス'];
  } else {
    targetFish = ['シーバス'];
  }

  // -- Colors from ul.chart li
  var colors: ScrapedColor[] = [];

  var chartRegex = /<ul[^>]*class="[^"]*\bchart\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
  var chartMatch;
  while ((chartMatch = chartRegex.exec(html)) !== null) {
    var chartHtml = chartMatch[1];

    // Find each <li> in this chart
    var liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    var liMatch;
    while ((liMatch = liRegex.exec(chartHtml)) !== null) {
      var liHtml = liMatch[1];

      // Color name: prefer .modal .name (cleanest), fallback to .color_name
      var cName = '';
      var modalNameMatch = liHtml.match(/class="name"[^>]*>([\s\S]*?)<\/p>/i);
      if (modalNameMatch) {
        cName = stripTags(modalNameMatch[1]).trim();
        // Remove leading # + number prefix: "#01 レッドヘッド" → "レッドヘッド"
        cName = cName.replace(/^#\d+\s*/, '').trim();
      }
      if (!cName) {
        var colorNameMatch = liHtml.match(/class="color_name"[^>]*>([\s\S]*?)<\/span>/i);
        if (colorNameMatch) {
          cName = stripTags(colorNameMatch[1]).trim();
          cName = cName.replace(/^#\d+\s*/, '').trim();
        }
      }

      // Color image: first <a> > img src (thumbnail)
      var cImg = '';
      var imgMatch = liHtml.match(/<a[^>]*class="[^"]*open-window[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*/i);
      if (imgMatch) {
        cImg = imgMatch[1];
      }
      // Try modal img for higher res
      var modalImgMatch = liHtml.match(/class="[^"]*modal[^"]*"[\s\S]*?<img[^>]*src="([^"]*)"[^>]*/i);
      if (modalImgMatch) {
        cImg = modalImgMatch[1];
      }

      if (cName || cImg) {
        colors.push({
          name: cName || 'カラー' + String(colors.length + 1).padStart(2, '0'),
          imageUrl: cImg,
        });
      }
    }
  }

  console.log('[madness] Colors: ' + colors.length);
  console.log('[madness] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: toSlug(url),
    manufacturer: 'MADNESS',
    manufacturer_slug: 'madness',
    type: type,
    target_fish: targetFish,
    description: description,
    price: price,
    colors: colors,
    weights: weights,
    length: lengthVal,
    mainImage: mainImage,
    sourceUrl: url,
  };
}
