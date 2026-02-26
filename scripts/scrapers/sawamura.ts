// scripts/scrapers/sawamura.ts
// Sawamura (サワムラ) product page scraper
// Handles lure products from karil.co.jp/?p={ID}
//
// Site: WordPress 6.x + Welcart e-commerce plugin (usc-e-shop).
// WP REST API is disabled. No sitemap. Product URLs via category pages.
// URL pattern: /?p={post_id}
// Title: h1.item-name — Japanese only, format "サワムラ {name}{size}" {variant}"
// Colors: hidden inputs name="skuPrice[{id}][{encoded_sku}]" contain "#NNN　ColorName"
//         Carousel images .carousel-inner img correspond 1:1 with colors.
// Price: div.field-price → "¥{integer}"
// Size: embedded in product name (e.g., "5"", "3/8OZ")
// All products are bass lures — target fish = ブラックバス.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Type detection from product name / category
// ---------------------------------------------------------------------------

var NAME_TYPE_MAP: [RegExp, string][] = [
  [/バイブレード|vibra/i, 'ルアー'],
  [/バズ|buzz/i, 'バズベイト'],
  [/スピン|spin/i, 'スピナーベイト'],
  // Everything else is ワーム (shad, curly, bullet, etc.)
];

function detectType(name: string): string {
  for (var i = 0; i < NAME_TYPE_MAP.length; i++) {
    if (NAME_TYPE_MAP[i][0].test(name)) return NAME_TYPE_MAP[i][1];
  }
  return 'ワーム';
}

// ---------------------------------------------------------------------------
// Slug generation from product name
// ---------------------------------------------------------------------------

function generateSlug(name: string): string {
  // Product name format: "サワムラ ワンナップシャッド5" （モノトーン）"
  // or "サワムラ ECO ワンナップシャッド3""
  // Remove "サワムラ" prefix and "ECO" prefix
  var cleaned = name
    .replace(/^サワムラ\s*/u, '')
    .replace(/^ECO\s*/i, '')
    // Normalize all fancy quotes to standard double quote
    .replace(/[\u201C\u201D\u2033\uFF02]/g, '"')
    // Normalize full-width spaces to regular spaces
    .replace(/\u3000/g, ' ')
    .trim();

  // Japanese to English mapping for known product lines
  var SLUG_MAP: [RegExp, string][] = [
    [/ワンナップシャッド\s*(\d[\d.]*)[""]\s*(?:Real\s*)?(?:[（(]([^）)]+)[）)])?/i, function(_: string, size: string, variant: string) {
      var s = 'one-up-shad-' + size;
      if (variant) {
        s += '-' + variant.toLowerCase()
          .replace(/モノトーン/g, 'monotone')
          .replace(/[２2]トーン/g, '2tone')
          .replace(/スーパーナチュラル/g, 'super-natural');
      }
      return s;
    } as any],
    [/ワンナップカーリー\s*(\d[\d.]*)[""]/i, 'one-up-curly-$1'],
    [/ワンナップリング/i, 'one-up-ring'],
    [/ワンナップモス/i, 'one-up-moss'],
    [/ワンナップスピン/i, 'one-up-spin'],
    [/ワンナップバズ/i, 'one-up-buzz'],
    [/ワンナップバイブレード/i, 'one-up-vibrade'],
    [/バレット\s*(\d[\d.]*)[""]\s*(.*)/i, function(_: string, size: string, variant: string) {
      var s = 'bullet-' + size;
      if (variant && variant.trim()) {
        s += '-' + variant.trim().toLowerCase()
          .replace(/スローシンキング/g, 'slow-sinking')
          .replace(/フローティング/g, 'floating');
      }
      return s;
    } as any],
    [/スイミーバレット\s*(\d[\d.]*)[""]/i, 'swimmy-bullet-$1'],
    [/グロッキー/i, 'glocky'],
    [/フレックスチャンク/i, 'flex-chunk'],
  ];

  for (var i = 0; i < SLUG_MAP.length; i++) {
    var pattern = SLUG_MAP[i][0];
    var replacement = SLUG_MAP[i][1];
    if (pattern.test(cleaned)) {
      if (typeof replacement === 'function') {
        return cleaned.replace(pattern, replacement as any)
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      }
      return cleaned.replace(pattern, replacement as string)
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }
  }

  // Fallback: transliterate from item-code (SKU)
  return cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'sawamura-product';
}

// ---------------------------------------------------------------------------
// Logging helper
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [sawamura] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeSawamuraPage(url: string): Promise<ScrapedLure> {
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
      // Title from h1.item-name
      var h1 = document.querySelector('h1.item-name');
      var title = h1 ? (h1.textContent || '').trim() : '';

      // SKU code from div.item-code
      var codeEl = document.querySelector('div.item-code');
      var skuCode = codeEl ? (codeEl.textContent || '').trim() : '';

      // Description from accordion body
      var descEl = document.querySelector('.accordion-body');
      var description = descEl ? (descEl.textContent || '').trim().substring(0, 500) : '';

      // Main product image: first carousel image or first product image
      var mainImage = '';
      var heroImg = document.querySelector('.carousel-inner img');
      if (heroImg) {
        mainImage = heroImg.getAttribute('src') || '';
      }
      if (!mainImage) {
        var anyImg = document.querySelector('article img[src*="wp-content/uploads"]');
        if (anyImg) mainImage = anyImg.getAttribute('src') || '';
      }
      if (mainImage && !mainImage.startsWith('http')) {
        mainImage = 'https://karil.co.jp' + mainImage;
      }

      // Colors: extract from hidden inputs (skuPrice) and carousel images
      var colors: Array<{ name: string; imageUrl: string }> = [];
      var colorSeen = new Set();

      // Get all hidden inputs with SKU data
      var skuInputs = document.querySelectorAll('input[name^="skuPrice"]');
      var colorCodes: string[] = [];
      var priceValue = 0;

      for (var si = 0; si < skuInputs.length; si++) {
        var inputName = skuInputs[si].getAttribute('name') || '';
        var inputValue = skuInputs[si].getAttribute('value') || '';

        // Parse name: skuPrice[{postId}][{encoded_sku_key}]
        var skuMatch = inputName.match(/\[(\d+)\]\[(.+)\]$/);
        if (skuMatch) {
          var skuKey = '';
          try {
            skuKey = decodeURIComponent(skuMatch[2]);
          } catch (e) {
            skuKey = skuMatch[2];
          }
          // skuKey format: "#011　ウォーターメロンペッパー" or just color name
          colorCodes.push(skuKey);

          // Price from first input value
          if (!priceValue && inputValue) {
            var pv = parseInt(inputValue, 10);
            if (pv > 0) priceValue = pv;
          }
        }
      }

      // Fallback price from div.field-price
      if (!priceValue) {
        var priceEl = document.querySelector('div.field-price');
        if (priceEl) {
          var priceText = (priceEl.textContent || '').replace(/[¥,\s]/g, '');
          var parsedPrice = parseInt(priceText, 10);
          if (parsedPrice > 0) priceValue = parsedPrice;
        }
      }

      // Get carousel images (1:1 correspondence with colors)
      var carouselImgs = document.querySelectorAll('.carousel-inner img');
      var imgUrls: string[] = [];
      for (var ci = 0; ci < carouselImgs.length; ci++) {
        var src = carouselImgs[ci].getAttribute('src') || '';
        if (src && !src.startsWith('http')) {
          src = 'https://karil.co.jp' + src;
        }
        imgUrls.push(src);
      }

      // Build color array: match codes with images
      // First carousel image is often a hero shot (all colors + ruler)
      // If there are more images than colors, first image is hero
      var imgOffset = 0;
      if (imgUrls.length > colorCodes.length && colorCodes.length > 0) {
        imgOffset = imgUrls.length - colorCodes.length;
      }

      for (var cci = 0; cci < colorCodes.length; cci++) {
        var colorName = colorCodes[cci];
        // Clean up the color name: remove leading # if present
        // Format: "#011　ウォーターメロンペッパー" → "011：ウォーターメロンペッパー"
        var cleanMatch = colorName.match(/^#?(\d{3})\s*[　\s]+(.+)/);
        if (cleanMatch) {
          colorName = cleanMatch[1] + '：' + cleanMatch[2].trim();
        }

        var imgUrl = imgUrls[cci + imgOffset] || '';

        if (!colorSeen.has(colorName)) {
          colorSeen.add(colorName);
          colors.push({ name: colorName, imageUrl: imgUrl });
        }
      }

      // If no colors from hidden inputs, try sku-name divs
      if (colors.length === 0) {
        var skuNames = document.querySelectorAll('div.sku-name');
        for (var sni = 0; sni < skuNames.length; sni++) {
          var sn = (skuNames[sni].textContent || '').trim();
          if (sn && !colorSeen.has(sn)) {
            colorSeen.add(sn);
            var snImg = imgUrls[sni + imgOffset] || '';
            colors.push({ name: sn, imageUrl: snImg });
          }
        }
      }

      return {
        title: title,
        skuCode: skuCode,
        description: description,
        mainImage: mainImage,
        colors: colors,
        price: priceValue,
      };
    });

    // Parse product name — normalize fancy quotes and full-width spaces
    var fullName = (data.title || '')
      .replace(/[\u201C\u201D\u2033\uFF02]/g, '"')
      .replace(/\u3000/g, ' ');
    log('Product: ' + fullName);
    log('SKU: ' + data.skuCode);
    log('Main image: ' + data.mainImage);
    log('Colors: ' + data.colors.length);
    log('Price: ' + data.price);

    // Remove "サワムラ" prefix for display name
    var displayName = fullName.replace(/^サワムラ\s*/u, '').replace(/^ECO\s*/i, '').trim();

    // Generate slug
    var slug = generateSlug(fullName);
    // If slug generation failed, use SKU code
    if (!slug || slug === 'sawamura-product') {
      if (data.skuCode) {
        slug = data.skuCode.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      }
    }

    // Extract size from name for length
    var sizeMatch = fullName.match(/(\d+(?:\.\d+)?)[""]/);
    var lengthMm: number | null = null;
    if (sizeMatch) {
      // Convert inches to mm
      lengthMm = Math.round(parseFloat(sizeMatch[1]) * 25.4);
    }

    // Extract weight from name (for hard baits like "3/8OZ")
    var weights: number[] = [];
    var ozMatch = fullName.match(/(\d+\/\d+)\s*OZ/i);
    if (ozMatch) {
      var parts = ozMatch[1].split('/');
      var ozVal = parseInt(parts[0], 10) / parseInt(parts[1], 10);
      weights.push(Math.round(ozVal * 28.3495 * 10) / 10);
    }

    // Detect type
    var lureType = detectType(fullName);

    var result: ScrapedLure = {
      name: displayName,
      name_kana: '',
      slug: slug,
      manufacturer: 'Sawamura',
      manufacturer_slug: 'sawamura',
      type: lureType,
      target_fish: ['ブラックバス'],
      description: data.description,
      price: data.price,
      colors: data.colors,
      weights: weights,
      length: lengthMm,
      mainImage: data.mainImage,
      sourceUrl: url,
    };

    log('Done: ' + result.name + ' | type=' + result.type + ' | colors=' + result.colors.length + ' | price=' + result.price + ' | slug=' + result.slug);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
