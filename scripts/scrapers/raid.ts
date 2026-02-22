// scripts/scrapers/raid.ts
// RAID JAPAN (レイドジャパン) product page scraper
// Handles lure products from raidjapan.com/?product={slug}
//
// Site: WordPress 4.9 + custom theme, server-side rendered HTML.
// Server: nginx (Sakura Rental Server), NO WAF, HTTP only (HTTPS returns 403).
// Encoding: UTF-8
// Price: tax-included in spec text "¥X,XXX（税抜）／¥X,XXX（税込）"
// All products are bass lures — target_fish is always ブラックバス.
// Colors: .products .box ul li > a.img-pop > p.name + p.img img
// Multi-size worms: multiple .box sections with different size titles.
// Weight: oz-based "X/Xoz. class" or "Xoz. class" → convert to grams.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RAID_BASE_URL = 'http://raidjapan.com';
const OZ_TO_GRAMS = 28.3495;

// ---------------------------------------------------------------------------
// Type detection from product name
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
  [/スピン|SPIN/i, 'スピナーベイト'],
  [/バズベイト|BUZZ\s*BAIT/i, 'バズベイト'],
  [/チャターベイト|CHATTER/i, 'チャターベイト'],
  [/ブレード|BLADE/i, 'ブレードベイト'],
  [/フロッグ|FROG|SCATTER/i, 'フロッグ'],
  [/クローラー|CRAWLER|DODGE|ダッジ/i, 'クローラーベイト'],
  [/スイムベイト|SWIM\s*BAIT|SWIMMER/i, 'スイムベイト'],
  [/ビッグベイト|BIG\s*BAIT/i, 'ビッグベイト'],
  [/ジグ|JIG|EGU[\s-]?DAMA/i, 'ラバージグ'],
  [/メタルジグ|METAL\s*JIG/i, 'メタルジグ'],
  [/ワイヤー|WIRE/i, 'ワイヤーベイト'],
  [/スプーン|SPOON/i, 'スプーン'],
];

// Worm / soft bait keywords
var SOFT_KEYWORDS = /FULLSWING|WHIP|SWEEPER|HOG|CRAW|STICK|STRAIGHT|ROLLER|TAILOR|EBI|BUG|EGU[\s-]?CHUNK|PELLER|ZARIGANIST|ADJUSTRAIGHT|FINSE|BUGGY|BUKKOMI|FANTASTICK|WAY$|2WAY|MICRO2WAY|CUTSWING|HEADSLIDE|1WAY|BATABATA/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [raid] ${msg}`);
}

function detectType(name: string): string {
  // Check soft bait first
  if (SOFT_KEYWORDS.test(name)) return 'ワーム';

  for (var [re, type] of TYPE_KEYWORDS) {
    if (re.test(name)) return type;
  }
  return 'ルアー';
}

/**
 * Parse "X/Xoz" fractional weight to grams.
 * e.g. "3/8oz" → 10.6g, "1oz" → 28.35g, "1/2oz" → 14.17g
 */
function parseOzToGrams(ozStr: string): number {
  ozStr = ozStr.replace(/\s/g, '').replace(/oz\.?/i, '');
  if (ozStr.includes('/')) {
    var parts = ozStr.split('/');
    var numerator = parseFloat(parts[0]);
    var denominator = parseFloat(parts[1]);
    if (denominator > 0) return Math.round(numerator / denominator * OZ_TO_GRAMS * 10) / 10;
  }
  var val = parseFloat(ozStr);
  if (!isNaN(val)) return Math.round(val * OZ_TO_GRAMS * 10) / 10;
  return 0;
}

/**
 * Remove color number prefix: "DG001. SHIMANASHI TIGER" → "SHIMANASHI TIGER"
 * Also handles: "001. GREENPUMPKIN SEED", "DG024. MTR back"
 */
function cleanColorName(raw: string): string {
  return raw.replace(/^[A-Z]*\d+\.\s*/i, '').trim();
}

/**
 * Remove WordPress thumbnail suffix from image URL.
 * e.g. "...image-180x180.jpg" → "...image.jpg"
 */
function getFullSizeImageUrl(thumbUrl: string): string {
  return thumbUrl.replace(/-\d+x\d+(\.\w+)$/, '$1');
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeRaidPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  var browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    // RAID JAPAN uses HTTP only (HTTPS returns 403)
    var httpUrl = url.replace(/^https:/, 'http:');
    log(`Navigating to ${httpUrl}`);
    await page.goto(httpUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Extract slug from URL: ?product=slug
    var urlObj = new URL(httpUrl);
    var slug = urlObj.searchParams.get('product') || '';
    log(`Slug: ${slug}`);

    // ---------- Product name ----------
    var name = await page.evaluate(function () {
      var el = document.querySelector('h1.title1');
      return el ? el.textContent?.trim() || '' : '';
    });
    if (!name) {
      name = await page.evaluate(function () {
        var t = document.title.replace(/\s*\|.*$/, '').trim();
        return t;
      });
    }
    log(`Name: ${name}`);

    // ---------- Main image ----------
    var mainImage = await page.evaluate(function () {
      var el = document.querySelector('.detail-box .mainimg img') as HTMLImageElement | null;
      return el ? el.src : '';
    });
    if (!mainImage) {
      mainImage = await page.evaluate(function () {
        var el = document.querySelector('.detail-box img') as HTMLImageElement | null;
        return el ? el.src : '';
      });
    }
    log(`Main image: ${mainImage}`);

    // ---------- Spec text & Description ----------
    var specAndDesc = await page.evaluate(function () {
      var container = document.getElementById('detail-ja');
      if (!container) return { specText: '', description: '' };

      var paragraphs = container.querySelectorAll('p');
      var specText = '';
      var descParts: string[] = [];
      var foundSpec = false;

      for (var i = 0; i < paragraphs.length; i++) {
        var p = paragraphs[i];
        var text = p.textContent?.trim() || '';

        // Skip "LURE SPEC" title
        if (p.classList.contains('title')) continue;

        // The first paragraph after the title is typically the spec line
        if (!foundSpec && (text.includes('Length:') || text.includes('Wt.') || text.includes('Price:') || text.includes('Quantity:'))) {
          specText = text;
          foundSpec = true;
          continue;
        }

        // Everything else is description (skip images and empty)
        if (text && !p.querySelector('img') && text.length > 10) {
          descParts.push(text);
        }
      }

      // Also check for spec text in raw text nodes (LEVEL SPIN format)
      if (!specText) {
        var rawText = container.textContent || '';
        var wtMatch = rawText.match(/(?:Head\s+)?Wt\.?[:：]\s*[^¥]+¥[\d,]+/);
        if (wtMatch) specText = wtMatch[0];
      }

      return {
        specText: specText,
        description: descParts.slice(0, 3).join('\n').substring(0, 500),
      };
    });

    var specText = specAndDesc.specText;
    var description = specAndDesc.description;
    log(`Spec text: ${specText.substring(0, 100)}...`);

    // ---------- Parse specs ----------
    // Length
    var lengthMm: number | null = null;
    var lengthMatch = specText.match(/Length[:：]\s*([\d.]+)\s*mm/i);
    if (lengthMatch) lengthMm = parseFloat(lengthMatch[1]);

    // Weight (oz)
    var weights: number[] = [];
    var wtMatches = specText.match(/Wt\.?[:：]\s*([\d./]+)\s*oz/gi);
    if (wtMatches) {
      for (var wm of wtMatches) {
        var ozMatch = wm.match(/([\d./]+)\s*oz/i);
        if (ozMatch) {
          var g = parseOzToGrams(ozMatch[1]);
          if (g > 0 && !weights.includes(g)) weights.push(g);
        }
      }
    }
    // Also check for gram weights
    var gramMatches = specText.match(/([\d.]+)\s*g(?:\s|$)/gi);
    if (gramMatches) {
      for (var gm of gramMatches) {
        var gVal = parseFloat(gm);
        if (gVal > 0 && !weights.includes(gVal)) weights.push(gVal);
      }
    }

    // Price (tax-included)
    var price = 0;
    // Pattern: ¥X,XXX（税込）
    var taxInclMatch = specText.match(/¥([\d,]+)（税込）/);
    if (taxInclMatch) {
      price = parseInt(taxInclMatch[1].replace(/,/g, ''), 10);
    }
    if (!price) {
      // Fallback: ¥X,XXX（税抜）→ ×1.1
      var taxExclMatch = specText.match(/¥([\d,]+)（税抜）/);
      if (taxExclMatch) {
        price = Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);
      }
    }
    // Handle multi-size worms: take the first price found
    if (!price) {
      var anyPriceMatch = specText.match(/¥([\d,]+)/);
      if (anyPriceMatch) {
        price = parseInt(anyPriceMatch[1].replace(/,/g, ''), 10);
        // Assume tax-excluded if no label
        if (!specText.includes('税込')) price = Math.round(price * 1.1);
      }
    }

    log(`Length: ${lengthMm}mm, Weights: [${weights}], Price: ¥${price}`);

    // ---------- Colors ----------
    var colors: ScrapedColor[] = await page.evaluate(function () {
      var results: { name: string; imageUrl: string }[] = [];
      var seen = new Set<string>();

      // Find all color items across all .box sections
      var items = document.querySelectorAll('.products .box ul li');
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        var nameEl = li.querySelector('p.name');
        var linkEl = li.querySelector('a.img-pop') as HTMLAnchorElement | null;

        if (!nameEl) continue;
        var rawName = nameEl.textContent?.trim() || '';
        if (!rawName) continue;

        // Skip "back" images (e.g. "DG024. MTR back")
        if (/\bback\b/i.test(rawName)) continue;
        // Skip "発光時" (glowing version)
        if (/発光時/.test(rawName)) continue;

        var imageUrl = linkEl ? linkEl.href : '';

        // Deduplicate by name
        if (seen.has(rawName)) continue;
        seen.add(rawName);

        results.push({ name: rawName, imageUrl: imageUrl });
      }
      return results;
    });

    // Clean color names and image URLs
    colors = colors.map(function (c) {
      return {
        name: cleanColorName(c.name),
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
    var type = detectType(name);
    log(`Type: ${type}`);

    var result: ScrapedLure = {
      name: name,
      name_kana: '',
      slug: slug,
      manufacturer: 'RAID JAPAN',
      manufacturer_slug: 'raid',
      type: type,
      target_fish: ['ブラックバス'],
      description: description,
      price: price,
      colors: colors,
      weights: weights,
      length: lengthMm,
      mainImage: mainImage,
      sourceUrl: url,
    };

    log(`Done: ${name} | type=${type} | colors=${colors.length} | weights=[${weights}] | length=${lengthMm}mm | price=¥${price}`);
    return result;
  } finally {
    if (browser) await browser.close();
  }
}
