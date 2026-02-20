// scripts/scrapers/jackall.ts
// JACKALL product page scraper
// Handles lure products from www.jackall.co.jp across 4 sections:
//   /bass/products/lure/{subcategory}/{slug}/
//   /saltwater/shore-casting/products/lure/{subcategory}/{slug}/
//   /saltwater/offshore-casting/products/{slug}/
//   /timon/products/lure/{subcategory}/{slug}/
//
// Site: WordPress Multisite, SSR HTML, no WAF.
// Price format: "¥1,870" (tax-included)
// Spec table: .product-spec--pc table (horizontal layout)
// Color chart: .product-color-list__item

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JACKALL_BASE_URL = 'https://www.jackall.co.jp';

// ---------------------------------------------------------------------------
// Type detection: map Jackall subcategory slug → DB lure type
// ---------------------------------------------------------------------------

const SUBCATEGORY_TYPE_MAP: Record<string, string> = {
  // Bass
  'crank-bait': 'クランクベイト',
  'minnow-shad': 'ミノー',
  'vibration': 'バイブレーション',
  'top-water': 'トップウォーター',
  'joint-big-bait': 'ビッグベイト',
  'swim-bait': 'スイムベイト',
  'spoon': 'スプーン',
  'wire-bait': 'ワイヤーベイト',
  'blade-bait': 'ブレードベイト',
  'metal-jig': 'メタルジグ',
  'rubber-jig': 'ラバージグ',
  'namazu': 'ナマズルアー',
  // Salt shore
  'sea-bass': 'シーバスルアー',
  'blue-fish': 'ショアジギング',
  'azi': 'アジング',
  'mebaru': 'メバリング',
  'surf': 'サーフルアー',
  'kurodai': 'チニング',
  'rock-fish': 'ロックフィッシュ',
  'tatiuo': 'タチウオルアー',
  'cian': 'ショアジギング',
  // Salt offshore
  'tiprun': 'ティップラン',
  'fugu': 'フグルアー',
  'ikametal': 'イカメタル',
  'binbinswitch': 'タイラバ',
  'tairaba-tairaba&taijig': 'タイラバ',
  'hitotsu-tenya': 'ひとつテンヤ',
  'bluefish-jigging': 'ジギング',
  'boat-casting': 'オフショアキャスティング',
  'tatchiuo': 'タチウオジギング',
  'bachikon': 'バチコン',
  // Trout (Timon)
  'crank': 'クランクベイト',
  'minnow': 'ミノー',
  'stream': 'トラウトルアー',
  'cr': 'トラウトルアー',
  'ayu': '鮎ルアー',
  'set': 'トラウトルアー',
};

// Fallback: keyword-based type detection from product name
const TYPE_KEYWORDS: [RegExp, string][] = [
  [/クランク|CRANK/i, 'クランクベイト'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/バイブレーション|VIBRATION|VIB/i, 'バイブレーション'],
  [/トップ|ポッパー|POPPER|ペンシル|PENCIL/i, 'トップウォーター'],
  [/ビッグベイト|BIG\s?BAIT|ジョイント|JOINT/i, 'ビッグベイト'],
  [/スイムベイト|SWIM\s?BAIT/i, 'スイムベイト'],
  [/メタルジグ|METAL\s?JIG|ジグ/i, 'メタルジグ'],
  [/スピナーベイト|SPINNER\s?BAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZ\s?BAIT/i, 'バズベイト'],
  [/ブレード|BLADE/i, 'ブレードベイト'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ラバージグ|RUBBER\s?JIG|ラバジ/i, 'ラバージグ'],
  [/タイラバ|鯛ラバ|TAIRABA|ビンビン|BINBIN/i, 'タイラバ'],
  [/テンヤ|TENYA/i, 'ひとつテンヤ'],
  [/フロッグ|FROG/i, 'フロッグ'],
  [/エギ|EGI|SQUID/i, 'エギ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [jackall] ${message}`);
}

/**
 * Extract subcategory slug from a Jackall product URL.
 * /bass/products/lure/crank-bait/master-crank/ → "crank-bait"
 * /saltwater/offshore-casting/products/gekidaki-tr/ → "" (no subcategory)
 */
function extractSubcategory(url: string): string {
  // Standard pattern: /products/lure/{subcategory}/{slug}/
  const lureMatch = url.match(/\/products\/lure\/([^/]+)\//);
  if (lureMatch) return lureMatch[1];

  // Offshore pattern: /products/category/{subcategory}/ (from listing)
  // but detail URL is /products/{slug}/ — no subcategory in URL
  return '';
}

/**
 * Extract product slug from URL.
 * /bass/products/lure/crank-bait/master-crank/ → "master-crank"
 * /saltwater/offshore-casting/products/gekidaki-tr/ → "gekidaki-tr"
 */
function extractSlug(url: string): string {
  const cleaned = url.replace(/\/$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Detect lure type from subcategory slug and product name.
 */
function detectType(subcategory: string, name: string, englishName: string): string {
  // 1. Check subcategory
  if (subcategory && SUBCATEGORY_TYPE_MAP[subcategory]) {
    return SUBCATEGORY_TYPE_MAP[subcategory];
  }

  // 2. Keyword fallback
  const combined = `${name} ${englishName}`;
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }

  return 'ルアー';
}

/**
 * Parse price from Jackall format.
 * "¥1,870" → 1870
 * "1,870円" → 1870
 * "¥1,870（税込）" → 1870
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const match = text.replace(/,/g, '').match(/(\d{3,})/);
  if (match) {
    const price = parseInt(match[1], 10);
    if (price >= 100 && price < 1000000) return price;
  }
  return 0;
}

/**
 * Parse weight from spec cell text.
 * "6.2g" → [6.2]
 * "14g" → [14]
 * "1/2oz class" → [14.2]
 * "7g, 10g, 14g" → [7, 10, 14]
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];

  // Split by common separators (/, comma, ・)
  // But first check if it's a single weight
  const cleaned = text.replace(/\s+/g, ' ').trim();

  // gram format: "6.2g"
  const gMatches = cleaned.matchAll(/([\d.]+)\s*g(?:\b|$)/gi);
  for (const m of gMatches) {
    const w = parseFloat(m[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }

  if (weights.length > 0) return [...new Set(weights)];

  // oz format: "1/2oz"
  const fracOzMatch = cleaned.match(/(\d+)\/(\d+)\s*oz/i);
  if (fracOzMatch) {
    const frac = parseInt(fracOzMatch[1], 10) / parseInt(fracOzMatch[2], 10);
    const g = Math.round(frac * 28.3495 * 10) / 10;
    if (g > 0) weights.push(g);
  }

  const decOzMatch = cleaned.match(/([\d.]+)\s*oz/i);
  if (decOzMatch && weights.length === 0) {
    const g = Math.round(parseFloat(decOzMatch[1]) * 28.3495 * 10) / 10;
    if (g > 0) weights.push(g);
  }

  return [...new Set(weights)];
}

/**
 * Parse length from spec cell text.
 * "47mm" → 47
 * "130mm" → 130
 * "47.0mm" → 47
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)\s*mm/i);
  if (match) {
    const len = parseFloat(match[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeJackallPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    log(`Navigating to ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response || response.status() === 404) {
      throw new Error(`Page not found (404): ${url}`);
    }

    // Wait for main content to be present
    await page.waitForSelector('h1.page-main__title', { timeout: 10000 }).catch(() => {});

    // ----- Extract basic info -----
    const pageData = await page.evaluate(() => {
      // English name from title-main
      const titleMain = document.querySelector('h1.page-main__title .title-main');
      const englishName = titleMain?.textContent?.trim() || '';

      // Japanese name from title-kana
      const titleKana = document.querySelector('h1.page-main__title .title-kana');
      const japaneseName = titleKana?.textContent?.trim() || '';

      // Category from breadcrumb or .page-main__cats
      const catEl = document.querySelector('.page-main__cats span, .page-main__cats');
      const categoryText = catEl?.textContent?.replace(/CATEGORY[：:]?\s*/i, '').trim() || '';

      // Description / catchphrase
      const descEl = document.querySelector('.page-contents-main h2.title-main.black');
      let description = descEl?.textContent?.trim() || '';

      // If no h2.title-main.black, try first <p> in feature section
      if (!description) {
        const featureP = document.querySelector('.page-contents-main .products-section p');
        description = featureP?.textContent?.trim() || '';
      }
      // Truncate
      if (description.length > 500) description = description.substring(0, 500);

      // Main image
      const mainImg = document.querySelector('.page-contents-main img[src*="uploads"]');
      const mainImageUrl = mainImg?.getAttribute('src') || '';

      // ----- Spec table (desktop version) -----
      const specTable = document.querySelector('.product-spec--pc table');
      const specs: { headers: string[]; rows: string[][] } = { headers: [], rows: [] };

      if (specTable) {
        const headerCells = specTable.querySelectorAll('tr:first-child th');
        specs.headers = Array.from(headerCells).map(th => th.textContent?.trim() || '');

        const dataRows = specTable.querySelectorAll('tr:not(:first-child)');
        for (const row of dataRows) {
          const cells = row.querySelectorAll('td');
          const rowData = Array.from(cells).map(td => td.textContent?.trim() || '');
          if (rowData.some(c => c.length > 0)) {
            specs.rows.push(rowData);
          }
        }
      }

      // ----- Color chart -----
      const colorItems = document.querySelectorAll('.product-color-list__item');
      const colors: { name: string; thumbUrl: string; fullUrl: string }[] = [];

      for (const item of colorItems) {
        const nameEl = item.querySelector('.caption .title');
        const colorName = nameEl?.textContent?.trim() || '';
        if (!colorName) continue;

        // Thumbnail image
        const thumbImg = item.querySelector('.photo-ratio img');
        const thumbUrl = thumbImg?.getAttribute('src') || '';

        // Full-size image (in lightbox)
        const fullImg = item.querySelector('.lightbox-target-contents img');
        const fullUrl = fullImg?.getAttribute('src') || '';

        colors.push({
          name: colorName,
          thumbUrl,
          fullUrl: fullUrl || thumbUrl,
        });
      }

      return {
        englishName,
        japaneseName,
        categoryText,
        description,
        mainImageUrl,
        specs,
        colors,
      };
    });

    log(`Product: ${pageData.japaneseName} (${pageData.englishName})`);
    log(`Colors: ${pageData.colors.length}, Spec rows: ${pageData.specs.rows.length}`);

    // ----- Process scraped data -----

    const subcategory = extractSubcategory(url);
    const slug = extractSlug(url);

    // Jackall's title-main/title-kana order is inconsistent across sections:
    //   Bass: title-main = English, title-kana = Japanese
    //   Offshore: title-main = Japanese, title-kana = English
    // Detect which is which by checking for CJK characters.
    const hasCJK = (s: string) => /[\u3000-\u9FFF\uFF00-\uFFEF]/.test(s);

    let japaneseName: string;
    let englishName: string;

    if (hasCJK(pageData.englishName) && !hasCJK(pageData.japaneseName)) {
      // title-main has Japanese, title-kana has English (offshore pattern)
      japaneseName = pageData.englishName;
      englishName = pageData.japaneseName;
    } else {
      // Normal: title-main = English, title-kana = Japanese
      japaneseName = pageData.japaneseName;
      englishName = pageData.englishName;
    }

    const name = japaneseName || englishName || slug;
    englishName = englishName || slug.toUpperCase().replace(/-/g, ' ');

    // Type detection
    const type = detectType(subcategory, name, englishName);

    // ----- Parse spec table -----
    const headers = pageData.specs.headers.map(h => h.toUpperCase());
    const weightColIdx = headers.findIndex(h => h.includes('WEIGHT') || h.includes('重'));
    const lengthColIdx = headers.findIndex(h => h.includes('LENGTH') || h.includes('長') || h.includes('全長'));
    const priceColIdx = headers.findIndex(h => h.includes('PRICE') || h.includes('価格') || h.includes('本体価格'));

    // Collect all weights and lengths from spec rows
    const allWeights: number[] = [];
    let firstLength: number | null = null;
    let bestPrice = 0;

    for (const row of pageData.specs.rows) {
      // Weights
      if (weightColIdx >= 0 && row[weightColIdx]) {
        const w = parseWeights(row[weightColIdx]);
        allWeights.push(...w);
      }

      // Length (use first row's value)
      if (firstLength === null && lengthColIdx >= 0 && row[lengthColIdx]) {
        firstLength = parseLength(row[lengthColIdx]);
      }

      // Price (use first valid price)
      if (bestPrice === 0 && priceColIdx >= 0 && row[priceColIdx]) {
        bestPrice = parsePrice(row[priceColIdx]);
      }
    }

    // If no weights found from column headers, try parsing all cells
    if (allWeights.length === 0) {
      for (const row of pageData.specs.rows) {
        for (const cell of row) {
          if (/\d+(\.\d+)?\s*g\b/i.test(cell) || /\d+(\.\d+)?\s*oz/i.test(cell)) {
            const w = parseWeights(cell);
            allWeights.push(...w);
          }
        }
      }
    }

    // If no price from column, try parsing all cells
    if (bestPrice === 0) {
      for (const row of pageData.specs.rows) {
        for (const cell of row) {
          if (/[¥￥]/.test(cell) || /円/.test(cell)) {
            const p = parsePrice(cell);
            if (p > 0) { bestPrice = p; break; }
          }
        }
        if (bestPrice > 0) break;
      }
    }

    const uniqueWeights = [...new Set(allWeights)].sort((a, b) => a - b);

    // Colors
    const colors: ScrapedColor[] = pageData.colors.map(c => ({
      name: c.name,
      imageUrl: c.fullUrl || c.thumbUrl,
    })).filter(c => c.imageUrl);

    // Generate name_kana (use Japanese name as-is since it's already in katakana/hiragana)
    const name_kana = pageData.japaneseName || '';

    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'JACKALL',
      manufacturer_slug: 'jackall',
      type,
      description: pageData.description,
      price: bestPrice,
      colors,
      weights: uniqueWeights,
      length: firstLength,
      mainImage: pageData.mainImageUrl,
      sourceUrl: url,
    };

    log(`Result: ${result.name} | type=${result.type} | price=${result.price} | weights=[${result.weights.join(',')}] | length=${result.length} | colors=${result.colors.length}`);

    await browser.close();
    browser = null;
    return result;

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`Error scraping ${url}: ${errMsg}`);

    if (browser) await browser.close();

    // Return minimal data so pipeline can continue
    return {
      name: extractSlug(url).replace(/-/g, ' ').toUpperCase(),
      name_kana: '',
      slug: extractSlug(url),
      manufacturer: 'JACKALL',
      manufacturer_slug: 'jackall',
      type: 'ルアー',
      description: '',
      price: 0,
      colors: [],
      weights: [],
      length: null,
      mainImage: '',
      sourceUrl: url,
    };
  }
}
