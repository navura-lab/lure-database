// scripts/scrapers/deps.ts
// deps (デプス) product page scraper
// Handles lure products from www.depsweb.co.jp/product/{slug}/
//
// Site: WordPress + WooCommerce, server-side rendered HTML, no WAF.
// Price format: "￥{tax-incl}(税抜￥{tax-excl})" — we use the tax-included price.
// Weight format: some products use oz (e.g. "6.2oz"), convert to grams.
// Image CDN: production.depsweb-cdn.com

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPS_BASE_URL = 'https://www.depsweb.co.jp';

// 1 oz = 28.3495g
const OZ_TO_GRAMS = 28.3495;

// ---------------------------------------------------------------------------
// Type detection: map deps category name → DB lure type
// ---------------------------------------------------------------------------

const CATEGORY_TYPE_MAP: Record<string, string> = {
  'BIG BAIT': 'ビッグベイト',
  'SURFACE BAIT': 'トップウォーター',
  'CRANK BAIT': 'クランクベイト',
  'MINNOW': 'ミノー',
  'PROP BAIT': 'プロップベイト',
  'VIBRATION': 'バイブレーション',
  'SPIN TAIL': 'スピンテールジグ',
  'FROG': 'フロッグ',
  'BIG GAME': 'ビッグベイト',
  'TROUT': 'トラウトルアー',
  'SPINNER BAIT': 'スピナーベイト',
  'BUZZ BAIT': 'バズベイト',
  'WIRE BAIT': 'ワイヤーベイト',
  'BLADE BAIT': 'ブレードベイト',
  'SPOON': 'スプーン',
  'SWIM BAIT': 'スイムベイト',
  'JIG': 'ラバージグ',
  'JIGHEAD/HOOK': 'ジグヘッド',
  'SOFT BAIT': 'ワーム',
  'SUPER BIG WORM SERIES': 'ワーム',
};

// Name-based type override keywords (checked before category)
const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ジグ|JIG/i, 'ラバージグ'],
  [/スイムベイト|SWIM ?BAIT/i, 'スイムベイト'],
  [/ビッグベイト|BIG ?BAIT/i, 'ビッグベイト'],
  [/バズベイト|BUZZ ?BAIT/i, 'バズベイト'],
  [/スピナーベイト|SPINNER ?BAIT/i, 'スピナーベイト'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/フロッグ|FROG/i, 'フロッグ'],
  [/バイブレーション|VIBRATION/i, 'バイブレーション'],
  [/スプーン|SPOON/i, 'スプーン'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [deps] ${message}`);
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
    .replace(/：/g, ':');  // fullwidth colon → halfwidth
}

/**
 * Parse deps price text. Prices are tax-included.
 * "￥22,000(税抜￥20,000)" → 22000
 * "¥9,900(税抜¥9,000)" → 9900
 * "￥6,600(税抜￥6,000)" → 6600
 */
function parseDepsPrice(text: string): number {
  if (!text) return 0;
  const cleaned = normalizeFullWidth(text).replace(/￥/g, '¥');

  // Extract first yen amount (tax-included)
  const match = cleaned.match(/[¥￥]([\d,]+)/);
  if (match) {
    const price = parseInt(match[1].replace(/,/g, ''), 10);
    if (price > 100 && price < 1000000) return price;
  }

  return 0;
}

/**
 * Parse weight from spec value.
 * deps uses both gram and oz formats:
 * "6.2oz" → 175.8 (converted to grams)
 * "24oz class(約680g)" → 680 (use gram value if available)
 * "42g" → 42
 * "1/2oz" → 14.2
 */
function parseWeight(text: string): number[] {
  if (!text) return [];
  const normalized = normalizeFullWidth(text).replace(/約/g, '').trim();
  const weights: number[] = [];

  // If explicit gram value in parentheses: "24oz class(約680g)" → 680
  const gramInParen = normalized.match(/(\d+(?:\.\d+)?)\s*g/);
  if (gramInParen) {
    const g = parseFloat(gramInParen[1]);
    if (g > 0 && g < 10000) {
      weights.push(Math.round(g * 10) / 10);
      return weights;
    }
  }

  // Fraction oz: "1/2oz", "3/8oz"
  const fracOzMatch = normalized.match(/(\d+)\/(\d+)\s*oz/i);
  if (fracOzMatch) {
    const frac = parseInt(fracOzMatch[1], 10) / parseInt(fracOzMatch[2], 10);
    const g = Math.round(frac * OZ_TO_GRAMS * 10) / 10;
    if (g > 0) weights.push(g);
    return weights;
  }

  // Decimal oz: "6.2oz", "2.5oz"
  const ozMatch = normalized.match(/([\d.]+)\s*oz/i);
  if (ozMatch) {
    const oz = parseFloat(ozMatch[1]);
    const g = Math.round(oz * OZ_TO_GRAMS * 10) / 10;
    if (g > 0 && g < 50000) weights.push(g);
    return weights;
  }

  // Gram format: "42g"
  const gMatch = normalized.match(/([\d.]+)\s*g/i);
  if (gMatch) {
    const g = parseFloat(gMatch[1]);
    if (g > 0 && g < 10000) weights.push(Math.round(g * 10) / 10);
    return weights;
  }

  // Plain number (assume grams)
  const plainMatch = normalized.match(/([\d.]+)/);
  if (plainMatch) {
    const num = parseFloat(plainMatch[1]);
    if (num > 0 && num < 10000) weights.push(Math.round(num * 10) / 10);
  }

  return weights;
}

/**
 * Parse length from spec value (mm).
 * "250mm" → 250, "175mm" → 175
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  const normalized = normalizeFullWidth(text);
  const match = normalized.match(/([\d.]+)\s*mm/i);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0 && num < 2000) return num;
  }
  return null;
}

/**
 * Parse spec lines from deps product page.
 * Spec lines use full-width colon: "LENGTH：250mm"
 * Returns key-value pairs.
 */
function parseSpecLines(lines: string[]): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const line of lines) {
    const normalized = normalizeFullWidth(line).trim();
    // Key:Value format (after normalizing fullwidth colon)
    const kvMatch = normalized.match(/^(.+?)[:：]\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toUpperCase();
      const value = kvMatch[2].trim();
      if (key && value) specs[key] = value;
    }
  }
  return specs;
}

/**
 * Generate slug from deps URL.
 * https://www.depsweb.co.jp/product/new-slideswimmer250/ → "new-slideswimmer250"
 */
function generateSlug(url: string): string {
  const match = url.match(/\/product\/([^/]+)\/?$/);
  return match ? match[1] : '';
}

/**
 * Detect lure type from category name and product name.
 */
function detectType(category: string, name: string): string {
  // Check name-based keywords first
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(name)) return typeName;
  }

  // Use category mapping
  const catType = CATEGORY_TYPE_MAP[category.toUpperCase().trim()];
  if (catType) return catType;

  return 'ルアー';
}

/**
 * Generate name_kana from Japanese name.
 * deps listing provides katakana names in dd elements.
 * If not available, use the English name.
 */
function generateNameKana(nameJa: string, nameEn: string): string {
  // The Japanese name from the listing page dd is usually katakana
  if (nameJa) return nameJa;
  return nameEn;
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeDepsPage(url: string): Promise<ScrapedLure> {
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

    // --- Check for 404 ---
    const is404 = await page.evaluate(() => {
      const detail = document.querySelector('.p-section.p-detail');
      return detail?.textContent?.includes('お探しのページ') || false;
    });
    if (is404) {
      throw new Error(`Page not found (404): ${url}`);
    }

    // --- Product name (English) ---
    const nameEn = await page.locator('h3.com-title span.ff-ns').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Product name (EN): ${nameEn}`);

    // --- Category ---
    const category = await page.evaluate(() => {
      const h3 = document.querySelector('h3.com-title');
      const span = h3?.querySelector('span.ff-ns');
      if (!h3 || !span) return '';
      const full = h3.textContent?.trim() || '';
      const en = span.textContent?.trim() || '';
      return full.replace(en, '').trim();
    });
    log(`Category: ${category}`);

    if (!nameEn) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // Use English name as the product name (deps products are branded in English)
    const name = nameEn;

    // --- Description ---
    let description = '';
    try {
      const descData = await page.evaluate(() => {
        const dt = document.querySelector('dl.dl-format01 dt');
        const dd = document.querySelector('dl.dl-format01 dd');
        return {
          title: dt?.textContent?.trim() || '',
          body: dd?.textContent?.trim() || '',
        };
      });
      if (descData.title && descData.body) {
        description = `${descData.title}\n${descData.body}`.substring(0, 500);
      } else if (descData.body) {
        description = descData.body.substring(0, 500);
      } else if (descData.title) {
        description = descData.title;
      }
    } catch { /* ignore */ }
    log(`Description: ${description.substring(0, 80)}...`);

    // --- Specs (multi-variant support) ---
    const specVariants = await page.evaluate(() => {
      const items = document.querySelectorAll('ul.mod-spec-list > li');
      const variants: { name: string; lines: string[] }[] = [];
      items.forEach(li => {
        const dt = li.querySelector('dl dt');
        const dds = li.querySelectorAll('dl dd');
        const lines: string[] = [];
        dds.forEach(dd => lines.push(dd.textContent?.trim() || ''));
        variants.push({
          name: dt?.textContent?.trim() || '',
          lines: lines.filter(l => l.length > 0),
        });
      });
      return variants;
    });
    log(`Spec variants: ${specVariants.length}`);

    // --- Parse specs from first non-discontinued variant ---
    let price = 0;
    let weights: number[] = [];
    let length: number | null = null;

    for (const variant of specVariants) {
      const isDiscontinued = variant.lines.some(l => l.includes('生産終了'));
      const specs = parseSpecLines(variant.lines);

      // Price — from spec line or standalone price line
      if (price === 0) {
        // Try from parsed specs
        if (specs['PRICE']) {
          price = parseDepsPrice(specs['PRICE']);
        }
        // Try from raw lines (price is often a standalone line)
        if (price === 0) {
          for (const line of variant.lines) {
            if (/[¥￥]/.test(line) && !line.includes('税抜')) {
              // This is the main price line
              price = parseDepsPrice(line);
              if (price > 0) break;
            }
            if (/[¥￥]/.test(line)) {
              price = parseDepsPrice(line);
              if (price > 0) break;
            }
          }
        }
      }

      // Weight
      const weightText = specs['WEIGHT'] || '';
      if (weightText) {
        const w = parseWeight(weightText);
        if (w.length > 0 && !isDiscontinued) {
          weights.push(...w);
        } else if (w.length > 0 && weights.length === 0) {
          // Even discontinued, use if no other weight available
          weights.push(...w);
        }
      }

      // Length — use first available
      if (length === null) {
        const lengthText = specs['LENGTH'] || '';
        length = parseLength(lengthText);
      }
    }

    log(`Price: ${price}`);
    log(`Weights: [${weights.join(', ')}]`);
    log(`Length: ${length}`);

    // --- Type ---
    const type = detectType(category, name);
    log(`Detected type: ${type} (category: "${category}")`);

    // --- Colors ---
    const colors: ScrapedColor[] = [];
    try {
      const rawColors = await page.evaluate(() => {
        const results: { name: string; imageUrl: string }[] = [];
        document.querySelectorAll('ul.mod-color_list li').forEach(li => {
          const caption = li.querySelector('figcaption');
          const link = li.querySelector('figure a');
          const colorName = caption?.textContent?.trim() || '';
          const imageUrl = link?.getAttribute('href') || '';
          if (colorName) {
            results.push({ name: colorName, imageUrl });
          }
        });
        return results;
      });

      for (const c of rawColors) {
        colors.push({
          name: c.name,
          imageUrl: c.imageUrl,
        });
      }
    } catch (e) {
      log(`Color extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`Found ${colors.length} colors`);

    // --- Main image (hero/banner) ---
    let mainImage = '';
    try {
      mainImage = await page.evaluate(() => {
        const img = document.querySelector('.title_image img, .single-head_products img');
        return img?.getAttribute('src') || '';
      });
    } catch { /* ignore */ }
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
    // deps products use English names. We extract katakana from the listing page
    // or from the page title. For now, use the English name as kana.
    // The pipeline's Airtable record may contain the Japanese name.
    const name_kana = nameEn;

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'deps',
      manufacturer_slug: 'deps',
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
