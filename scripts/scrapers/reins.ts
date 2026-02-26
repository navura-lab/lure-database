// scripts/scrapers/reins.ts
// REINS (reinsfishing.com) product page scraper
// Uses WooCommerce Store API — no Playwright needed.
//
// Site: WordPress + WooCommerce + Flatsome theme (reinsfishing.com)
// API: /wp-json/wc/store/products?slug={slug}
// No authentication required.
//
// Product URL pattern: /product/{slug}/
// Colors: attributes[].taxonomy === 'pa_color' → terms[].name (e.g., "001 - Watermelon Seed")
// Images: images[].src, mapped to colors via filename matching (SKU-CODE-color-name.jpg)
// Price: prices.price in USD cents (minor_unit=2). Stored as 0 since DB uses JPY.
// Sizes: parsed from product name (e.g., "3″ Rockvibe Shad" → 76.2mm)
//
// Note: Japanese site (reinjp.com) is unreachable. Using US site (reinsfishing.com).

import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection (all REINS lures are soft baits)
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/swimbait|swim.*shad|rockvibe|shad/i, 'ワーム'],
  [/craw|creature|claw/i, 'ワーム'],
  [/frog/i, 'フロッグ'],
  [/tube/i, 'ワーム'],
  [/jig/i, 'ラバージグ'],
];

function detectType(name: string, categorySlugs: string[]): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  // Category-based fallback
  if (categorySlugs.indexOf('swimbaits') >= 0) return 'ワーム';
  if (categorySlugs.indexOf('craws-creatures') >= 0) return 'ワーム';
  if (categorySlugs.indexOf('worms') >= 0) return 'ワーム';
  if (categorySlugs.indexOf('soft-baits') >= 0) return 'ワーム';
  return 'ワーム';
}

// ---------------------------------------------------------------------------
// HTML entity decoder
// ---------------------------------------------------------------------------

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#8243;/g, '″')
    .replace(/&#8242;/g, '′')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8211;/g, '–')
    .replace(/&#8220;/g, '\u201C')
    .replace(/&#8221;/g, '\u201D')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

// ---------------------------------------------------------------------------
// Strip HTML tags
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);
}

// ---------------------------------------------------------------------------
// Image-to-color matching
// ---------------------------------------------------------------------------

function matchImageToColor(
  images: Array<{ name: string; src: string }>,
  colorSlug: string
): string {
  // Extract color name portion from slug: "001-watermelon-seed" → "watermelon-seed"
  var colorNamePart = colorSlug.replace(/^\d+-/, '');
  var colorCode = colorSlug.match(/^(\d+)/);
  var code = colorCode ? colorCode[1] : '';

  // Strategy 1: Exact slug match in image filename
  for (var i = 0; i < images.length; i++) {
    var imgName = (images[i].name || '').toLowerCase().replace(/\.jpg|\.png|\.webp/gi, '');
    if (imgName.indexOf(colorSlug) >= 0) {
      return images[i].src;
    }
  }

  // Strategy 2: Color name part match (handles mismatched codes like 0082 vs 008)
  if (colorNamePart.length >= 3) {
    for (var i = 0; i < images.length; i++) {
      var imgName = (images[i].name || '').toLowerCase().replace(/\.jpg|\.png|\.webp/gi, '');
      // Skip main image
      if (imgName.indexOf('main') >= 0) continue;
      if (imgName.indexOf(colorNamePart) >= 0) {
        return images[i].src;
      }
    }
  }

  // Strategy 3: Match by color code (e.g., "-001-" in filename)
  if (code) {
    for (var i = 0; i < images.length; i++) {
      var imgName = (images[i].name || '').toLowerCase();
      if (imgName.indexOf('-' + code + '-') >= 0) {
        return images[i].src;
      }
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log('[' + new Date().toISOString() + '] [reins] ' + msg);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeReinsPage(url: string): Promise<ScrapedLure> {
  log('Starting scrape: ' + url);

  // Extract slug from URL: https://www.reinsfishing.com/product/{slug}/
  var urlPath = url.replace(/\/$/, '');
  var slug = urlPath.split('/').pop() || '';
  if (!slug) {
    throw new Error('Could not extract slug from URL: ' + url);
  }

  log('Product slug: ' + slug);

  // Fetch from WC Store API by slug
  var apiUrl = 'https://www.reinsfishing.com/wp-json/wc/store/products?slug=' + encodeURIComponent(slug);
  log('Fetching API: ' + apiUrl);

  var maxRetries = 3;
  var response: Response | null = null;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      if (response.ok) break;
      log('API returned ' + response.status + ', retrying...');
    } catch (fetchErr: any) {
      if (attempt === maxRetries) throw fetchErr;
      log('Fetch failed: ' + fetchErr.message + ', retrying in 2s...');
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
    }
  }

  if (!response || !response.ok) {
    throw new Error('API request failed for slug: ' + slug);
  }

  var products: any[] = await response.json();
  if (!products || products.length === 0) {
    throw new Error('Product not found in API for slug: ' + slug);
  }

  var product = products[0];

  // ---------- Name ----------
  var rawName = decodeHtmlEntities(product.name || '');
  log('Product: ' + rawName);

  // ---------- Categories ----------
  var categorySlugs: string[] = [];
  if (product.categories) {
    for (var ci = 0; ci < product.categories.length; ci++) {
      categorySlugs.push(product.categories[ci].slug);
    }
  }

  // ---------- Price ----------
  // Price is in USD cents. We store 0 since DB uses JPY and Japanese site is unreachable.
  var price = 0;

  // ---------- Description ----------
  var description = stripHtml(
    decodeHtmlEntities(product.short_description || product.description || '')
  );

  // ---------- Main image ----------
  var images = product.images || [];
  var mainImage = '';
  if (images.length > 0) {
    mainImage = images[0].src || '';
  }

  // ---------- Colors ----------
  var colorTerms: Array<{ name: string; slug: string }> = [];
  if (product.attributes) {
    for (var ai = 0; ai < product.attributes.length; ai++) {
      if (product.attributes[ai].taxonomy === 'pa_color') {
        var terms = product.attributes[ai].terms || [];
        for (var ti = 0; ti < terms.length; ti++) {
          colorTerms.push({
            name: decodeHtmlEntities(terms[ti].name || ''),
            slug: terms[ti].slug || '',
          });
        }
        break;
      }
    }
  }

  var colors: ScrapedColor[] = [];
  for (var ci = 0; ci < colorTerms.length; ci++) {
    var imgUrl = matchImageToColor(images, colorTerms[ci].slug);
    colors.push({
      name: colorTerms[ci].name,
      imageUrl: imgUrl,
    });
  }

  log('Colors: ' + colors.length);

  // ---------- Type ----------
  var lureType = detectType(rawName, categorySlugs);

  // ---------- Target fish ----------
  // All REINS products from this site are bass lures
  var targetFish = ['ブラックバス'];

  // ---------- Size (length) from name ----------
  var lengthMm: number | null = null;
  // Match patterns like: 3″, 3.5″, 10", 2.5"
  var sizeMatch = rawName.match(/([\d.]+)\s*[″"''′\u2033\u2032]/);
  if (sizeMatch) {
    lengthMm = Math.round(parseFloat(sizeMatch[1]) * 25.4);
  }

  // ---------- Weights ----------
  // WC Store API doesn't provide weight data for REINS products
  var weights: number[] = [];

  // ---------- Generate clean slug ----------
  // The WooCommerce slug is already URL-safe, use as-is
  var cleanSlug = product.slug || slug;

  var result: ScrapedLure = {
    name: rawName,
    name_kana: '',
    slug: cleanSlug,
    manufacturer: 'REINS',
    manufacturer_slug: 'reins',
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
      ' | length=' + result.length + 'mm | slug=' + result.slug);

  return result;
}
