// scripts/scrapers/littlejack.ts
// Little Jack (little-jack-lure.com) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: WordPress 6.6.4 + TCD Falcon theme (page-lp.php template)
// WP REST API available: /index.php?rest_route=/wp/v2/pages
// No anti-bot measures.
//
// Product URL pattern: /?page_id={ID}
// Content: #lp_page_content with sections identified by headings
// Colors: WordPress gallery (dl.gallery-item)
//   - Image: dt.gallery-icon a[href] (full) or img[src] (thumbnail -250x250)
//   - Name: dd.gallery-caption text (e.g. "#01 レーザーイワシ＋リアルプリント")
//   - Fallback: JAN CODE table if gallery captions are missing
// Specs: <table> inside section with heading "Price & Spec" or "Price&Spec"
//   - Layout A (horizontal): header row has product variant names, data rows have Weight/Size/Type/JPY
//   - Layout B (vertical): rows with header th and value tds
// Main image: cb_gallery_content background-image URL
// Hero fallback: WP REST API featured_media

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/metal\s*adict|メタル\s*アディクト/i, 'メタルジグ'],
  [/jig\s*head|ジグヘッド/i, 'ジグヘッド'],
  [/jig|ジグ/i, 'メタルジグ'],
  [/spoon|スプーン/i, 'スプーン'],
  [/vibration|バイブレーション|バイブ/i, 'バイブレーション'],
  [/minnow|ミノー/i, 'ミノー'],
  [/pencil|ペンシル/i, 'シンキングペンシル'],
  [/popper|ポッパー/i, 'ポッパー'],
  [/sayoris|サヨリ/i, 'シンキングペンシル'],
  [/crank|クランク/i, 'クランクベイト'],
  [/plug|プラグ/i, 'プラグ'],
  [/blade|ブレード/i, 'ブレードベイト'],
  [/squid|スクイッド|イカ/i, 'エギ'],
  [/worm|ワーム/i, 'ワーム'],
  [/frog|フロッグ/i, 'フロッグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log('[' + timestamp() + '] [littlejack] ' + msg);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function detectType(name: string, specType: string): string {
  // Check name first
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) {
      return NAME_TYPE_MAP[i][1];
    }
  }
  // Check spec type field (e.g. "Sinking", "Sinking Pencil", "Floating")
  if (specType) {
    var st = specType.toLowerCase();
    if (/sinking\s*pencil/.test(st)) return 'シンキングペンシル';
    if (/floating/.test(st)) return 'プラグ';
    if (/sinking/.test(st)) return 'メタルジグ';
  }
  return 'ルアー';
}

function makeAbsolute(href: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return 'https://www.little-jack-lure.com' + href;
  return 'https://www.little-jack-lure.com/' + href;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeLittleJackPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!resp.ok) {
    throw new Error('HTTP ' + resp.status + ' for ' + url);
  }
  var html = await resp.text();

  // --- Product name from <title> ---
  var titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  var rawName = '';
  if (titleMatch) {
    rawName = stripHtml(titleMatch[1]).replace(/\s*\|\s*Little\s*Jack\s*$/i, '').trim();
  }
  if (!rawName) {
    // Fallback: og:title
    var ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) {
      rawName = stripHtml(ogMatch[1]).replace(/\s*\|\s*Little\s*Jack\s*$/i, '').trim();
    }
  }
  if (!rawName) rawName = 'Unknown';

  log('Product: ' + rawName);

  // --- Extract page_id for slug ---
  var pageIdMatch = url.match(/page_id=(\d+)/);
  var pageId = pageIdMatch ? pageIdMatch[1] : '';
  var productSlug = slugify(rawName) || ('littlejack-' + pageId);

  // --- Extract #lp_page_content sections ---
  var lpContentMatch = html.match(/<div[^>]*id=["']lp_page_content["'][^>]*>([\s\S]*?)(?=<footer|<div[^>]*id=["']footer|$)/i);
  var lpHtml = lpContentMatch ? lpContentMatch[1] : html;

  // --- Main/Hero image from cb_gallery_content background-image ---
  var mainImage = '';
  var bgMatch = lpHtml.match(/background:\s*url\(([^)]+)\)/i);
  if (bgMatch) {
    mainImage = makeAbsolute(bgMatch[1].replace(/['"]/g, ''));
  }

  // --- Description text (Japanese) ---
  var description = '';
  // First lp_free_space section typically has JP description
  var descSections = lpHtml.match(/<div[^>]*lp_content\s+lp_free_space[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*(?:lp_content|cb_gallery)|$)/gi);
  if (descSections && descSections.length > 0) {
    // Get first text-heavy section
    for (var ds = 0; ds < Math.min(descSections.length, 3); ds++) {
      var sectionText = stripHtml(descSections[ds]).trim();
      if (sectionText.length > 20 && !/price|spec|color\s*chart|jan\s*code/i.test(sectionText.substring(0, 50))) {
        description = sectionText.substring(0, 500);
        break;
      }
    }
  }

  // --- Price & Spec table ---
  var price = 0;
  var weights: number[] = [];
  var length: number | null = null;
  var specType = '';

  // Find the section containing "Price" and "Spec"
  var specSectionMatch = lpHtml.match(/<h3[^>]*>[^<]*Price[^<]*Spec[^<]*<\/h3>([\s\S]*?)(?=<h3[^>]*>|<div[^>]*(?:lp_content|cb_gallery))/i);
  if (!specSectionMatch) {
    // Try broader search for a table near "Price"
    specSectionMatch = lpHtml.match(/Price\s*(?:&amp;|&)?\s*Spec[\s\S]*?(<table[\s\S]*?<\/table>)/i);
  }

  if (specSectionMatch) {
    var specHtml = specSectionMatch[1] || specSectionMatch[0];
    var tableMatch = specHtml.match(/<table[\s\S]*?<\/table>/i);
    if (tableMatch) {
      var tableHtml = tableMatch[0];

      // Parse rows
      var rows: string[][] = [];
      var rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (var ri = 0; ri < rowMatches.length; ri++) {
        var cells: string[] = [];
        var cellMatches = rowMatches[ri].match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
        for (var ci = 0; ci < cellMatches.length; ci++) {
          cells.push(stripHtml(cellMatches[ci]));
        }
        if (cells.length > 0) rows.push(cells);
      }

      if (rows.length >= 2) {
        // Detect layout:
        // Layout A (horizontal): first cell of each row is a label (Weight, Size, Type, JPY)
        // Layout B (vertical): rows represent individual SKUs
        var firstCellLower = rows.length > 1 ? rows[1][0].toLowerCase() : '';

        if (/weight|重さ|重量/.test(firstCellLower) || /size|サイズ|全長/.test(firstCellLower)) {
          // Layout A: header row = product names, subsequent rows = Weight/Size/Type/JPY
          for (var r = 1; r < rows.length; r++) {
            var label = rows[r][0].toLowerCase();
            for (var c = 1; c < rows[r].length; c++) {
              var val = rows[r][c].trim();
              if (/weight|重さ|重量/.test(label)) {
                var wm = val.match(/([\d.]+)\s*g/i);
                if (wm) {
                  var w = parseFloat(wm[1]);
                  if (w > 0 && weights.indexOf(w) === -1) weights.push(w);
                }
              }
              if (/size|サイズ|全長|length/.test(label) && length === null) {
                var lm = val.match(/([\d.]+)\s*mm/i);
                if (lm) length = parseFloat(lm[1]);
              }
              if (/type|タイプ|種類/.test(label) && !specType) {
                specType = val;
              }
              if (/jpy|price|価格|円/.test(label) && price === 0) {
                var pm = val.replace(/,/g, '').match(/([\d]+)/);
                if (pm) {
                  price = parseInt(pm[1], 10);
                  // If tax-excluded, add 10%
                  if (/税別|tax\s*excluded/i.test(val) || /税別|tax\s*excluded/i.test(label)) {
                    price = Math.round(price * 1.1);
                  }
                }
              }
            }
          }
        } else {
          // Layout B (vertical) or generic: look for specific headers
          // Check if first row has header labels
          var headers = rows[0].map(function(h) { return h.toLowerCase(); });
          var weightIdx = headers.findIndex(function(h) { return /weight|重さ|重量/.test(h); });
          var lengthIdx = headers.findIndex(function(h) { return /size|サイズ|全長|length/.test(h); });
          var typeIdx = headers.findIndex(function(h) { return /type|タイプ/.test(h); });
          var priceIdx = headers.findIndex(function(h) { return /jpy|price|価格/.test(h); });

          for (var r = 1; r < rows.length; r++) {
            if (weightIdx >= 0 && rows[r][weightIdx]) {
              var wm2 = rows[r][weightIdx].match(/([\d.]+)\s*g/i);
              if (wm2) {
                var w2 = parseFloat(wm2[1]);
                if (w2 > 0 && weights.indexOf(w2) === -1) weights.push(w2);
              }
            }
            if (lengthIdx >= 0 && length === null && rows[r][lengthIdx]) {
              var lm2 = rows[r][lengthIdx].match(/([\d.]+)\s*mm/i);
              if (lm2) length = parseFloat(lm2[1]);
            }
            if (typeIdx >= 0 && !specType && rows[r][typeIdx]) {
              specType = rows[r][typeIdx];
            }
            if (priceIdx >= 0 && price === 0 && rows[r][priceIdx]) {
              var pm2 = rows[r][priceIdx].replace(/,/g, '').match(/([\d]+)/);
              if (pm2) {
                price = parseInt(pm2[1], 10);
                if (/税別|tax\s*excluded/i.test(rows[r][priceIdx])) {
                  price = Math.round(price * 1.1);
                }
              }
            }
          }
        }
      }
    }
  }

  // --- Color Chart ---
  var colors: ScrapedColor[] = [];

  // Find all gallery sections (may have multiple for different weight variants)
  var galleryMatches = lpHtml.match(/<div[^>]*class=["'][^"']*gallery\s+galleryid[^"']*["'][^>]*>[\s\S]*?<\/div>/gi) || [];

  // Also try to find <dl class="gallery-item"> directly
  if (galleryMatches.length === 0) {
    // Check if there are gallery items without the wrapper
    var hasGalleryItems = /<dl[^>]*class=["'][^"']*gallery-item[^"']*["']/.test(lpHtml);
    if (hasGalleryItems) {
      galleryMatches = [lpHtml]; // Use entire LP HTML
    }
  }

  var seenColorNames: string[] = [];

  for (var gi = 0; gi < galleryMatches.length; gi++) {
    var galleryHtml = galleryMatches[gi];
    var itemMatches = galleryHtml.match(/<dl[^>]*class=["'][^"']*gallery-item[^"']*["'][^>]*>[\s\S]*?<\/dl>/gi) || [];

    for (var ii = 0; ii < itemMatches.length; ii++) {
      var itemHtml = itemMatches[ii];

      // Image: <a href="FULL_URL"><img src="THUMB_URL">
      var imgUrl = '';
      var aHrefMatch = itemHtml.match(/<a[^>]*href=["']([^"']+)["']/i);
      if (aHrefMatch) {
        imgUrl = makeAbsolute(aHrefMatch[1]);
      } else {
        var imgSrcMatch = itemHtml.match(/<img[^>]*src=["']([^"']+)["']/i);
        if (imgSrcMatch) {
          // Remove thumbnail suffix to get full image
          imgUrl = makeAbsolute(imgSrcMatch[1].replace(/-\d+x\d+(\.\w+)$/, '$1'));
        }
      }

      // Color name: <dd class="gallery-caption">
      var colorName = '';
      var captionMatch = itemHtml.match(/<dd[^>]*class=["'][^"']*gallery-caption[^"']*["'][^>]*>([\s\S]*?)<\/dd>/i);
      if (captionMatch) {
        colorName = stripHtml(captionMatch[1]).trim();
      }

      if (imgUrl && colorName && seenColorNames.indexOf(colorName) === -1) {
        seenColorNames.push(colorName);
        colors.push({ name: colorName, imageUrl: imgUrl });
      } else if (imgUrl && !colorName) {
        // No caption — will try to fill from JAN CODE table later
        colors.push({ name: '', imageUrl: imgUrl });
      }
    }
  }

  // --- JAN CODE table fallback for color names ---
  var janMatch = lpHtml.match(/JAN\s*CODE[\s\S]*?(<table[\s\S]*?<\/table>)/i);
  if (janMatch && colors.some(function(c) { return !c.name; })) {
    var janTable = janMatch[1];
    var janRows = janTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    var janColorNames: string[] = [];

    for (var jr = 1; jr < janRows.length; jr++) { // Skip header row
      var janCells = janRows[jr].match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
      if (janCells.length > 0) {
        var cname = stripHtml(janCells[0]).trim();
        if (cname && !/^\d+$/.test(cname)) { // Not just a number
          janColorNames.push(cname);
        }
      }
    }

    // Fill in missing names
    var unnamedIdx = 0;
    for (var fi = 0; fi < colors.length; fi++) {
      if (!colors[fi].name && unnamedIdx < janColorNames.length) {
        colors[fi].name = janColorNames[unnamedIdx];
        unnamedIdx++;
      }
    }
  }

  // Remove colors that still have no name
  colors = colors.filter(function(c) { return c.name && c.imageUrl; });

  // Deduplicate by name (multiple galleries for weight variants may have same colors)
  var uniqueColors: ScrapedColor[] = [];
  var colorNameSet: string[] = [];
  for (var uc = 0; uc < colors.length; uc++) {
    if (colorNameSet.indexOf(colors[uc].name) === -1) {
      colorNameSet.push(colors[uc].name);
      uniqueColors.push(colors[uc]);
    }
  }
  colors = uniqueColors;

  // --- Type detection ---
  var lureType = detectType(rawName, specType);

  // --- Name kana (not available on this site — leave empty) ---
  var nameKana = '';

  // --- Target fish ---
  var targetFish: string[] = [];
  // Extract from description or name hints
  if (/shore|ショア|青物|ジギング/i.test(rawName + ' ' + description)) targetFish.push('青物');
  if (/seabass|シーバス|スズキ/i.test(rawName + ' ' + description)) targetFish.push('シーバス');
  if (/hirame|ヒラメ|flathead|マゴチ|flat\s*fish/i.test(rawName + ' ' + description)) targetFish.push('ヒラメ・マゴチ');
  if (/rock|ロック|根魚|カサゴ|メバル/i.test(rawName + ' ' + description)) targetFish.push('ロックフィッシュ');
  if (/trout|トラウト/i.test(rawName + ' ' + description)) targetFish.push('トラウト');
  if (/bass|バス/i.test(rawName + ' ' + description) && !/seabass|シーバス/i.test(rawName + ' ' + description)) targetFish.push('ブラックバス');
  if (/squid|イカ|エギ/i.test(rawName + ' ' + description)) targetFish.push('アオリイカ');
  if (/鯛|タイ|tai|bream/i.test(rawName + ' ' + description)) targetFish.push('マダイ');

  log('Colors: ' + colors.length);
  log('Done: ' + rawName + ' | type=' + lureType + ' | colors=' + colors.length + ' | length=' + length + 'mm | price=¥' + price);

  return {
    name: rawName,
    name_kana: nameKana,
    slug: productSlug,
    manufacturer: 'Little Jack',
    manufacturer_slug: 'littlejack',
    type: lureType,
    target_fish: targetFish,
    description: description,
    price: price,
    colors: colors,
    weights: weights,
    length: length,
    mainImage: mainImage,
    sourceUrl: url,
  };
}
