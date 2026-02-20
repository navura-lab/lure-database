// scripts/scrapers/ima.ts
// ima (アイマ) product page scraper
// Handles lure products from www.ima-ams.co.jp/product/products/detail/{id}
//
// Site: EC-CUBE based, server-side rendered HTML, no WAF.
// Price is tax-included (税込) — no ×1.1 conversion needed.

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMA_BASE_URL = 'https://www.ima-ams.co.jp';

// ---------------------------------------------------------------------------
// Type detection: map ima's [タイプ] spec + product name keywords → DB lure type
// ---------------------------------------------------------------------------

// ima's [タイプ] field contains values like フローティング, シンキング, トップウォーター etc.
// Some are lure types, others are buoyancy attributes. We use a combination of
// the [タイプ] field and product name keywords to detect the canonical lure type.

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ポッパー|popkey|popper/i, 'ポッパー'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ミノー|minnow|komomo|sasuke|iBORN|kosuke|hatsune|nabarone/i, 'ミノー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/クランク|crank/i, 'クランクベイト'],
  [/シャッド|shad/i, 'シャッド'],
  [/メタルジグ|metal ?jig|gun吉|jig/i, 'メタルジグ'],
  [/スピナーベイト|spinner ?bait/i, 'スピナーベイト'],
  [/スイムベイト|swim ?bait/i, 'スイムベイト'],
  [/ジョイント|joint/i, 'ジョイントベイト'],
  [/ビッグベイト|big ?bait/i, 'ビッグベイト'],
  [/トップウォーター|topwater/i, 'トップウォーター'],
  [/スプーン|spoon/i, 'スプーン'],
  [/ブレード|blade|spin ?tail/i, 'ブレードベイト'],
  [/ジグヘッド|jig ?head/i, 'ジグヘッド'],
  [/ワーム|worm|soft/i, 'ワーム'],
  [/Rocket ?Bait|Lipper/i, 'ミノー'],
  [/honey ?trap|ハニートラップ/i, 'ミノー'],
  [/yoichi|ヨイチ/i, 'ミノー'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [ima] ${message}`);
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
    .replace(/〜/g, '~');
}

/**
 * Parse spec items from ima product pages.
 * Format: "[ラベル]値" stored in .spec__item elements.
 * Returns a map of label → value.
 *
 * Note: Some pages have a rendering quirk where innerText duplicates labels/values.
 * We use regex to reliably extract the FIRST [label]value pair from each item.
 */
function parseSpecItems(specTexts: string[]): Record<string, string> {
  const specs: Record<string, string> = {};

  for (const text of specTexts) {
    // Extract first [label]value pattern
    const match = text.match(/\[([^\]]+)\](.+?)(?:\[|$)/s);
    if (match) {
      const label = match[1].trim();
      const value = normalizeFullWidth(match[2].trim());
      if (label && value && !specs[label]) {
        specs[label] = value;
      }
    }
  }

  return specs;
}

/**
 * Parse ima price text. Prices are tax-included.
 * "2,640円" → 2640
 * "1,870円" → 1870
 */
function parseImaPrice(priceText: string): number {
  if (!priceText) return 0;
  const cleaned = normalizeFullWidth(priceText).replace(/,/g, '').replace(/\s/g, '');

  // Range: "1300～1400" → take minimum
  const rangeMatch = cleaned.match(/(\d+)[～~\-](\d+)/);
  if (rangeMatch) {
    return parseInt(rangeMatch[1], 10);
  }

  const singleMatch = cleaned.match(/(\d+)/);
  if (singleMatch) {
    const price = parseInt(singleMatch[1], 10);
    if (price > 100 && price < 100000) {
      return price;
    }
  }

  return 0;
}

/**
 * Parse weight from spec value.
 * "18g" → 18, "9g" → 9, "28" → 28
 */
function parseWeight(text: string): number {
  if (!text) return 0;
  const normalized = normalizeFullWidth(text).replace(/約/g, '').trim();
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
 * "125mm" → 125, "65mm" → 65
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
 * Generate slug from ima URL.
 * /product/products/detail/19 → "19"
 */
function generateSlug(url: string): string {
  const match = url.match(/\/detail\/(\d+)/);
  return match ? match[1] : '';
}

/**
 * Detect lure type from product name, spec type field, and description.
 */
function detectType(name: string, specType: string, description: string): string {
  const combined = `${name} ${specType} ${description}`;

  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) {
      return typeName;
    }
  }

  // If specType is a known lure type category
  if (/トップウォーター/.test(specType)) return 'トップウォーター';
  if (/フローティング|シンキング|サスペンド/.test(specType)) {
    // These are buoyancy, not lure type — fall through to default
  }

  return 'ルアー';
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeImaPage(url: string): Promise<ScrapedLure> {
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
    await page.waitForTimeout(2000);
    log('Page loaded');

    // --- Product name ---
    const name = await page.locator('.product__name').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Product name: ${name}`);

    if (!name) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // --- Title tag ---
    const titleTag = await page.title().catch(() => '');

    // --- Catchcopy ---
    const catchcopy = await page.locator('.product__catchcopy').first().innerText()
      .then(t => t.trim())
      .catch(() => '');

    // --- Description ---
    let description = '';
    try {
      const descText = await page.locator('.product__description').first().innerText()
        .then(t => t.trim().replace(/^[＋+\s]+/, ''))
        .catch(() => '');
      if (catchcopy && descText) {
        description = `${catchcopy}\n${descText}`.substring(0, 500);
      } else if (catchcopy) {
        description = catchcopy;
      } else if (descText) {
        description = descText.substring(0, 500);
      } else {
        description = titleTag;
      }
    } catch {
      description = catchcopy || titleTag;
    }
    log(`Description: ${description.substring(0, 80)}...`);

    // --- Price ---
    let price = 0;
    try {
      const priceText = await page.locator('.product__price').first().innerText()
        .then(t => t.trim())
        .catch(() => '');
      price = parseImaPrice(priceText);
      log(`Price text: "${priceText}" -> ${price} yen (tax incl.)`);
    } catch {
      log('No price found');
    }

    // --- Specs ---
    const specTexts = await page.evaluate(() => {
      const items: string[] = [];
      document.querySelectorAll('.spec__item').forEach(item => {
        const text = item.textContent?.trim() || '';
        if (text) items.push(text);
      });
      return items;
    });
    const specs = parseSpecItems(specTexts);
    log(`Specs: ${JSON.stringify(specs)}`);

    // --- Extract weight ---
    const weightText = specs['重量'] || '';
    const weights: number[] = [];
    const w = parseWeight(weightText);
    if (w > 0) weights.push(w);
    log(`Weights: [${weights.join(', ')}]`);

    // --- Extract length ---
    const lengthText = specs['全長'] || '';
    const length = parseLength(lengthText);
    log(`Length: ${length}`);

    // --- Extract type ---
    const specType = specs['タイプ'] || '';
    const type = detectType(name, specType, description);
    log(`Detected type: ${type} (spec タイプ: "${specType}")`);

    // --- Colors ---
    const colors: ScrapedColor[] = [];
    try {
      const rawColors = await page.evaluate(() => {
        const results: { name: string; imageUrl: string }[] = [];
        document.querySelectorAll('.variation__item').forEach(item => {
          const nameEl = item.querySelector('.variation__name');
          const img = item.querySelector('.variation__thumbnail img');
          const colorName = nameEl?.textContent?.trim() || '';
          const imgSrc = img?.getAttribute('src') || '';
          if (colorName) {
            results.push({ name: colorName, imageUrl: imgSrc });
          }
        });
        return results;
      });

      for (const c of rawColors) {
        const fullUrl = c.imageUrl
          ? (c.imageUrl.startsWith('http') ? c.imageUrl : `${IMA_BASE_URL}${c.imageUrl}`)
          : '';
        colors.push({ name: c.name, imageUrl: fullUrl });
      }
    } catch (e) {
      log(`Color extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`Found ${colors.length} colors`);

    // --- Main image ---
    let mainImage = '';
    try {
      mainImage = await page.evaluate(() => {
        // Primary: .product__image img
        const productImg = document.querySelector('.product__image img');
        if (productImg) {
          return (productImg as HTMLImageElement).getAttribute('src') || '';
        }
        // Fallback: any img with save_image in src
        const imgs = document.querySelectorAll('img[src*="save_image"]');
        if (imgs.length > 0) {
          return (imgs[0] as HTMLImageElement).getAttribute('src') || '';
        }
        return '';
      });
    } catch { /* ignore */ }

    if (mainImage && !mainImage.startsWith('http')) {
      mainImage = `${IMA_BASE_URL}${mainImage}`;
    }
    if (!mainImage && colors.length > 0 && colors[0].imageUrl) {
      mainImage = colors[0].imageUrl;
    }
    log(`Main image: ${mainImage}`);

    // --- Generate slug ---
    const slug = generateSlug(url);
    if (!slug) {
      throw new Error(`Could not generate slug from URL: ${url}`);
    }
    log(`Slug: ${slug}`);

    // --- Name kana ---
    // ima products use English names (komomo, sasuke, etc.)
    // Use the name as-is for kana field
    const name_kana = name;

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'ima',
      manufacturer_slug: 'ima',
      type,
      description,
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
