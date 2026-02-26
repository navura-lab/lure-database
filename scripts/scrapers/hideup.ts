// scripts/scrapers/hideup.ts
// HIDEUP (hideup.jp) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: Custom PHP + Bootstrap 5.3.3 (hideup.jp)
// No REST API, no sitemap. Product listing page at /product/
//
// Product URL pattern: /product/{slug}.php
// Colors: div.color_chart_flex > div.color-chart
//   - Image: .color-chart img.img-fluid (src)
//   - Name:  h3.color_name (format: "#NN ColorName")
//   - JAN:   h2.jan_code
// Specs: .spec_table_container table tr > th + td
//   - Price: "メーカー希望本体価格" → "1,870円 (税込)"
//   - Length: "全長" → "94mm"
//   - Weight: "重さ" → "約15.4g"
// Main image: article.main > img.img-fluid (first)

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/crank|クランク|pylon|パイロン/i, 'クランクベイト'],
  [/minnow|ミノー/i, 'ミノー'],
  [/pencil|ペンシル/i, 'ペンシルベイト'],
  [/popper|ポッパー/i, 'ポッパー'],
  [/buzz|バズ/i, 'バズベイト'],
  [/spinnerbait|スピナーベイト/i, 'スピナーベイト'],
  [/chatterbait|チャターベイト/i, 'チャターベイト'],
  [/swim.*jig|スイムジグ/i, 'ラバージグ'],
  [/jig|ジグ/i, 'ラバージグ'],
  [/frog|フロッグ|蛙/i, 'フロッグ'],
  [/umbrella|アンブレラ/i, 'アラバマリグ'],
  [/shad|シャッド/i, 'シャッド'],
  [/vibration|バイブレーション/i, 'バイブレーション'],
  [/prop|プロップ/i, 'プロップベイト'],
];

var CATEGORY_TYPE_MAP: Record<string, string> = {
  'hard lures': 'ルアー',
  'soft lures': 'ワーム',
  'jigs': 'ラバージグ',
  'umbrella rig': 'アラバマリグ',
  'saltwater': 'ルアー',
  'retreex': 'ルアー',
};

function detectType(name: string, category: string, descriptionText: string): string {
  var nameLower = name.toLowerCase();
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(nameLower) || NAME_TYPE_MAP[i][0].test(name)) {
      return NAME_TYPE_MAP[i][1];
    }
  }
  // Check category
  var catLower = category.toLowerCase();
  for (var key in CATEGORY_TYPE_MAP) {
    if (catLower.indexOf(key) >= 0) return CATEGORY_TYPE_MAP[key];
  }
  // Check page description (h2/h3 text) for type keywords
  // e.g., HU-200 has "クランク" in its description h2
  for (var j = 0; j < NAME_TYPE_MAP.length; j++) {
    if (NAME_TYPE_MAP[j][0].test(descriptionText)) {
      return NAME_TYPE_MAP[j][1];
    }
  }
  return 'ルアー';
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log('[' + new Date().toISOString() + '] [hideup] ' + msg);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeHideupPage(url: string): Promise<ScrapedLure> {
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

  // ---------- Title ----------
  // Note: HIDEUP uses single quotes for h1 class attribute: <h1 class='fs-3 fw-bold my-4'>
  var titleMatch = html.match(/<h1[^>]*class=['"][^'"]*fs-3[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/);
  var rawName = titleMatch ? stripHtml(titleMatch[1]).trim() : '';
  if (!rawName) {
    // Fallback: <title> tag
    var titleTagMatch = html.match(/<title>([^<]*)<\/title>/);
    rawName = titleTagMatch ? stripHtml(titleTagMatch[1]).replace(/\s*[\|｜\-].*/g, '').trim() : '';
  }
  if (!rawName) {
    throw new Error('Could not extract title from: ' + url);
  }
  // Clean brand name suffix that appears on some pages
  rawName = rawName.replace(/\s+HIDEUP\s+ハイドアップ\s*$/, '').trim();
  log('Product: ' + rawName);

  // ---------- Japanese name (kana) ----------
  // Some pages have <p class='mb-4'>スタッガーワイド4インチ</p> after h1
  var kanaMatch = html.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*class=['"]mb-4['"][^>]*>([^<]+)<\/p>/);
  var nameKana = kanaMatch ? stripHtml(kanaMatch[1]).trim() : '';

  // ---------- Slug ----------
  var urlPath = url.replace(/\.php$/, '').replace(/\/$/, '');
  var slug = urlPath.split('/').pop() || '';
  if (!slug) {
    throw new Error('Could not extract slug from: ' + url);
  }

  // ---------- Breadcrumb / Category ----------
  var category = '';
  var bcMatch = html.match(/breadcrumb[\s\S]*?<\/nav>/);
  if (bcMatch) {
    // Get all breadcrumb items
    var bcItems = bcMatch[0].match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
    if (bcItems.length >= 2) {
      // Category is usually the second-to-last item
      for (var bi = 1; bi < bcItems.length - 1; bi++) {
        var bcText = stripHtml(bcItems[bi]);
        if (bcText && bcText !== 'Home' && bcText !== 'Products') {
          category = bcText;
        }
      }
    }
  }

  // ---------- Description ----------
  var descParagraphs: string[] = [];
  var articleMatch = html.match(/<article[^>]*class="main"[^>]*>([\s\S]*?)<\/article>/);
  if (articleMatch) {
    var ps = articleMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
    for (var pi = 0; pi < ps.length; pi++) {
      var clean = stripHtml(ps[pi]);
      if (clean.length > 15 && clean.length < 400) {
        descParagraphs.push(clean);
      }
    }
  }
  var description = descParagraphs.slice(0, 3).join(' ').substring(0, 500);

  // ---------- Base URL for images ----------
  var baseUrl = url.replace(/\/[^/]*\.php$/, '');

  // ---------- Main image ----------
  // article.main > img.img-fluid (first). Attributes may use single or double quotes.
  var mainImgMatch = html.match(/<article[^>]*class=['"]main['"][\s\S]*?<img[^>]*src=['"]([^'"]*)['"]/);
  var mainImage = mainImgMatch ? mainImgMatch[1] : '';
  if (mainImage && mainImage.startsWith('./')) {
    mainImage = baseUrl + mainImage.substring(1);
  } else if (mainImage && !mainImage.startsWith('http')) {
    mainImage = baseUrl + '/' + mainImage;
  }

  // ---------- Colors ----------
  // Strategy: find all h3.color_name elements with their sibling img.
  // Each color item is a div.color-chart containing:
  //   <a><img src="..." class="img-fluid" /></a>
  //   <h2 class="jan_code">...</h2>
  //   <h3 class="color_name">...</h3>
  //   <h4 class="color_ename">...</h4>  (optional)
  // Items are grouped in div.color_chart_flex sections.
  // Use a simpler approach: split by color-chart div boundaries.
  var colors: ScrapedColor[] = [];

  // Find all color_chart_flex sections (may span multiple h2 sections)
  var allColorHtml = '';
  var flexMatches = html.match(/<div[^>]*color_chart_flex[^>]*>[\s\S]*?(?=<h2[^>]*class=['"]my-4|<\/article|<footer)/g) || [];
  for (var fi = 0; fi < flexMatches.length; fi++) {
    allColorHtml += flexMatches[fi] + '\n';
  }

  // Extract individual color items by matching color_name h3 tags and looking back for img
  // More robust: split the combined HTML by color-chart div boundaries
  var colorChunks = allColorHtml.split(/(?=<div[^>]*\bcolor-chart\b)/);
  for (var ci = 0; ci < colorChunks.length; ci++) {
    var chunk = colorChunks[ci];
    if (chunk.indexOf('color-chart') < 0) continue;

    var nameMatch = chunk.match(/class=['"]color_name['"][^>]*>([\s\S]*?)<\/h3>/);
    var imgMatch = chunk.match(/<img[^>]*src=['"]([^'"]*)['"]/);

    if (nameMatch) {
      var colorName = stripHtml(nameMatch[1]);
      var imageUrl = imgMatch ? imgMatch[1] : '';
      // Resolve relative URLs
      if (imageUrl && imageUrl.startsWith('./')) {
        imageUrl = baseUrl + imageUrl.substring(1);
      } else if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = baseUrl + '/' + imageUrl;
      }

      // Deduplicate by name (jig pages may have same colors in different weight sections)
      var isDupe = false;
      for (var di = 0; di < colors.length; di++) {
        if (colors[di].name === colorName) { isDupe = true; break; }
      }
      if (!isDupe) {
        colors.push({
          name: colorName,
          imageUrl: imageUrl,
        });
      }
    }
  }
  log('Colors: ' + colors.length);

  // ---------- Specs ----------
  var price = 0;
  var lengthMm: number | null = null;
  var weights: number[] = [];
  var hasIrisuu = false; // 入数 (piece count) — soft bait indicator

  // Layout A: Vertical table — each row has <th>Label</th><td>Value</td>
  // Used by hard lures and soft lures (e.g., HU-200, Stagger Wide)
  var specContainer = html.match(/spec_table_container[\s\S]*?<\/table>/)?.[0] || '';
  var specRows = specContainer.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (var ri = 0; ri < specRows.length; ri++) {
    var row = specRows[ri];
    var thMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    var tdMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!thMatch || !tdMatch) continue;

    var label = stripHtml(thMatch[1]);
    var value = stripHtml(tdMatch[1]);

    // Price
    if (/希望.*価格|価格/.test(label)) {
      var priceMatch = value.match(/([\d,]+)円\s*\(?税込/);
      if (priceMatch) {
        price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
      } else {
        var yenMatch = value.match(/([\d,]+)円/);
        if (yenMatch) {
          price = parseInt(yenMatch[1].replace(/,/g, ''), 10);
        }
      }
    }

    // Length (全長 or 長さ)
    if (/^全長$|^長さ$/.test(label)) {
      var lenMatch = value.match(/(\d+(?:\.\d+)?)\s*mm/);
      if (lenMatch) {
        lengthMm = Math.round(parseFloat(lenMatch[1]));
      }
    }

    // Weight
    if (/^重さ$|^ウェイト$|^自重$/.test(label)) {
      var wMatch = value.match(/約?(\d+(?:\.\d+)?)\s*g/);
      if (wMatch) {
        weights.push(parseFloat(wMatch[1]));
      }
    }

    // Piece count (入数)
    if (/^入数$/.test(label)) {
      hasIrisuu = true;
    }
  }

  // Layout B: Horizontal table — headers in first row, data in subsequent rows
  // Used by jigs (e.g., Slide Fall Jig): <th>重さ</th><th>フックサイズ</th><th>入数</th><th>価格</th>
  if (specRows.length > 0) {
    var firstRow = specRows[0];
    var allThs = firstRow.match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
    // If first row has multiple th's and no td's, it's a horizontal layout
    var firstRowTds = firstRow.match(/<td/g) || [];
    if (allThs.length >= 2 && firstRowTds.length === 0) {
      var headers: string[] = [];
      for (var hi = 0; hi < allThs.length; hi++) {
        headers.push(stripHtml(allThs[hi]));
      }
      // Check for 入数 in headers
      for (var hh = 0; hh < headers.length; hh++) {
        if (/入数/.test(headers[hh])) hasIrisuu = true;
      }
      // Parse data rows
      for (var dri = 1; dri < specRows.length; dri++) {
        var dataCells = specRows[dri].match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
        for (var dci = 0; dci < Math.min(dataCells.length, headers.length); dci++) {
          var hdr = headers[dci];
          var val = stripHtml(dataCells[dci]);

          // Price
          if (/希望.*価格|価格/.test(hdr) && price === 0) {
            var pm = val.match(/([\d,]+)円/);
            if (pm) price = parseInt(pm[1].replace(/,/g, ''), 10);
          }
          // Weight
          if (/重さ|ウェイト/.test(hdr)) {
            // May contain multiple weights like "2.7g・3.5g"
            var wAll = val.match(/(\d+(?:\.\d+)?)\s*g/g) || [];
            for (var wi = 0; wi < wAll.length; wi++) {
              var wm = wAll[wi].match(/(\d+(?:\.\d+)?)/);
              if (wm) {
                var wv = parseFloat(wm[1]);
                var wDupe = false;
                for (var wd = 0; wd < weights.length; wd++) {
                  if (weights[wd] === wv) { wDupe = true; break; }
                }
                if (!wDupe) weights.push(wv);
              }
            }
          }
        }
      }
    }
  }

  // ---------- Type ----------
  // Gather description text from h2/h3 elements near the top of the article
  // for type detection (e.g., HU-200's h2 mentions "クランク")
  var descTextForType = '';
  var h2h3Matches = html.match(/<h[23][^>]*class=['"]my-4['"][^>]*>([\s\S]*?)<\/h[23]>/g) || [];
  for (var hti = 0; hti < Math.min(h2h3Matches.length, 5); hti++) {
    descTextForType += ' ' + stripHtml(h2h3Matches[hti]);
  }

  // Priority: Name-based detection FIRST (jig, crank etc.), THEN fall back to 入数 for soft lure.
  // Jig pages also have 入数 in spec table, so name check must come first.
  var nameBasedType = detectType(rawName, category, descTextForType);
  var lureType: string;
  if (nameBasedType !== 'ルアー') {
    // Name/category/description matched a specific type — use it
    lureType = nameBasedType;
  } else if (hasIrisuu) {
    // Has 入数 (piece count) and no specific type from name — it's a soft bait
    lureType = 'ワーム';
  } else {
    lureType = nameBasedType; // defaults to 'ルアー'
  }

  // ---------- Target fish ----------
  // HIDEUP is primarily a bass fishing brand, but has some saltwater products
  var targetFish = ['ブラックバス'];
  if (/saltwater|ソルト|salt/i.test(category) || /saltwater|ソルト|salt/i.test(url)) {
    targetFish = ['シーバス', 'ヒラメ', 'マゴチ'];
  }

  // ---------- Result ----------
  var result: ScrapedLure = {
    name: rawName,
    name_kana: nameKana,
    slug: slug,
    manufacturer: 'HIDEUP',
    manufacturer_slug: 'hideup',
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
      ' | length=' + result.length + 'mm | price=¥' + result.price);

  return result;
}
