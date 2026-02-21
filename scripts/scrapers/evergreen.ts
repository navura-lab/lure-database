// scripts/scrapers/evergreen.ts
// EVERGREEN INTERNATIONAL product page scraper
// Handles lure products from www.evergreen-fishing.com:
//   /goods_list/{ProductName}.html
//
// Site: Static HTML (SSR), no WAF, headless OK.
// Price format: "850円（税別）" — TAX-EXCLUDED → multiply by 1.1
// Length format: "15.0cm" — centimeters → multiply by 10 for mm
// Spec table: table.spec (MULTIPLE tables per page, one per weight variant)
// Color chart: li > a[href*="resizeimg"] + strong (under カラーチャート heading)

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVERGREEN_BASE_URL = 'https://www.evergreen-fishing.com';

// ---------------------------------------------------------------------------
// Type detection: keyword-based
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ビッグベイト|ビッグ・ベイト|BIG\s?BAIT/i, 'ビッグベイト'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/バイブレーション|VIBRATION|VIB/i, 'バイブレーション'],
  [/ミノー|MINNOW|ジャークベイト|JERKBAIT/i, 'ミノー'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/トップウォーター|TOP\s?WATER|ポッパー|POPPER|ペンシル|PENCIL/i, 'トップウォーター'],
  [/プロップ|PROP/i, 'プロップベイト'],
  [/フロッグ|FROG/i, 'フロッグ'],
  [/スピナーベイト|SPINNER\s?BAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZ\s?BAIT/i, 'バズベイト'],
  [/チャターベイト|CHATTER/i, 'チャターベイト'],
  [/ワイヤーベイト|WIRE\s?BAIT/i, 'ワイヤーベイト'],
  [/ジグ|JIG/i, 'ジグ'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/メタルジグ|METAL\s?JIG/i, 'メタルジグ'],
  [/エギ|EGI|SQUID/i, 'エギ'],
  [/タイラバ|TAIRABA/i, 'タイラバ'],
  [/シーバス|SEA\s?BASS/i, 'シーバスルアー'],
  [/スイムベイト|SWIM\s?BAIT/i, 'スイムベイト'],
];

// Map breadcrumb series names to lure type hints
const SERIES_TYPE_MAP: Record<string, string> = {
  // These can be refined after observing real breadcrumb data
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [evergreen] ${message}`);
}

/**
 * Extract product slug from URL.
 * /goods_list/LittleMax.html → "littlemax"
 */
function extractSlug(url: string): string {
  const match = url.match(/\/goods_list\/([^/]+)\.html/i);
  if (match) return match[1].toLowerCase();
  // Fallback: last path segment
  const parts = url.replace(/\.html$/, '').split('/');
  return (parts[parts.length - 1] || '').toLowerCase();
}

/**
 * Detect lure type from breadcrumb text and product name.
 */
function detectType(breadcrumbText: string, name: string): string {
  // 1. Check breadcrumb for series-level type hints
  const combined = `${breadcrumbText} ${name}`;
  for (const [seriesName, type] of Object.entries(SERIES_TYPE_MAP)) {
    if (combined.includes(seriesName)) return type;
  }

  // 2. Keyword fallback on product name + breadcrumb
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }

  return 'ルアー';
}

/**
 * Parse weight from spec table cell.
 * "1/8oz" → [3.5]
 * "2ozクラス・66g" → [66] (prefer explicit gram value)
 * "42g" → [42]
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];
  const cleaned = text.replace(/\s+/g, ' ').trim();

  // Prefer explicit gram values: "66g", "6.2g"
  const gMatches = cleaned.matchAll(/([\d.]+)\s*g(?:\b|$)/gi);
  for (const m of gMatches) {
    const w = parseFloat(m[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }
  if (weights.length > 0) return [...new Set(weights)];

  // Fraction oz: "1/2oz", "3/8oz"
  const fracOzMatch = cleaned.match(/(\d+)\/(\d+)\s*oz/i);
  if (fracOzMatch) {
    const frac = parseInt(fracOzMatch[1], 10) / parseInt(fracOzMatch[2], 10);
    const g = Math.round(frac * 28.3495 * 10) / 10;
    if (g > 0) weights.push(g);
    return weights;
  }

  // Decimal oz: "2.5oz"
  const decOzMatch = cleaned.match(/([\d.]+)\s*oz/i);
  if (decOzMatch) {
    const g = Math.round(parseFloat(decOzMatch[1]) * 28.3495 * 10) / 10;
    if (g > 0) weights.push(g);
  }

  return [...new Set(weights)];
}

/**
 * Parse length from spec table cell.
 * EVERGREEN uses cm format: "15.0cm" → 150 (mm)
 * Also supports mm format as fallback: "130mm" → 130
 */
function parseLength(text: string): number | null {
  if (!text) return null;

  // cm format (EVERGREEN primary): "15.0cm", "3.5cm"
  const cmMatch = text.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    const mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }

  // mm format (fallback): "130mm"
  const mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }

  return null;
}

/**
 * Parse price from EVERGREEN format (TAX-EXCLUDED).
 * "850円（税別）" → 935 (× 1.1)
 * "5,000円（税別）" → 5500
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const match = text.replace(/,/g, '').match(/(\d{3,})\s*円/);
  if (match) {
    const priceExTax = parseInt(match[1], 10);
    if (priceExTax >= 100 && priceExTax < 1000000) {
      // Convert tax-excluded to tax-included (10% consumption tax)
      return Math.floor(priceExTax * 1.1);
    }
  }
  return 0;
}

/**
 * Extract direct image URL from EVERGREEN's resizeimg PHP link.
 * "/resizeimg/imageresize.php?image=../images_set02/goods_images/goods_detail/1106819/1106819_01.jpg&w=768&h=768"
 * → "https://www.evergreen-fishing.com/images_set02/goods_images/goods_detail/1106819/1106819_01.jpg"
 */
function extractImageUrl(resizeUrl: string): string {
  if (!resizeUrl) return '';

  // Extract the "image=" parameter
  const imageMatch = resizeUrl.match(/[?&]image=([^&]+)/);
  if (imageMatch) {
    let path = decodeURIComponent(imageMatch[1]);
    // Remove leading "../"
    path = path.replace(/^\.\.\//, '/');
    if (!path.startsWith('/')) path = '/' + path;
    return EVERGREEN_BASE_URL + path;
  }

  // If it's already a direct path
  if (resizeUrl.startsWith('/') && !resizeUrl.includes('resizeimg')) {
    return EVERGREEN_BASE_URL + resizeUrl;
  }

  return resizeUrl.startsWith('http') ? resizeUrl : '';
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeEvergreenPage(url: string): Promise<ScrapedLure> {
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

    // Wait briefly for content
    await page.waitForSelector('h2', { timeout: 10000 }).catch(() => {});

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate(() => {
      // Product name from <h2> (h1 is a banner image on EVERGREEN)
      // Skip the first h2 which is "Search"
      const h2s = document.querySelectorAll('h2');
      let name = '';
      for (const h2 of h2s) {
        const text = h2.textContent?.trim() || '';
        if (text && text !== 'Search') {
          name = text;
          break;
        }
      }
      // Fallback to title tag: "EVERGREEN（...） - ワイルドハンチ" → "ワイルドハンチ"
      if (!name) {
        const titleText = document.title || '';
        const dashIdx = titleText.lastIndexOf(' - ');
        if (dashIdx > 0) name = titleText.substring(dashIdx + 3).trim();
      }

      // Breadcrumb text
      const breadcrumb = document.querySelector('ol');
      const breadcrumbText = breadcrumb?.textContent?.trim() || '';

      // Description - first substantial paragraph in titleArea or main content
      let description = '';

      // Primary: <p> inside .titleArea (used on newer product pages)
      const titleAreaP = document.querySelector('.titleArea p');
      if (titleAreaP) {
        const text = titleAreaP.textContent?.trim() || '';
        if (text.length > 30) description = text.substring(0, 500);
      }

      // Fallback: any substantial <p> in main content
      if (!description) {
        const contentArea = document.querySelector('#contents') || document.body;
        const paragraphs = contentArea.querySelectorAll('p');
        for (const p of paragraphs) {
          const text = p.textContent?.trim() || '';
          if (text.length > 30 && !text.includes('Copyright') && !text.includes('©')) {
            description = text.substring(0, 500);
            break;
          }
        }
      }

      // Fallback 2: concatenate feature item texts (li.item-feature strong)
      if (!description) {
        const featureItems = document.querySelectorAll('li.item-feature strong');
        const features: string[] = [];
        for (const strong of featureItems) {
          const text = strong.textContent?.trim().replace(/^■\s*/, '') || '';
          if (text.length > 5) features.push(text);
        }
        if (features.length > 0) {
          description = features.join('。').substring(0, 500);
        }
      }

      // ----- Spec tables (table.spec) — multiple per page -----
      const specTables = document.querySelectorAll('table.spec');
      const specs: { weight: string; length: string; price: string }[] = [];

      for (const table of specTables) {
        const entry: { weight: string; length: string; price: string } = {
          weight: '', length: '', price: '',
        };

        for (let r = 0; r < table.rows.length; r++) {
          const cells = Array.from(table.rows[r].cells).map(c => c.textContent?.trim() || '');

          // Pattern 1: 4 cells — [全長, 3.5cm, 自重, 1/8oz]
          if (cells.length >= 4) {
            if (cells[0] === '全長') entry.length = cells[1];
            if (cells[2] === '自重') entry.weight = cells[3];
          }

          // Pattern 2: 2 cells — [全長, 3.5cm] or [自重, 1/8oz] or [価格, 850円]
          if (cells.length >= 2) {
            if (cells[0] === '全長' && !entry.length) entry.length = cells[1];
            if (cells[0] === '自重' && !entry.weight) entry.weight = cells[1];
            if (cells[0] === '価格') entry.price = cells[1];
          }
        }

        specs.push(entry);
      }

      // ----- Color chart -----
      // Color items are inside ul.ccswitch_ul (id="list_1", "list_2", etc.)
      // Each li.topborder contains: a[href] > table > img + strong(colorName)
      // Feature items are in ul.point li.item-feature — must be excluded
      const colorItems: { name: string; imageHref: string; thumbSrc: string }[] = [];

      // Target color chart lists specifically
      const colorLists = document.querySelectorAll('ul.ccswitch_ul');
      for (const ul of colorLists) {
        const lis = ul.querySelectorAll('li');
        for (const li of lis) {
          const strong = li.querySelector('strong');
          const link = li.querySelector('a');
          const img = li.querySelector('img');

          if (!strong || !img) continue;

          const strongText = strong.textContent?.trim() || '';
          const href = link?.getAttribute('href') || '';
          const imgSrc = img.getAttribute('src') || '';

          // Skip feature descriptions and empty entries
          if (!strongText || strongText.startsWith('■') || strongText.startsWith('【')) continue;

          colorItems.push({
            name: strongText,
            imageHref: href,
            thumbSrc: imgSrc,
          });
        }
      }

      // ----- Main image -----
      let mainImageUrl = '';
      const mainImgs = document.querySelectorAll('img');
      for (const img of mainImgs) {
        const src = img.getAttribute('src') || '';
        if (src.includes('goods_detail') && src.includes('_08.')) {
          mainImageUrl = src;
          break;
        }
      }
      // Fallback: first goods_detail image that's not a color thumbnail
      if (!mainImageUrl) {
        for (const img of mainImgs) {
          const src = img.getAttribute('src') || '';
          if (src.includes('goods_detail') && src.includes('_07.')) {
            mainImageUrl = src;
            break;
          }
        }
      }

      return {
        name,
        breadcrumbText,
        description,
        specs,
        colorItems,
        mainImageUrl,
      };
    });

    log(`Product: ${pageData.name}`);
    log(`Spec tables: ${pageData.specs.length}, Colors: ${pageData.colorItems.length}`);

    // ----- Process scraped data -----

    const slug = extractSlug(url);
    const name = pageData.name || slug.replace(/-/g, ' ');

    // Type detection
    const type = detectType(pageData.breadcrumbText, name);

    // Parse weights from all spec tables (deduplicated)
    const allWeights: number[] = [];
    let firstLength: number | null = null;
    let bestPrice = 0;

    for (const spec of pageData.specs) {
      const w = parseWeights(spec.weight);
      allWeights.push(...w);

      if (firstLength === null) {
        firstLength = parseLength(spec.length);
      }

      if (bestPrice === 0) {
        bestPrice = parsePrice(spec.price);
      }
    }

    const uniqueWeights = [...new Set(allWeights)].sort((a, b) => a - b);

    // Colors
    const colors: ScrapedColor[] = pageData.colorItems.map(c => ({
      name: c.name,
      imageUrl: extractImageUrl(c.imageHref) || (c.thumbSrc ? (c.thumbSrc.startsWith('http') ? c.thumbSrc : EVERGREEN_BASE_URL + c.thumbSrc) : ''),
    })).filter(c => c.imageUrl);

    // Main image URL
    let mainImage = '';
    if (pageData.mainImageUrl) {
      mainImage = pageData.mainImageUrl.startsWith('http')
        ? pageData.mainImageUrl
        : EVERGREEN_BASE_URL + pageData.mainImageUrl;
    }
    // Fallback to first color image
    if (!mainImage && colors.length > 0) {
      mainImage = colors[0].imageUrl;
    }

    const result: ScrapedLure = {
      name,
      name_kana: name, // EVERGREEN product names are already katakana
      slug,
      manufacturer: 'EVERGREEN INTERNATIONAL',
      manufacturer_slug: 'evergreen',
      type,
      description: pageData.description,
      price: bestPrice,
      colors,
      weights: uniqueWeights,
      length: firstLength,
      mainImage,
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
      name: extractSlug(url).replace(/-/g, ' '),
      name_kana: '',
      slug: extractSlug(url),
      manufacturer: 'EVERGREEN INTERNATIONAL',
      manufacturer_slug: 'evergreen',
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
