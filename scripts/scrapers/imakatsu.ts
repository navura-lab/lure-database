// scripts/scrapers/imakatsu.ts
// IMAKATSU (イマカツ) product page scraper
// Handles lure products from www.imakatsu.co.jp/{hard-lure,soft-lure,other-lure}/{slug}/
//
// Site: WordPress 5.3 + custom theme "imakatsu", server-side rendered HTML.
// Encoding: UTF-8
// Price: NOT available on product pages (separate webshop domain).
// All products are bass lures — target_fish is always ブラックバス.
// Colors: #color ul.chart li a  (title = color name, img.src = thumbnail, a.href = fullsize)
// Spec line: .speck  — inconsistent format, needs flexible parsing.
// Product name: <title> split on " | " or breadcrumb last li or h1 img alt (strip "ロゴ：")
// Japanese reading: .name_ruby
// Two domains: www.imakatsu.co.jp (WordPress) and www2.imakatsu.co.jp (legacy static HTML)
// "New Color" pages have NO product info, only color chart + link to legacy page — skip these.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var OZ_TO_GRAMS = 28.3495;

// ---------------------------------------------------------------------------
// Type detection from product name / URL
// ---------------------------------------------------------------------------

var TYPE_KEYWORDS: [RegExp, string][] = [
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/プロップ|PROP/i, 'プロップベイト'],
  [/バイブ|VIB/i, 'バイブレーション'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/スピナーベイト|SPINNER\s*BAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZ\s*BAIT/i, 'バズベイト'],
  [/チャターベイト|CHATTER/i, 'チャターベイト'],
  [/ブレード|BLADE/i, 'ブレードベイト'],
  [/フロッグ|FROG/i, 'フロッグ'],
  [/クローラー|CRAWLER/i, 'クローラーベイト'],
  [/スイムベイト|SWIM\s*BAIT|SWIMMER/i, 'スイムベイト'],
  [/ビッグベイト|BIG\s*BAIT/i, 'ビッグベイト'],
  [/ジグ|JIG/i, 'ラバージグ'],
  [/メタルジグ|METAL\s*JIG/i, 'メタルジグ'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ジョイント|JOINTED/i, 'ジョイントベイト'],
  [/トップウォーター|TOP\s*WATER/i, 'トップウォーター'],
  [/ウェイク|WAKE/i, 'ウェイクベイト'],
];

// Soft bait / worm keywords (product name or URL-based)
var SOFT_KEYWORDS = /JAVA|ジャバ|SHAD|CRAWDAD|WORM|ワーム|TUBE|チューブ|STICK|GRUB|HOGBACK|MAMUSHI|MOGULLA.*JIG|STEALTH|SWIMMER|FINESSE|TAIL|BIG\s*DADDY|FUGU|INKO|HAM|TOAD|3D.*REAL/i;

// URL-based: /soft-lure/ always means worm
var SOFT_URL_PATTERN = /\/soft-lure\//;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [imakatsu] ${msg}`);
}

function detectType(name: string, url: string): string {
  // URL category takes priority for soft lures
  if (SOFT_URL_PATTERN.test(url)) return 'ワーム';

  // Check soft bait keywords
  if (SOFT_KEYWORDS.test(name)) return 'ワーム';

  for (var [re, type] of TYPE_KEYWORDS) {
    if (re.test(name)) return type;
  }

  // Default based on URL category
  if (url.includes('/other-lure/')) return 'ルアー';
  return 'ルアー';
}

/**
 * Parse weight strings in various formats to grams.
 * Supports: "1.6oz", "3/8oz", "14g", "14.5g"
 */
function parseWeight(raw: string): number {
  raw = raw.trim();

  // Grams
  var gMatch = raw.match(/([\d.]+)\s*g/i);
  if (gMatch) return Math.round(parseFloat(gMatch[1]) * 10) / 10;

  // Ounces (fractional)
  var ozMatch = raw.match(/([\d./]+)\s*oz/i);
  if (ozMatch) {
    var ozStr = ozMatch[1];
    if (ozStr.includes('/')) {
      var parts = ozStr.split('/');
      var num = parseFloat(parts[0]);
      var den = parseFloat(parts[1]);
      if (den > 0) return Math.round(num / den * OZ_TO_GRAMS * 10) / 10;
    }
    var val = parseFloat(ozStr);
    if (!isNaN(val)) return Math.round(val * OZ_TO_GRAMS * 10) / 10;
  }

  return 0;
}

/**
 * Extract slug from URL path.
 * e.g. "/hard-lure/gillroid-jr-dive/" → "gillroid-jr-dive"
 */
function extractSlug(url: string): string {
  try {
    var u = new URL(url);
    var parts = u.pathname.split('/').filter(Boolean);
    // Last segment is the product slug, first is category
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

/**
 * Remove WordPress thumbnail suffix from image URL.
 * e.g. "...image-350x188.jpg" → "...image.jpg"
 */
function getFullSizeImageUrl(thumbUrl: string): string {
  return thumbUrl.replace(/-\d+x\d+(\.\w+)$/, '$1');
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeImakatsuPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    // Retry navigation with backoff — imakatsu server is slow under load
    var maxRetries = 3;
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log(`Navigating to ${url} (attempt ${attempt}/${maxRetries})`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      } catch (navErr: any) {
        if (attempt === maxRetries) throw navErr;
        var backoff = attempt * 5000;
        log(`Navigation failed (attempt ${attempt}): ${navErr.message?.substring(0, 80)} — retrying in ${backoff}ms`);
        await new Promise(function (r) { setTimeout(r, backoff); });
      }
    }

    var slug = extractSlug(url);
    log(`Slug: ${slug}`);

    // ---------- Check if this is a "New Color" only page ----------
    // New Color pages have no #product h1 or .speck, only #color + link to www2
    var isNewColorOnly = await page.evaluate(function () {
      var hasProduct = document.querySelector('#product h1');
      var hasSpeck = document.querySelector('.speck');
      var hasMainImg = document.querySelector('.main_img img');
      var hasColor = document.querySelector('#color');
      var hasLegacyLink = document.querySelector('a[href*="www2.imakatsu.co.jp"]');
      return !hasProduct && !hasSpeck && !hasMainImg && !!hasColor && !!hasLegacyLink;
    });

    if (isNewColorOnly) {
      log(`New Color only page detected — extracting colors from this page + fetching legacy page for product info`);
    }

    // ---------- Product name ----------
    var name = await page.evaluate(function () {
      // Method 1: <title> split on " | "
      var title = document.title;
      if (title && title.includes(' | ')) {
        return title.split(' | ')[0].trim();
      }
      // Method 2: breadcrumb last item
      var breadcrumb = document.querySelector('.breadcrumb ol li:last-child');
      if (breadcrumb) {
        var text = breadcrumb.textContent?.trim() || '';
        if (text) return text;
      }
      // Method 3: h1 img alt (strip "ロゴ：" prefix)
      var h1img = document.querySelector('#product h1 img') as HTMLImageElement | null;
      if (h1img && h1img.alt) {
        return h1img.alt.replace(/^ロゴ[：:]/, '').trim();
      }
      return title.trim();
    });
    log(`Name: ${name}`);

    // ---------- Japanese reading (katakana) ----------
    var nameKana = await page.evaluate(function () {
      var el = document.querySelector('.name_ruby');
      return el ? el.textContent?.trim() || '' : '';
    });
    log(`Name kana: ${nameKana}`);

    // ---------- Main image ----------
    var mainImage = await page.evaluate(function () {
      var el = document.querySelector('.main_img img') as HTMLImageElement | null;
      return el ? el.src : '';
    });
    if (!mainImage) {
      // Fallback: first product image
      mainImage = await page.evaluate(function () {
        var el = document.querySelector('#product img') as HTMLImageElement | null;
        return el ? el.src : '';
      });
    }
    log(`Main image: ${mainImage}`);

    // ---------- Spec text & Description ----------
    var specAndDesc = await page.evaluate(function () {
      var speckEl = document.querySelector('.speck');
      var specText = speckEl ? speckEl.textContent?.trim() || '' : '';

      // Description: .lead_block .lead or h2.tit_main
      var descParts: string[] = [];
      var titleMain = document.querySelector('h2.tit_main');
      if (titleMain) {
        var t = titleMain.textContent?.trim() || '';
        if (t) descParts.push(t);
      }
      var lead = document.querySelector('.lead_block .lead');
      if (lead) {
        var l = lead.textContent?.trim() || '';
        if (l) descParts.push(l);
      }
      // Also check .explain_block paragraphs
      var explains = document.querySelectorAll('.explain_block p');
      for (var i = 0; i < explains.length && descParts.length < 3; i++) {
        var eText = explains[i].textContent?.trim() || '';
        if (eText && eText.length > 20) descParts.push(eText);
      }

      return {
        specText: specText,
        description: descParts.join('\n').substring(0, 1000),
      };
    });

    var specText = specAndDesc.specText;
    var description = specAndDesc.description;
    log(`Spec text: ${specText.substring(0, 120)}`);

    // ---------- Parse specs ----------
    // Length: "Length 145mm" or "Length :70mm" or "Length: 70mm"
    var lengthMm: number | null = null;
    var lengthMatch = specText.match(/Length\s*[:：]?\s*([\d.]+)\s*mm/i);
    if (lengthMatch) lengthMm = parseFloat(lengthMatch[1]);

    // Weight: "1.6oz class" or "3/8oz" or "14g" or multiple weights
    var weights: number[] = [];

    // Oz weights (e.g. "1/4oz   3/8oz    1/2oz    3/4oz")
    var ozMatches = specText.match(/[\d./]+\s*oz/gi);
    if (ozMatches) {
      for (var om of ozMatches) {
        var w = parseWeight(om);
        if (w > 0 && !weights.includes(w)) weights.push(w);
      }
    }

    // Gram weights (e.g. "5.6g" or "Weight : 5.6g")
    var gramMatches = specText.match(/([\d.]+)\s*g(?:\s|$|,)/gi);
    if (gramMatches) {
      for (var gm of gramMatches) {
        var w2 = parseWeight(gm);
        if (w2 > 0 && !weights.includes(w2)) weights.push(w2);
      }
    }

    // "X.Xoz class" pattern
    var ozClassMatch = specText.match(/([\d.]+)\s*oz\s*class/i);
    if (ozClassMatch && weights.length === 0) {
      var w3 = parseWeight(ozClassMatch[1] + 'oz');
      if (w3 > 0) weights.push(w3);
    }

    weights.sort(function (a, b) { return a - b; });

    log(`Length: ${lengthMm}mm, Weights: [${weights}]`);

    // ---------- Colors ----------
    var colors: ScrapedColor[] = await page.evaluate(function () {
      var results: { name: string; imageUrl: string }[] = [];
      var seen = new Set<string>();

      // Primary selector: #color ul.chart li a
      var items = document.querySelectorAll('#color ul.chart li a');
      for (var i = 0; i < items.length; i++) {
        var a = items[i] as HTMLAnchorElement;
        var colorName = a.getAttribute('title') || '';
        if (!colorName) {
          // Fallback: text content
          colorName = a.textContent?.trim() || '';
        }
        if (!colorName) continue;

        // Image: thumbnail or full-size link
        var img = a.querySelector('img') as HTMLImageElement | null;
        var imageUrl = a.href || (img ? img.src : '');

        // Deduplicate
        if (seen.has(colorName)) continue;
        seen.add(colorName);

        results.push({ name: colorName, imageUrl: imageUrl });
      }

      // Fallback: if no ul.chart, try #color li a pattern
      if (results.length === 0) {
        var fallbackItems = document.querySelectorAll('#color li a');
        for (var j = 0; j < fallbackItems.length; j++) {
          var a2 = fallbackItems[j] as HTMLAnchorElement;
          var cn = a2.getAttribute('title') || a2.textContent?.trim() || '';
          if (!cn || seen.has(cn)) continue;
          seen.add(cn);
          var img2 = a2.querySelector('img') as HTMLImageElement | null;
          results.push({ name: cn, imageUrl: a2.href || (img2 ? img2.src : '') });
        }
      }

      return results;
    });

    // Clean up color names and image URLs
    colors = colors.map(function (c) {
      // Remove color number prefix: "#548 3Dメスギル" → "3Dメスギル"
      // But keep the number as part of the name for uniqueness
      var cleanName = c.name.replace(/^#/, '').trim();
      return {
        name: cleanName,
        imageUrl: c.imageUrl ? getFullSizeImageUrl(c.imageUrl) : '',
      };
    });

    // Deduplicate after cleaning
    var seenClean = new Set<string>();
    colors = colors.filter(function (c) {
      if (seenClean.has(c.name)) return false;
      seenClean.add(c.name);
      return true;
    });

    log(`Colors: ${colors.length}`);

    // ---------- Type detection ----------
    var type = detectType(name, url);
    log(`Type: ${type}`);

    var result: ScrapedLure = {
      name: name,
      name_kana: nameKana,
      slug: slug,
      manufacturer: 'IMAKATSU',
      manufacturer_slug: 'imakatsu',
      type: type,
      target_fish: ['ブラックバス'],
      description: description,
      price: 0,  // No prices on product pages
      colors: colors,
      weights: weights,
      length: lengthMm,
      mainImage: mainImage,
      sourceUrl: url,
    };

    log(`Done: ${name} | type=${type} | colors=${colors.length} | weights=[${weights}] | length=${lengthMm}mm`);
    return result;
  } finally {
    if (browser) await browser.close();
  }
}
