// scripts/scrapers/shimano.ts
// Shimano product page scraper
// Handles lure products from fish.shimano.com/ja-JP/product/lure/...
//
// IMPORTANT: Shimano's WAF (Akamai) blocks headless browsers with 403.
// This scraper MUST use headless: false (requires GUI display session).

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHIMANO_BASE_URL = 'https://fish.shimano.com';

// ---------------------------------------------------------------------------
// Type detection: sub-category path -> lure type
// ---------------------------------------------------------------------------

const SUBCATEGORY_TYPE_MAP: Record<string, string> = {
  // seabass / surf / bream / lightgame
  'minnow': 'ミノー',
  'sinkingpencil': 'シンキングペンシル',
  'topwater': 'トップウォーター',
  'vibration_blade': 'バイブレーション',
  'bigbait_jointbait': 'ビッグベイト',
  'jig_spoon': 'メタルジグ',
  'worm_jighead': 'ジグヘッド',
  'float': 'フロート',
  'jig_vibration_blade': 'バイブレーション',
  // rockyshore / offshore
  'jig': 'メタルジグ',
  'blade': 'ブレードベイト',
  // eging
  'egi': 'エギ',
  'egi_dropper': 'エギ',
  'sutte': 'スッテ',
  // tako
  'others': 'ルアー',
  // tachiuo
  'tenya': 'テンヤ',
  // tairubber
  'tairubber': 'タイラバ',
  'parts': 'パーツ',
  // bass
  'minnow_shad': 'ミノー',
  'i-motion': 'i字系',
  'crankbait': 'クランクベイト',
  'vibration_spintail': 'バイブレーション',
  'spinnerbait_rubberjig': 'スピナーベイト',
  // trout
  'jigminnow_sinkingpencil': 'ジグミノー',
  'spoon': 'スプーン',
  // offshore casting
  'jointbait': 'ジョイントベイト',
};

// Fallback type detection keywords (for breadcrumb/description)
const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|METAL JIG/i, 'メタルジグ'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/シンキングペンシル|シンペン/i, 'シンキングペンシル'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/バイブレーション|VIB/i, 'バイブレーション'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/スピナーベイト|SPINNER ?BAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZ ?BAIT/i, 'バズベイト'],
  [/スイムベイト|SWIM ?BAIT/i, 'スイムベイト'],
  [/ジョイント|JOINT/i, 'ジョイントベイト'],
  [/ビッグベイト|BIG ?BAIT/i, 'ビッグベイト'],
  [/トップウォーター|TOPWATER/i, 'トップウォーター'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ジグヘッド|JIG ?HEAD/i, 'ジグヘッド'],
  [/ブレード|BLADE|SPIN ?TAIL/i, 'ブレードベイト'],
  [/エギ|EGI|餌木/i, 'エギ'],
  [/タイラバ|鯛ラバ|TIE ?RUBBER/i, 'タイラバ'],
  [/スッテ|SUTTE/i, 'スッテ'],
  [/テンヤ|TENYA/i, 'テンヤ'],
  [/ジグ|JIG/i, 'メタルジグ'],
  [/ワーム|WORM|SOFT/i, 'ワーム'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [shimano] ${message}`);
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
    .replace(/ｇ/g, 'g')
    .replace(/ｍ/g, 'm');
}

/**
 * Parse Shimano price text (tax-excluded) and convert to tax-included (x1.1).
 * Handles:
 *   "1,970円 (税別)" → 2167
 *   "1,970" → 2167
 *   "1,300円～1,400円" → 1430 (min × 1.1)
 *   empty/null → 0
 */
function parseShimanoPrice(priceText: string): number {
  if (!priceText) return 0;
  const cleaned = normalizeFullWidth(priceText).replace(/,/g, '').replace(/\s/g, '');

  // Range: "1300～1400" → take minimum
  const rangeMatch = cleaned.match(/(\d+)[～~\-](\d+)/);
  if (rangeMatch) {
    return Math.round(parseInt(rangeMatch[1], 10) * 1.1);
  }

  // Single: "1970円" or just "1970"
  const singleMatch = cleaned.match(/(\d+)/);
  if (singleMatch) {
    const price = parseInt(singleMatch[1], 10);
    if (price > 100 && price < 100000) {
      return Math.round(price * 1.1);
    }
  }

  return 0;
}

/**
 * Generate slug from Shimano URL.
 * /ja-JP/product/lure/seabass/minnow/a155f00000c5crvqaf.html → "a155f00000c5crvqaf"
 */
function generateSlug(url: string): string {
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // Last segment is "{salesforce_id}.html"
    const lastSegment = segments[segments.length - 1] || '';
    return lastSegment.replace(/\.html$/, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Extract sub-category from URL path for type detection.
 * /ja-JP/product/lure/seabass/minnow/xxx.html → "minnow"
 */
function extractSubCategory(url: string): string {
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // Pattern: ja-JP / product / lure / {category} / {subcategory} / {id}.html
    // subcategory is index 4 (0-based)
    if (segments.length >= 6) {
      return segments[4];
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * Detect lure type from URL sub-category, title, and description.
 */
function detectType(url: string, titleTag: string, description: string): string {
  // 1. Try sub-category from URL path
  const subCategory = extractSubCategory(url);
  if (subCategory && SUBCATEGORY_TYPE_MAP[subCategory]) {
    return SUBCATEGORY_TYPE_MAP[subCategory];
  }

  // 2. Fallback: keyword matching
  const combined = `${titleTag} ${description}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) {
      return typeName;
    }
  }

  return 'ルアー';
}

/**
 * Parse weight value from spec table cell.
 * Shimano spec tables have weight in grams already: "9.5", "20" etc.
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

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeShimanoPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    // IMPORTANT: headless: false required — Shimano's WAF blocks headless browsers
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Navigate — use domcontentloaded instead of networkidle (Shimano has persistent connections)
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000); // Wait for dynamic content
    log('Page loaded');

    // Check for WAF block (403)
    const pageTitle = await page.title().catch(() => '');
    if (pageTitle.includes('Access Denied') || pageTitle.includes('403')) {
      throw new Error(`WAF blocked access to ${url} (403 Access Denied). Ensure headless: false is used.`);
    }

    // --- Product name (h1) ---
    const name = await page.locator('h1').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Product name: ${name}`);

    if (!name) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // --- Title tag ---
    const titleTag = await page.title().catch(() => '');
    log(`Title tag: ${titleTag}`);

    // --- Description ---
    // Shimano has: h3 (catch copy) + .product__description_section (full description)
    let description = '';
    try {
      const descParts = await page.evaluate(() => {
        const parts: string[] = [];

        // Catch copy (h3 inside product area)
        const h3s = document.querySelectorAll('h3');
        let foundCatchCopy = false;
        h3s.forEach(h3 => {
          if (foundCatchCopy) return;
          const text = h3.textContent?.trim() || '';
          // Skip navigation/header h3s — only take meaningful ones
          if (text.length > 10 && text.length < 200 && !text.includes('SHIMANO')) {
            parts.push(text);
            foundCatchCopy = true;
          }
        });

        // Full description
        const descSection = document.querySelector('.product__description_section');
        if (descSection) {
          const text = descSection.textContent?.trim() || '';
          if (text.length > 20) parts.push(text);
        }

        return parts;
      });
      description = descParts.join('\n').substring(0, 500);
    } catch { /* ignore */ }
    if (!description) {
      description = titleTag;
    }
    log(`Description: ${description.substring(0, 80)}...`);

    // --- Price ---
    // Shimano: .product-main__price contains "1,970円 (税別)"
    let price = 0;
    try {
      const priceText = await page.locator('.product-main__price').first().innerText()
        .then(t => t.trim())
        .catch(() => '');
      price = parseShimanoPrice(priceText);
      log(`Price text: "${priceText}" -> ${price} yen (tax incl.)`);
    } catch {
      log('No price found');
    }

    // --- SPEC table ---
    // Shimano's spec table: .spec-table table
    // Headers: 品番, カラー番号, カラー, タイプ, 全長(mm), 重量(g), 飛距離(m), ...
    let specHeaders: string[] = [];
    let specRows: Record<string, string>[] = [];
    try {
      const specData = await page.evaluate(() => {
        const table = document.querySelector('.spec-table table, table');
        if (!table) return { headers: [], rows: [] };

        const trs = table.querySelectorAll('tr');
        if (trs.length < 2) return { headers: [], rows: [] };

        // Headers from first row
        const headers: string[] = [];
        trs[0].querySelectorAll('th, td').forEach(cell => {
          headers.push((cell.textContent || '').trim());
        });

        // Data rows
        const rows: Record<string, string>[] = [];
        for (let r = 1; r < trs.length; r++) {
          const cells = trs[r].querySelectorAll('th, td');
          const row: Record<string, string> = {};
          cells.forEach((cell, c) => {
            if (c < headers.length) {
              row[headers[c]] = (cell.textContent || '').trim();
            }
          });
          if (Object.keys(row).length > 0) rows.push(row);
        }
        return { headers, rows };
      });

      specHeaders = specData.headers.map(h => normalizeFullWidth(h));
      specRows = specData.rows.map(row => {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          normalized[normalizeFullWidth(k)] = normalizeFullWidth(v);
        }
        return normalized;
      });
      if (specHeaders.length > 0) log(`Spec headers: ${specHeaders.join(' | ')}`);
    } catch (e) {
      log(`Spec table extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`Spec rows: ${specRows.length}`);

    // --- Extract weights from spec ---
    // Find the weight column header: 重量(g), 自重(g), ウエイト(g), etc.
    const weightHeader =
      specHeaders.find(h => /重量.*g/i.test(h)) ||
      specHeaders.find(h => /自重.*g/i.test(h)) ||
      specHeaders.find(h => /ウエイト|ウェイト|weight/i.test(h)) ||
      specHeaders.find(h => /重量/i.test(h)) ||
      '';

    const weightsSet = new Set<number>();
    for (const row of specRows) {
      if (weightHeader && row[weightHeader]) {
        const w = parseWeight(row[weightHeader]);
        if (w > 0) weightsSet.add(w);
      }
    }
    const weights = [...weightsSet].sort((a, b) => a - b);
    log(`Weights: [${weights.join(', ')}]`);

    // --- Extract length from spec ---
    // Shimano uses "全長(mm)" header
    const sizeHeader =
      specHeaders.find(h => /全長.*mm/i.test(h)) ||
      specHeaders.find(h => /サイズ.*mm/i.test(h)) ||
      specHeaders.find(h => /全長|length/i.test(h)) ||
      '';

    let length: number | null = null;
    if (sizeHeader && specRows.length > 0) {
      const sizeText = specRows[0][sizeHeader] || '';
      const sizeMatch = sizeText.match(/([\d.]+)/);
      if (sizeMatch) {
        const num = parseFloat(sizeMatch[1]);
        if (!isNaN(num) && num > 0 && num < 2000) {
          length = num;
        }
      }
    }
    log(`Length: ${length}`);

    // --- Extract price from spec if not found above ---
    if (price === 0) {
      const priceHeader = specHeaders.find(h =>
        /本体価格|価格|price/i.test(h),
      ) || '';

      if (priceHeader && specRows.length > 0) {
        price = parseShimanoPrice(specRows[0][priceHeader] || '');
        log(`Price from spec: ${price}`);
      }
    }

    // --- Colors ---
    // Shimano: SKU thumbnails (.thumbnail--sku) or spec table "カラー" column
    const colors: ScrapedColor[] = [];
    try {
      const rawColors = await page.evaluate(() => {
        const results: { name: string; imageUrl: string }[] = [];
        const seen = new Set<string>();

        // Strategy 1: SKU thumbnail images
        const skuThumbs = document.querySelectorAll('.thumbnail--sku, [class*="thumbnail"]');
        skuThumbs.forEach(thumb => {
          const img = thumb.querySelector('img');
          if (!img) return;
          const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
          const alt = img.getAttribute('alt') || '';
          // Use alt text as color name
          const colorName = alt.trim();
          if (colorName && src && !seen.has(colorName)) {
            seen.add(colorName);
            results.push({ name: colorName, imageUrl: src });
          }
        });

        return results;
      });

      for (const c of rawColors) {
        const fullUrl = c.imageUrl.startsWith('http')
          ? c.imageUrl
          : `${SHIMANO_BASE_URL}${c.imageUrl}`;
        colors.push({ name: c.name, imageUrl: fullUrl });
      }
    } catch (e) {
      log(`SKU thumbnail extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Strategy 2: Fall back to spec table "カラー" column
    if (colors.length === 0 && specRows.length > 0) {
      const colorHeader = specHeaders.find(h => /^カラー$/.test(h)) || '';
      if (colorHeader) {
        const seenColors = new Set<string>();
        for (const row of specRows) {
          const colorName = (row[colorHeader] || '').trim();
          if (colorName && !seenColors.has(colorName)) {
            seenColors.add(colorName);
            colors.push({ name: colorName, imageUrl: '' });
          }
        }
      }
    }

    // Strategy 3: Build SKU image URLs from spec table 品番 (product code)
    if (colors.length === 0 || colors.every(c => !c.imageUrl)) {
      const productCodeHeader = specHeaders.find(h => /品番/.test(h)) || '';
      const colorHeader = specHeaders.find(h => /^カラー$/.test(h)) || '';

      if (productCodeHeader) {
        const seenCodes = new Set<string>();
        for (const row of specRows) {
          const code = (row[productCodeHeader] || '').trim();
          const colorName = colorHeader ? (row[colorHeader] || '').trim() : code;
          if (code && !seenCodes.has(code)) {
            seenCodes.add(code);
            // Find matching color or add new
            const existingColor = colors.find(c => c.name === colorName);
            if (existingColor && !existingColor.imageUrl) {
              // Try to construct SKU image URL
              existingColor.imageUrl = `https://dassets2.shimano.com/content/dam/Shimano/JP/fishing/product/lure/SKU/SKU_${code}.jpg`;
            } else if (!existingColor) {
              colors.push({
                name: colorName || code,
                imageUrl: `https://dassets2.shimano.com/content/dam/Shimano/JP/fishing/product/lure/SKU/SKU_${code}.jpg`,
              });
            }
          }
        }
      }
    }
    log(`Found ${colors.length} colors`);

    // --- Main image ---
    let mainImage = '';
    try {
      mainImage = await page.evaluate(() => {
        // Look for product main image
        const imgs = document.querySelectorAll('img[src]');
        let productImg = '';
        let fallbackImg = '';
        imgs.forEach(img => {
          const src = (img as HTMLImageElement).src;
          if (!productImg && src.includes('dam/') && (src.includes('Product') || src.includes('PRD'))) {
            productImg = src;
          }
          if (!fallbackImg && src.includes('dassets2.shimano.com') && !src.includes('Thumbnails') && !src.includes('icon')) {
            fallbackImg = src;
          }
        });
        return productImg || fallbackImg || '';
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

    // --- Detect type ---
    const type = detectType(url, titleTag, description);
    log(`Detected type: ${type}`);

    // --- Name kana ---
    // Shimano products are typically in Japanese; the name itself serves as kana
    const name_kana = name;
    log(`Name kana: ${name_kana}`);

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'SHIMANO',
      manufacturer_slug: 'shimano',
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
