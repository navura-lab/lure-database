// scripts/scrapers/duo.ts
// DUO International product page scraper
// Handles lure products from www.duo-inc.co.jp/product/{id}
//
// Site: Nuxt.js SPA, client-side rendered. Requires JS execution (Playwright).
// Price is tax-included (税込).
// Each product page has a "series" (e.g. TETRA WORKS TOTOSLIM) with
// multiple "variations" (e.g. 50S, LIPLESS 50S). We scrape the
// currently selected variation.
//
// DOM structure (confirmed 2026-02-20):
//   h2: "SALT TETRA WORKS TOTOSLIMテトラワークス トトスリム"  (category + series + kana)
//   h3.en: "TETRA WORKS TOTOSLIM 50S"  (variation name — used as product name)
//   a.c-grid-card: color cards (p = "CZA0886 セグロクリア", img = S3 product image)
//   Specs: "Length\n50mm\nWeight\n2.4ｇ\nType\n..." in body text

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DUO_BASE_URL = 'https://www.duo-inc.co.jp';

// ---------------------------------------------------------------------------
// Type detection: map DUO's Type spec field + product name → DB lure type
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ポッパー|popper/i, 'ポッパー'],
  [/ペンシルベイト|pencil ?bait/i, 'ペンシルベイト'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ミノー|minnow/i, 'ミノー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/クランク|crank/i, 'クランクベイト'],
  [/シャッド|shad/i, 'シャッド'],
  [/メタルジグ|metal ?jig/i, 'メタルジグ'],
  [/スピナーベイト|spinner ?bait/i, 'スピナーベイト'],
  [/スイムベイト|swim ?bait/i, 'スイムベイト'],
  [/ジョイント|joint/i, 'ジョイントベイト'],
  [/ビッグベイト|big ?bait/i, 'ビッグベイト'],
  [/トップウォーター|topwater/i, 'トップウォーター'],
  [/スプーン|spoon/i, 'スプーン'],
  [/ブレード|blade|spin ?tail/i, 'ブレードベイト'],
  [/ワーム|worm|soft/i, 'ワーム'],
  [/ジグヘッド|jig ?head/i, 'ジグヘッド'],
  [/シンキング/i, 'ミノー'], // fallback: "シンキング" alone often means sinking minnow
  [/フローティング/i, 'ミノー'], // fallback: "フローティング" alone often means floating minnow
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [duo] ${message}`);
}

/**
 * Normalize fullwidth characters to halfwidth.
 */
function normalizeFullWidth(text: string): string {
  return text
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[ａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/＃/g, '#')
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/～/g, '~')
    .replace(/〜/g, '~')
    .replace(/ｇ/g, 'g')
    .replace(/㎜/g, 'mm');
}

/**
 * Parse DUO price text. Prices are tax-included.
 * "¥1,265税込" → 1265
 * "¥2,640(税込)" → 2640
 * "¥2,420(税込)" → 2420
 */
function parseDuoPrice(priceText: string): number {
  if (!priceText) return 0;
  const cleaned = normalizeFullWidth(priceText).replace(/,/g, '').replace(/\s/g, '');

  // Match ¥{number}
  const match = cleaned.match(/¥?([\d]+)/);
  if (match) {
    const price = parseInt(match[1], 10);
    if (price > 100 && price < 100000) {
      return price;
    }
  }
  return 0;
}

/**
 * Parse weight from spec value.
 * "2.4ｇ" → 2.4, "18g" → 18, "28" → 28
 */
function parseWeight(text: string): number {
  if (!text) return 0;
  const normalized = normalizeFullWidth(text).replace(/約/g, '').trim();

  // Handle range: "13~17g" → take first value
  const rangeMatch = normalized.match(/([\d.]+)\s*[~～\-]\s*([\d.]+)/);
  if (rangeMatch) {
    return parseFloat(rangeMatch[1]);
  }

  const match = normalized.match(/([\d.]+)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0 && num < 10000) {
      return Math.round(num * 10) / 10;
    }
  }
  return 0;
}

/**
 * Parse length from spec value (mm).
 * "50mm" → 50, "125mm" → 125, "90㎜" → 90
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/([\d.]+)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0 && num < 2000) {
      return num;
    }
  }
  return null;
}

/**
 * Generate slug from DUO product name.
 * "TETRA WORKS TOTOSLIM 50S" → "tetra-works-totoslim-50s"
 * "鬼鱒 正影 90F" → "onimasu-masakage-90f" (Japanese chars removed, fallback to productId)
 */
function generateSlug(name: string, productId: string): string {
  // Clean and convert to lowercase slug
  const slug = name
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '') // Remove parenthesized content
    .replace(/[^\w\s-]/g, '')          // Remove special chars (including Japanese)
    .replace(/\s+/g, '-')             // Spaces to hyphens
    .replace(/-+/g, '-')              // Collapse multiple hyphens
    .replace(/^-|-$/g, '')            // Trim hyphens
    .trim();

  // If slug is too short (e.g. all Japanese chars removed), use productId
  if (!slug || slug.length < 5) {
    return `duo-${productId}`;
  }

  return slug;
}

/**
 * Detect lure type from product name, spec type field, and tags.
 */
function detectType(name: string, specType: string, tags: string): string {
  const combined = `${name} ${specType} ${tags}`;

  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) {
      return typeName;
    }
  }

  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Target fish derivation: type-based fallback
// ---------------------------------------------------------------------------

const TYPE_FISH_MAP: Record<string, string[]> = {
  'エギ': ['イカ'], 'スッテ': ['イカ'], 'タイラバ': ['マダイ'],
  'テンヤ': ['マダイ'], 'ひとつテンヤ': ['マダイ'],
  'シーバスルアー': ['シーバス'], 'アジング': ['アジ'],
  'メバリング': ['メバル'], 'チニング': ['クロダイ'],
  'ロックフィッシュ': ['ロックフィッシュ'], 'タチウオルアー': ['タチウオ'],
  'タチウオジギング': ['タチウオ'], 'ショアジギング': ['青物'],
  'ジギング': ['青物'], 'オフショアキャスティング': ['青物'],
  'サーフルアー': ['ヒラメ・マゴチ'], 'ティップラン': ['イカ'],
  'イカメタル': ['イカ'], 'バチコン': ['アジ'],
  'フロート': ['アジ', 'メバル'], 'フグルアー': ['フグ'],
  'ナマズルアー': ['ナマズ'], 'トラウトルアー': ['トラウト'],
  '鮎ルアー': ['鮎'], 'ラバージグ': ['バス'],
  'バズベイト': ['バス'], 'i字系': ['バス'], 'フロッグ': ['バス'],
};

/**
 * Derive target fish species from lure type (type-based fallback).
 * DUO URLs don't encode category.
 */
function deriveTargetFish(type: string): string[] {
  return TYPE_FISH_MAP[type] || [];
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeDuoPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Nuxt SPA needs time to hydrate and render dynamic content
    await page.waitForTimeout(5000);
    log('Page loaded');

    // --- Extract product ID from URL ---
    const productId = url.match(/\/product\/(\d+)/)?.[1] || '';
    log(`Product ID: ${productId}`);

    // --- Page title (for fallback) ---
    const pageTitle = await page.title().catch(() => '');
    log(`Page title: ${pageTitle}`);

    // --- Extract all data from DOM ---
    const extracted = await page.evaluate(() => {
      const body = document.body.innerText;

      // -----------------------------------------------------------------
      // Series name & kana from h2
      // Pattern: "SALT TETRA WORKS TOTOSLIMテトラワークス トトスリム"
      //   or:    "TROUT 鬼鱒 正影オニマス マサカゲ"
      // -----------------------------------------------------------------
      const h2s = document.querySelectorAll('h2');
      let seriesName = '';
      let nameKana = '';
      let category = '';

      for (const h2 of h2s) {
        const text = h2.textContent?.trim() || '';
        // Look for h2 with category prefix (SALT, BASS, TROUT)
        const catMatch = text.match(/^(SALT|BASS|TROUT|怪魚|鮎)\s+(.+)/);
        if (catMatch) {
          category = catMatch[1];
          const remainder = catMatch[2];

          // Split: English/mixed name + trailing katakana reading
          // "TETRA WORKS TOTOSLIMテトラワークス トトスリム" → series + kana
          // "鬼鱒 正影オニマス マサカゲ" → series + kana
          // "ROUGH TRAIL 青政LIGHTNING 190Fラフトレイル アオマサライトニング190F" → series + kana
          // The kana part starts at the first katakana char that begins a "reading" section
          // We look for a katakana char preceded by a non-katakana, non-space char
          const kanaMatch = remainder.match(/^(.+?)([ァ-ヶー][ァ-ヶー\s\w]*)$/);
          if (kanaMatch) {
            seriesName = kanaMatch[1].trim();
            nameKana = kanaMatch[2].trim();
          } else {
            seriesName = remainder.trim();
          }
          break;
        }
      }

      // -----------------------------------------------------------------
      // Variation name from h3.en
      // Pattern: "TETRA WORKS TOTOSLIM 50S" or "鬼鱒 正影 90F"
      // -----------------------------------------------------------------
      let variationName = '';
      const h3s = document.querySelectorAll('h3.en');
      for (const h3 of h3s) {
        const text = h3.textContent?.trim() || '';
        // Skip report/overview headings
        if (text && text.length > 3 && text.length < 80 &&
            !text.includes('レポート') && !text.includes('製品概要') &&
            !text.includes('製品説明')) {
          variationName = text;
          break;
        }
      }

      // -----------------------------------------------------------------
      // Price
      // "¥1,265税込" or "¥2,420(税込)"
      // -----------------------------------------------------------------
      const priceMatch = body.match(/¥[\d,]+[（(]?税込/);
      const priceText = priceMatch ? priceMatch[0] : '';

      // -----------------------------------------------------------------
      // Specs from text patterns
      // "Length\n50mm\nWeight\n2.4ｇ\nType\n..."
      // -----------------------------------------------------------------
      const specs: Record<string, string> = {};
      const specPattern = /(?:Length|Weight|Type|Hook|Ring|Range|Depth|Action)\n([^\n]+)/g;
      let specMatch;
      while ((specMatch = specPattern.exec(body)) !== null) {
        const label = specMatch[0].split('\n')[0];
        const value = specMatch[1]?.trim() || '';
        if (label && value) {
          specs[label] = value;
        }
      }

      // -----------------------------------------------------------------
      // Colors from a.c-grid-card elements
      // Each card: <a class="c-grid-card">
      //   <div class="c-grid-card__img"><img src="...product_color_variants..."></div>
      //   <p>CZA0886 セグロクリア</p>
      // </a>
      // -----------------------------------------------------------------
      const colors: { name: string; imageUrl: string }[] = [];
      const cards = document.querySelectorAll('a.c-grid-card');

      for (const card of cards) {
        const ps = card.querySelectorAll('p');
        // Color name is in the last <p> (sometimes there's a "NEW" badge <p> before it)
        const pText = ps.length > 0 ? ps[ps.length - 1].textContent?.trim() || '' : '';

        // Color code pattern: 1-4 uppercase letters + 3-5 digits + optional name
        // e.g. "CZA0886 セグロクリア", "S544 UV銀河", "ANA4539 桜鱒"
        if (/^[A-Z]{1,4}\d{3,5}/.test(pText)) {
          // Find the product image (skip icon badges like icon_tip_new_color.svg)
          const imgs = card.querySelectorAll('img');
          let imgUrl = '';
          for (const img of imgs) {
            const src = (img as HTMLImageElement).getAttribute('src') || '';
            if (src.includes('duo-assets') && !src.includes('icon_tip') && !src.includes('.svg')) {
              imgUrl = src;
              break;
            }
          }

          if (imgUrl) {
            colors.push({ name: pText, imageUrl: imgUrl });
          }
        }
      }

      // -----------------------------------------------------------------
      // Description from 製品説明 section
      // -----------------------------------------------------------------
      let description = '';
      const descMatch = body.match(/製品説明\s*\n([\s\S]{10,800}?)(?=\n(?:カラーラインナップ|MOVIE|STAFF REPORT|関連ムービー|RECOMMEND|$))/);
      if (descMatch) {
        description = descMatch[1].trim().replace(/\n{3,}/g, '\n\n').substring(0, 500);
      }

      // -----------------------------------------------------------------
      // Main product image from product_variants/main_images
      // (this is the hero image, not a color variant)
      // -----------------------------------------------------------------
      let mainImage = '';
      const heroImgs = document.querySelectorAll('img');
      for (const img of heroImgs) {
        const src = (img as HTMLImageElement).getAttribute('src') || '';
        if (src.includes('product_variants/main_images') || src.includes('product_images')) {
          mainImage = src;
          break;
        }
      }

      return {
        seriesName,
        nameKana,
        variationName,
        category,
        priceText,
        specs,
        colors,
        description,
        mainImage,
      };
    });

    log(`Series: ${extracted.seriesName}`);
    log(`Variation: ${extracted.variationName}`);
    log(`Category: ${extracted.category}`);
    log(`Price: ${extracted.priceText}`);
    log(`Specs: ${JSON.stringify(extracted.specs)}`);
    log(`Colors: ${extracted.colors.length}`);

    // --- Determine the product name ---
    // Use variation name if available (more specific), otherwise series name
    const name = extracted.variationName || extracted.seriesName || pageTitle.split(' - ')[0].trim();

    if (!name) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // --- Parse specs ---
    const price = parseDuoPrice(extracted.priceText);
    const weightText = extracted.specs['Weight'] || '';
    const weight = parseWeight(weightText);
    const weights: number[] = weight > 0 ? [weight] : [];
    const lengthText = extracted.specs['Length'] || '';
    const length = parseLength(lengthText);
    const specType = extracted.specs['Type'] || '';

    log(`Parsed: price=${price}, weights=[${weights}], length=${length}, type="${specType}"`);

    // --- Colors ---
    const colors: ScrapedColor[] = extracted.colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl.startsWith('http') ? c.imageUrl : `${DUO_BASE_URL}${c.imageUrl}`,
    }));

    // --- Detect type ---
    const type = detectType(name, specType, extracted.category);
    log(`Detected type: ${type}`);

    // --- Target fish ---
    const target_fish = deriveTargetFish(type);
    log(`Target fish: [${target_fish.join(', ')}]`);

    // --- Generate slug ---
    const slug = generateSlug(name, productId);
    log(`Slug: ${slug}`);

    // --- Main image ---
    let mainImage = extracted.mainImage;
    if (mainImage && !mainImage.startsWith('http')) {
      mainImage = `${DUO_BASE_URL}${mainImage}`;
    }
    if (!mainImage && colors.length > 0) {
      mainImage = colors[0].imageUrl;
    }

    // --- Name kana ---
    const name_kana = extracted.nameKana || name;

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'DUO',
      manufacturer_slug: 'duo',
      type,
      target_fish,
      description: extracted.description,
      price,
      colors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(`Scrape complete: ${name} (${colors.length} colors, ${weights.length} weights, price: ${price})`);
    return result;

  } finally {
    if (browser) {
      await browser.close();
      log('Browser closed');
    }
  }
}
