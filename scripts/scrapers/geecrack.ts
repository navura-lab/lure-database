// scripts/scrapers/geecrack.ts
// GEECRACK (www.geecrack.com) product page scraper
// Handles lure products from geecrack.com/{bass|saltwater}/product/detail/?id={id}
//
// Site: Custom PHP (Xserver), no WP REST API.
// URL patterns: /{bass|saltwater}/product/detail/?id={numeric_id}
// Title: h2.page_head_ttl.en (English name)
// Kana:  p.page_head_kana (Japanese name)
// Price: p.price (contains ￥{amount})
// Description: p.read (or h2.catch for catchphrase)
// Specs: section#spec > ul.spec_list > li.spec_item
//   .spec_item_left = key, .spec_item_right = value
// Colors: section#variation > ul.variation_list > li.variation_item
//   .v_name > .number (color code) + .name (color name)
//   .v_thumbnail figure img[src] (swatch image)
//   a.v_thumbnail[href] (full-size image via lightbox2)
// Main image: section#p_mv .p_mv_item figure img[src] or .p_item_main figure img[src]

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/バイブ|vibe/i, 'バイブレーション'],
  [/クランク|crank/i, 'クランクベイト'],
  [/ミノー|minnow/i, 'ルアー'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/ペンシル|pencil|ドッグウォーク/i, 'ペンシルベイト'],
  [/フロッグ|frog/i, 'フロッグ'],
  [/スピナー|spinner/i, 'スピナーベイト'],
  [/バズ|buzz/i, 'バズベイト'],
  [/チャター|chatter/i, 'チャターベイト'],
  [/メタルジグ|metal.*jig/i, 'メタルジグ'],
  [/ジグ|jig/i, 'ラバージグ'],
  [/エギ|egi|dart.*max/i, 'エギ'],
  [/スッテ|sutte|ebisuke/i, 'スッテ'],
  [/スイマー|swimmer|スイム|swim/i, 'ルアー'],
  [/シャッド|shad/i, 'ルアー'],
  [/ギル|gill.*flat/i, 'ルアー'],
];

function detectType(name: string, urlCategory: string): string {
  // URL category gives broad hint
  var isHardLure = urlCategory === 'hard_lure';
  var isWireBait = urlCategory === 'wire_bait';
  var isJig = urlCategory === 'jig';
  var isSoftLure = urlCategory === 'soft_lure';
  var isIka = urlCategory === 'ika';

  // Name-based checks
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }

  // Category-based fallback
  if (isSoftLure) return 'ワーム';
  if (isWireBait) return 'スピナーベイト'; // wire baits = spinnerbait/buzzbait
  if (isJig) return 'ラバージグ';
  if (isIka) return 'エギ';
  if (isHardLure) return 'ルアー';

  return 'ワーム';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, urlCategory: string, urlPrefix: string): string[] {
  var all = (name + ' ' + urlCategory).toLowerCase();
  var targets: string[] = [];

  if (urlPrefix === 'bass') {
    targets.push('ブラックバス');
  }
  if (urlPrefix === 'saltwater') {
    if (/ika|イカ|エギ|sutte|squid/i.test(urlCategory + ' ' + name)) targets.push('アオリイカ');
    if (/aji|アジ/i.test(urlCategory + ' ' + name)) targets.push('アジ');
    if (/aomono|青物/i.test(urlCategory + ' ' + name)) targets.push('青物');
    if (/tai|タイ|鯛/i.test(urlCategory + ' ' + name)) targets.push('マダイ');
    if (/seabass|シーバス/i.test(urlCategory + ' ' + name)) targets.push('シーバス');
    if (/rock|ロック/i.test(urlCategory + ' ' + name)) targets.push('ロックフィッシュ');
    if (targets.length === 0) targets.push('ソルト');
  }

  if (targets.length === 0) targets.push('ブラックバス');
  return targets;
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [geecrack] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeGeecrackPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    // Navigate with retry
    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log('Navigating to ' + url + ' (attempt ' + attempt + '/' + maxRetries + ')');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      } catch (navErr: any) {
        if (attempt === maxRetries) throw navErr;
        log('Navigation failed, retrying in 3s...');
        await page.waitForTimeout(3000);
      }
    }

    await page.waitForTimeout(2000);

    // ---------- Extract all data from page ----------
    var data = await page.evaluate(function() {
      // Title: h2.page_head_ttl (English name)
      var h2 = document.querySelector('h2.page_head_ttl');
      var titleEn = h2 ? (h2.textContent || '').trim() : '';

      // Kana: p.page_head_kana (Japanese name)
      var kanaEl = document.querySelector('p.page_head_kana');
      var kana = kanaEl ? (kanaEl.textContent || '').trim() : '';

      // Product name from detail section
      var nameEl = document.querySelector('.product_right .name');
      var detailName = nameEl ? (nameEl.textContent || '').trim() : '';

      // Price: p.price
      var priceEl = document.querySelector('p.price');
      var priceValue = 0;
      if (priceEl) {
        var priceText = priceEl.textContent || '';
        var priceMatch = priceText.match(/[¥￥]\s*([\d,]+)/);
        if (priceMatch) {
          priceValue = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Description: catchphrase + read text
      var catchEl = document.querySelector('h2.catch');
      var catchText = catchEl ? (catchEl.textContent || '').trim() : '';
      var readEl = document.querySelector('p.read');
      var readText = readEl ? (readEl.textContent || '').trim() : '';
      var description = (catchText + ' ' + readText).trim().substring(0, 500);

      // Main image: from p_mv swiper or product_left images
      var mainImage = '';
      var mvImg = document.querySelector('#p_mv .p_mv_item figure img');
      if (mvImg) {
        mainImage = mvImg.getAttribute('src') || '';
      }
      if (!mainImage) {
        var prodImg = document.querySelector('.p_item_main figure img');
        if (prodImg) {
          mainImage = prodImg.getAttribute('src') || '';
        }
      }
      if (mainImage && !mainImage.startsWith('http')) {
        mainImage = 'https://www.geecrack.com' + mainImage;
      }

      // Specs: section#spec > ul.spec_list > li.spec_item
      var specs: Record<string, string> = {};
      var specItems = document.querySelectorAll('#spec .spec_item');
      for (var si = 0; si < specItems.length; si++) {
        var leftEl = specItems[si].querySelector('.spec_item_left');
        var rightEl = specItems[si].querySelector('.spec_item_right');
        if (leftEl && rightEl) {
          var key = (leftEl.textContent || '').trim();
          var val = (rightEl.textContent || '').trim();
          if (key && val && key !== 'カラー') {
            specs[key] = val;
          }
        }
      }

      // Colors: section#variation > ul.variation_list > li.variation_item
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorItems = document.querySelectorAll('#variation .variation_item');
      for (var ci = 0; ci < colorItems.length; ci++) {
        var numberEl = colorItems[ci].querySelector('.v_name .number');
        var nameEl2 = colorItems[ci].querySelector('.v_name .name');
        var colorNumber = numberEl ? (numberEl.textContent || '').trim() : '';
        var colorName = nameEl2 ? (nameEl2.textContent || '').trim() : '';
        var fullColorName = (colorNumber + ' ' + colorName).trim() || (colorNumber || colorName);

        // Image from lightbox link (full-size) or img src (thumbnail)
        var imgUrl = '';
        var lightboxLink = colorItems[ci].querySelector('a.v_thumbnail');
        if (lightboxLink) {
          imgUrl = lightboxLink.getAttribute('href') || '';
        }
        if (!imgUrl) {
          var imgEl = colorItems[ci].querySelector('.p_image img');
          if (imgEl) {
            imgUrl = imgEl.getAttribute('src') || '';
          }
        }
        if (imgUrl && !imgUrl.startsWith('http')) {
          imgUrl = 'https://www.geecrack.com' + imgUrl;
        }

        if (fullColorName) {
          colors.push({ name: fullColorName, imageUrl: imgUrl });
        }
      }

      return {
        titleEn: titleEn,
        kana: kana,
        detailName: detailName,
        price: priceValue,
        description: description,
        mainImage: mainImage,
        specs: specs,
        colors: colors,
      };
    });

    // Use URL to extract slug and category info
    var urlObj = new URL(url);
    var idParam = urlObj.searchParams.get('id') || '';
    var pathParts = urlObj.pathname.split('/').filter(function(p) { return p; });
    var urlPrefix = pathParts[0] || 'bass'; // bass or saltwater
    var urlCategory = '';
    // Try to determine category from referrer/URL context
    // For product detail pages, the URL doesn't contain category info
    // We'll detect from specs and name instead

    var displayName = data.titleEn || data.detailName || data.kana;
    var fullName = (data.titleEn + ' ' + data.kana).trim();

    log('Product: ' + displayName + ' (' + data.kana + ')');
    log('Main image: ' + data.mainImage);
    log('Colors: ' + data.colors.length);
    log('Price: ' + data.price);
    log('Specs: ' + JSON.stringify(data.specs));

    // Generate slug from English name or ID
    var slug = '';
    if (data.titleEn) {
      slug = data.titleEn.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }
    if (!slug) {
      slug = 'geecrack-' + idParam;
    }

    // Detect type (URL category will be empty for direct scrape, use name-based detection)
    var lureType = detectType(fullName, urlCategory);

    // Detect target fish
    var targetFish = detectTargetFish(fullName, urlCategory, urlPrefix);

    // Extract length from specs
    var lengthMm: number | null = null;
    var sizeSpec = data.specs['サイズ'] || data.specs['サイズ(自重)'] || data.specs['全長'] || data.specs['レングス'] || '';
    if (sizeSpec) {
      var mmMatch = sizeSpec.match(/(\d+)\s*mm/);
      if (mmMatch) {
        lengthMm = parseInt(mmMatch[1], 10);
      } else {
        var inchMatch = sizeSpec.match(/([\d.]+)\s*[inchインチ"″]/i);
        if (inchMatch) {
          lengthMm = Math.round(parseFloat(inchMatch[1]) * 25.4);
        }
      }
    }

    // Extract weights
    var weights: number[] = [];
    var weightSpec = data.specs['自重'] || data.specs['重さ'] || data.specs['ウエイト'] || data.specs['Weight'] || sizeSpec || '';
    if (weightSpec) {
      var gMatches = weightSpec.match(/[\d.]+\s*g/gi);
      if (gMatches) {
        for (var wi = 0; wi < gMatches.length; wi++) {
          var gVal = parseFloat(gMatches[wi]);
          if (gVal > 0) weights.push(gVal);
        }
      }
      if (weights.length === 0) {
        var ozMatches = weightSpec.match(/([\d.]+)\s*oz/gi);
        if (ozMatches) {
          for (var oi = 0; oi < ozMatches.length; oi++) {
            var ozVal = parseFloat(ozMatches[oi]);
            if (ozVal > 0) weights.push(Math.round(ozVal * 28.3495 * 10) / 10);
          }
        }
      }
    }

    var result: ScrapedLure = {
      name: displayName,
      name_kana: data.kana,
      slug: slug,
      manufacturer: 'GEECRACK',
      manufacturer_slug: 'geecrack',
      type: lureType,
      target_fish: targetFish,
      description: data.description,
      price: data.price,
      colors: data.colors,
      weights: weights,
      length: lengthMm,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log('Done: ' + result.name + ' | type=' + result.type + ' | colors=' + result.colors.length + ' | price=' + result.price + ' | slug=' + result.slug + ' | length=' + result.length);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
