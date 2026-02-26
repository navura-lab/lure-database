// scripts/scrapers/engine.ts
// ENGINE (engine.rings-fishing.jp) product page scraper
// Fetch-only — no Playwright needed.
//
// Site: WordPress 6.2.2 (engine.rings-fishing.jp — subdomain of rings-fishing.jp)
// REST API exists but product CPT not exposed. HTML scraping required.
//
// Product URL pattern: /page2/{slug}/
// Colors: section.detail_Color_Wrap > ul.item_color_List > li > a
//   - Image: li > a > img (src = full-size image)
//   - Name:  li > a > span (format: "#NN ColorName")
// Specs: embedded in <p> tags within h1.item_main_image or article#detail_Main
//   - Soft bait: "Color：10色　Price：¥1,089（税込）　入数：5匹"
//   - Hard bait: "Length：60mm　Weight：2.0g　HOOK：#12"
// Main image: h1.item_main_image > p:first-child img (http:// → https://)

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/hang|ハング/i, 'ルアー'],
  [/crank|クランク/i, 'クランクベイト'],
  [/minnow|ミノー/i, 'ミノー'],
  [/pencil|ペンシル/i, 'ペンシルベイト'],
  [/popper|ポッパー/i, 'ポッパー'],
  [/buzz|バズ/i, 'バズベイト'],
  [/spinnerbait|スピナーベイト/i, 'スピナーベイト'],
  [/chatterbait|チャターベイト/i, 'チャターベイト'],
  [/swim.*jig|スイムジグ/i, 'ラバージグ'],
  [/jig|ジグ/i, 'ラバージグ'],
  [/frog|フロッグ/i, 'フロッグ'],
];

var CATEGORY_TYPE_MAP: Record<string, string> = {
  'hard-bait': 'ルアー',
  'soft-bait': 'ワーム',
  'loops': 'ラバージグ',
  'collaboration': 'ルアー',
};

function detectType(name: string, url: string, breadcrumb: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  // Check breadcrumb for category
  if (/SOFT\s*BAIT|ソフトベイト/i.test(breadcrumb)) return 'ワーム';
  if (/HARD\s*BAIT|ハードベイト/i.test(breadcrumb)) return 'ルアー';
  if (/LOOPS/i.test(breadcrumb)) return 'ラバージグ';
  // Check URL for category hints
  for (var key in CATEGORY_TYPE_MAP) {
    if (url.indexOf(key) >= 0) return CATEGORY_TYPE_MAP[key];
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
    .replace(/\u3000/g, ' ') // full-width space
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log('[' + new Date().toISOString() + '] [engine] ' + msg);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeEnginePage(url: string): Promise<ScrapedLure> {
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
  var titleMatch = html.match(/<title>([\s\S]*?)\s*\|/);
  var rawName = titleMatch ? stripHtml(titleMatch[1]).trim() : '';
  if (!rawName) {
    // Fallback: breadcrumb last span
    var bcMatch = html.match(/path\.top[\s\S]*?<span[^>]*>([^<]+)<\/span>\s*<\/li>\s*<\/ul>/);
    rawName = bcMatch ? stripHtml(bcMatch[1]) : '';
  }
  if (!rawName) {
    throw new Error('Could not extract title from: ' + url);
  }
  log('Product: ' + rawName);

  // ---------- Slug ----------
  var urlPath = url.replace(/\/$/, '');
  var slug = urlPath.split('/').pop() || '';
  if (!slug) {
    throw new Error('Could not extract slug from: ' + url);
  }

  // ---------- Breadcrumb (for type detection) ----------
  var breadcrumb = '';
  var bcSection = html.match(/path\.top([\s\S]*?)<\/nav>/);
  if (bcSection) {
    breadcrumb = stripHtml(bcSection[1]);
  }

  // ---------- Description ----------
  var descParagraphs: string[] = [];
  var mainArea = html.match(/detail_Main([\s\S]*?)(?:detail_Side|detail_Color)/);
  if (mainArea) {
    var ps = mainArea[1].match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
    for (var pi = 0; pi < ps.length; pi++) {
      var clean = stripHtml(ps[pi]);
      // Skip spec lines and very short lines
      if (/^(?:Color|Length|Weight|Price|推奨|※)/i.test(clean)) continue;
      if (clean.length > 10 && clean.length < 300) {
        descParagraphs.push(clean);
      }
    }
  }
  var description = descParagraphs.slice(0, 3).join(' ').substring(0, 500);

  // ---------- Main image ----------
  var mainImgMatch = html.match(/item_main_image[\s\S]*?<img[^>]*src="([^"]*)"/);
  var mainImage = mainImgMatch ? mainImgMatch[1] : '';
  // Convert http:// to https://
  if (mainImage.startsWith('http://')) {
    mainImage = mainImage.replace('http://', 'https://');
  }
  if (mainImage && !mainImage.startsWith('http')) {
    mainImage = 'https://engine.rings-fishing.jp' + mainImage;
  }

  // ---------- Colors ----------
  var colors: ScrapedColor[] = [];
  var colorSection = html.match(/detail_Color_Wrap([\s\S]*?)(?:<\/section>)/);
  if (colorSection) {
    var colorItems = colorSection[1].match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
    for (var ci = 0; ci < colorItems.length; ci++) {
      var item = colorItems[ci];
      var imgMatch = item.match(/<img[^>]*src="([^"]*)"/);
      var nameMatch = item.match(/<span[^>]*>([\s\S]*?)<\/span>/);

      if (nameMatch) {
        var colorName = stripHtml(nameMatch[1]);
        var imageUrl = imgMatch ? imgMatch[1] : '';
        // Convert http:// to https://
        if (imageUrl.startsWith('http://')) {
          imageUrl = imageUrl.replace('http://', 'https://');
        }
        if (imageUrl && !imageUrl.startsWith('http')) {
          imageUrl = 'https://engine.rings-fishing.jp' + imageUrl;
        }
        colors.push({
          name: colorName,
          imageUrl: imageUrl,
        });
      }
    }
  }
  log('Colors: ' + colors.length);

  // ---------- Specs (from paragraph text) ----------
  var price = 0;
  var lengthMm: number | null = null;
  var weights: number[] = [];

  // Search all text in main area for spec patterns
  var allText = mainArea ? stripHtml(mainArea[1]) : '';

  // Price: "Price：¥1,089（税込）" or "¥1,089" or "￥1,089"
  var priceMatch = allText.match(/Price[：:]\s*[¥￥]([\d,]+)/);
  if (priceMatch) {
    price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
  } else {
    // Try standalone yen
    var yenMatch = allText.match(/[¥￥]([\d,]+)\s*[（(]税込/);
    if (yenMatch) {
      price = parseInt(yenMatch[1].replace(/,/g, ''), 10);
    }
  }

  // Length: "Length：60mm" or "全長：60mm"
  var lengthMatch = allText.match(/Length[：:]\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (lengthMatch) {
    lengthMm = Math.round(parseFloat(lengthMatch[1]));
  } else {
    // Try parsing from product name: "60" at end of name → 60mm
    var nameLenMatch = rawName.match(/(\d+)$/);
    if (nameLenMatch) {
      var num = parseInt(nameLenMatch[1], 10);
      if (num >= 30 && num <= 300) {
        lengthMm = num;
      }
    }
  }

  // Weight: "Weight：2.0g" or "自重は約7.8ｇ" or "自重：7.8g"
  var weightMatch = allText.match(/Weight[：:]\s*([\d.]+)\s*g/i);
  if (weightMatch) {
    weights.push(parseFloat(weightMatch[1]));
  }
  var weightMatch2 = allText.match(/自重[はが約：:]*\s*([\d.]+)\s*[gｇ]/);
  if (weightMatch2 && weights.length === 0) {
    weights.push(parseFloat(weightMatch2[1]));
  }

  // ---------- Type ----------
  // Soft bait detection: "入数" (piece count) only appears on soft bait spec lines
  var isSoftBait = /入数/.test(allText);
  var lureType = isSoftBait ? 'ワーム' : detectType(rawName, url, breadcrumb);

  // ---------- Target fish ----------
  var targetFish = ['ブラックバス'];

  // ---------- Result ----------
  var result: ScrapedLure = {
    name: rawName,
    name_kana: '',
    slug: slug,
    manufacturer: 'ENGINE',
    manufacturer_slug: 'engine',
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
