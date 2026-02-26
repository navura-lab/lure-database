// scripts/scrapers/palms.ts
// Palms (palmsjapan.com) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: Static HTML (no CMS), nginx, Bootstrap + jQuery
// No WAF, no anti-bot, no REST API
//
// Product URL pattern: https://www.palmsjapan.com/lures/product/?name={slug}
// Product name: h1.pagettl (English), .logo h2 (Japanese)
// Spec: table.spec — th=model, variable td columns, td.price for price
//   - Price format: "本体価格 ¥850" (pre-tax)
//   - Column count varies by product (4-6 cols)
// Colors: div.color .inner > a.lightboximg[title] > img[src]
//   - Color name from a[title] attribute
//   - Image paths are relative: {slug}/color/{code}.jpg
// Main image: .visual img (relative path: {slug}/img/product.jpg)
// No worms — all hard baits (jigs, minnows, spoons, spinners, etc.)
//

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/blatt|jig|ジグ|smelt|dax|hexer/i, 'メタルジグ'],
  [/minnow|ミノー|alexandra|trout/i, 'ミノー'],
  [/spoon|スプーン|degangan/i, 'スプーン'],
  [/spin|スピン|spinner/i, 'スピナー'],
  [/vibration|バイブ|vib/i, 'バイブレーション'],
  [/pencil|ペンシル/i, 'ペンシルベイト'],
  [/popper|ポッパー/i, 'ポッパー'],
  [/crank|クランク/i, 'クランクベイト'],
  [/plug|プラグ/i, 'プラグ'],
  [/powale|shore.*slim/i, 'ミノー'],
  [/elassoma|flutterin/i, 'スプーン'],
];

function detectType(name: string, subCategory: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  // Use sub-category text from listing page if embedded in name
  var combined = name + ' ' + subCategory;
  if (/ジグ|jig/i.test(combined)) return 'メタルジグ';
  if (/ミノー|minnow/i.test(combined)) return 'ミノー';
  if (/スプーン|spoon/i.test(combined)) return 'スプーン';
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
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, function(_m: string, code: string) { return String.fromCharCode(parseInt(code, 10)); })
    .replace(/\s+/g, ' ')
    .trim();
}

function toSlug(urlStr: string): string {
  // URL: /lures/product/?name=slow-blatt-cast-slim
  var nameMatch = urlStr.match(/[?&]name=([^&]+)/);
  if (nameMatch) return nameMatch[1];
  // Fallback
  var parts = urlStr.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || '';
}

function resolveUrl(pageUrl: string, relative: string): string {
  if (relative.startsWith('http')) return relative;
  if (relative.startsWith('//')) return 'https:' + relative;
  // Page URL: https://www.palmsjapan.com/lures/product/?name=slug
  // Relative: slow-blatt-cast-slim/img/product.jpg
  // Base for relative resolution: https://www.palmsjapan.com/lures/product/
  var baseDir = pageUrl.replace(/\?.*$/, '').replace(/[^/]*$/, '');
  return baseDir + relative;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapePalmsPage(url: string): Promise<ScrapedLure> {
  var res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error('[palms] HTTP ' + res.status + ' for ' + url);

  var html = await res.text();

  // -- Product name (English) from h1.pagettl
  var name = '';
  var nameMatch = html.match(/<h1[^>]*class="[^"]*pagettl[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (nameMatch) {
    name = stripTags(nameMatch[1]);
  }

  // -- Japanese name from .logo h2
  var nameKana = '';
  var kanaMatch = html.match(/class="[^"]*logo[^"]*"[\s\S]*?<h2>([\s\S]*?)<\/h2>/i);
  if (kanaMatch) {
    nameKana = stripTags(kanaMatch[1]);
  }

  console.log('[palms] Product: ' + name + (nameKana ? ' (' + nameKana + ')' : ''));

  // -- Main image from .visual img
  var mainImage = '';
  var visualMatch = html.match(/class="[^"]*visual[^"]*"[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>/i);
  if (visualMatch) {
    mainImage = resolveUrl(url, visualMatch[1]);
  }
  // Fallback: .mainimg img
  if (!mainImage) {
    var mainImgMatch = html.match(/class="[^"]*mainimg[^"]*"[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>/i);
    if (mainImgMatch) {
      mainImage = resolveUrl(url, mainImgMatch[1]);
    }
  }

  // -- Spec from table.spec
  var price = 0;
  var lengthVal: number | null = null;
  var weights: number[] = [];

  var specTableMatch = html.match(/<table[^>]*class="[^"]*spec[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (specTableMatch) {
    var specRows = specTableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (specRows) {
      for (var ri = 0; ri < specRows.length; ri++) {
        var row = specRows[ri];

        // Extract all td cells
        var tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (!tds) continue;

        for (var ci = 0; ci < tds.length; ci++) {
          var cellHtml = tds[ci];
          var cellText = stripTags(cellHtml);

          // Price: td.price "本体価格 ¥850"
          if (/class="[^"]*price[^"]*"/i.test(cellHtml)) {
            if (price === 0) {
              var priceMatch = cellText.match(/[¥￥]\s*([\d,]+)/);
              if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
              }
            }
          } else {
            // Weight: "20g" or "1.9g"
            var gMatch = cellText.match(/^(\d+(?:\.\d+)?)\s*g$/i);
            if (gMatch) {
              var w = parseFloat(gMatch[1]);
              if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
            }
            // Length: "56mm" or "35mm"
            var mmMatch = cellText.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
            if (mmMatch && !lengthVal) {
              lengthVal = Math.round(parseFloat(mmMatch[1]));
            }
          }
        }
      }
    }
  }

  // -- Type detection
  var type = detectType(name, '');

  // -- Target fish (determine from URL or name)
  var targetFish: string[] = [];
  var slug = toSlug(url);
  // Palms has saltwater and freshwater categories
  // Most items are saltwater fishing
  if (/alexandra|trout|elassoma|flutterin|degangan|little.*diner/i.test(name + ' ' + slug)) {
    targetFish = ['トラウト'];
  } else {
    targetFish = ['青物', 'シーバス'];
  }

  // -- Colors from div.color .inner
  var colors: ScrapedColor[] = [];

  var colorSection = html.match(/<div[^>]*class="[^"]*\bcolor\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  // Broader match if first one fails
  if (!colorSection) {
    colorSection = html.match(/id="color"[\s\S]*?<div[^>]*class="[^"]*\bcolor\b[^"]*"[^>]*>([\s\S]*)/i);
  }

  if (colorSection) {
    var section = colorSection[1];
    // Find all .inner blocks
    var innerRegex = /<div[^>]*class="[^"]*\binner\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    var innerMatch;
    while ((innerMatch = innerRegex.exec(section)) !== null) {
      var innerHtml = innerMatch[1];

      // Color name from a.lightboximg title attribute
      var cName = '';
      var titleAttrMatch = innerHtml.match(/<a[^>]*class="[^"]*lightboximg[^"]*"[^>]*title="([^"]*)"[^>]*>/i);
      if (titleAttrMatch) {
        cName = titleAttrMatch[1].trim();
      }
      // Fallback: last <p> text
      if (!cName) {
        var pTags = innerHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        if (pTags) {
          for (var pi = pTags.length - 1; pi >= 0; pi--) {
            var pText = stripTags(pTags[pi]).trim();
            if (pText && !/^NEW$/i.test(pText) && pText.length > 1) {
              // Extract just the name (before <br> + code)
              var brSplit = pTags[pi].split(/<br\s*\/?>/i);
              cName = stripTags(brSplit[0]).trim();
              break;
            }
          }
        }
      }

      // Color image from a > img src
      var cImg = '';
      var imgSrcMatch = innerHtml.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
      if (imgSrcMatch) {
        cImg = resolveUrl(url, imgSrcMatch[1]);
      }
      // Also try href as higher-res source
      var hrefMatch = innerHtml.match(/<a[^>]*href="([^"]*\.(?:jpg|jpeg|png|gif|webp))"[^>]*>/i);
      if (hrefMatch) {
        cImg = resolveUrl(url, hrefMatch[1]);
      }

      if (cName || cImg) {
        colors.push({
          name: cName || 'カラー' + String(colors.length + 1).padStart(2, '0'),
          imageUrl: cImg,
        });
      }
    }
  }

  console.log('[palms] Colors: ' + colors.length);
  console.log('[palms] Done: ' + name + ' | type=' + type + ' | colors=' + colors.length + ' | length=' + (lengthVal || '-') + 'mm | price=¥' + price);

  return {
    name: name,
    name_kana: nameKana,
    slug: slug,
    manufacturer: 'Palms',
    manufacturer_slug: 'palms',
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
