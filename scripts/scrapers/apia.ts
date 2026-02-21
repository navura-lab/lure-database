// scripts/scrapers/apia.ts
// APIA Japan product page scraper
// Handles lure products from www.apiajapan.com/product/lure/{slug}/
//
// Site: Next.js SSR (React Server Components), no WAF, headless OK.
// Images: MicroCMS CDN (images.microcms-assets.io)
// Price format: "¥2,200(税別)" — TAX-EXCLUDED → multiply by 1.1
// Spec format: Paragraph text with <br> separators (not a table)
// Colors: ProductVariation component with title + thumbnail.url

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APIA_BASE_URL = 'https://www.apiajapan.com';

// ---------------------------------------------------------------------------
// Type detection: keyword-based
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/トップウォーター|TOP\s?WATER|ポッパー|POPPER/i, 'トップウォーター'],
  [/シンキングペンシル|SINKING\s?PENCIL|シンペン/i, 'シンキングペンシル'],
  [/ミノー|MINNOW|シャッド|SHAD/i, 'ミノー'],
  [/バイブレーション|VIBRATION|VIB/i, 'バイブレーション'],
  [/メタルジグ|METAL\s?JIG/i, 'メタルジグ'],
  [/メタルバイブ|METAL\s?VIB/i, 'メタルバイブ'],
  [/ジグヘッド|JIG\s?HEAD/i, 'ジグヘッド'],
  [/ワーム|WORM|SOFT/i, 'ワーム'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ブレード|BLADE/i, 'ブレードベイト'],
];

// ---------------------------------------------------------------------------
// Genre → target fish mapping
// ---------------------------------------------------------------------------

const GENRE_FISH_MAP: Record<string, string[]> = {
  'SEABASS': ['シーバス'],
  'SEA BASS': ['シーバス'],
  'シーバス': ['シーバス'],
  'SURF': ['ヒラメ・マゴチ'],
  'サーフ': ['ヒラメ・マゴチ'],
  'LIGHT GAME': ['アジ', 'メバル'],
  'ライトゲーム': ['アジ', 'メバル'],
  'SHORE PLUGGING': ['青物'],
  'ショアプラッギング': ['青物'],
  'JIGGING': ['青物'],
  'ジギング': ['青物'],
  'ROCK FISH': ['ロックフィッシュ'],
  'ロックフィッシュ': ['ロックフィッシュ'],
  'CHINU': ['クロダイ'],
  'チヌ': ['クロダイ'],
  'OCEAN TROUT': ['トラウト'],
  'オーシャントラウト': ['トラウト'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [apia] ${message}`);
}

/**
 * Extract product slug from URL.
 * /product/lure/masterpiece120fl/ → "masterpiece120fl"
 */
function extractSlug(url: string): string {
  const match = url.match(/\/product\/lure\/([^/?#]+)/);
  if (match) return match[1].toLowerCase().replace(/\/$/, '');
  // Fallback: last non-empty path segment
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] || '').toLowerCase();
}

/**
 * Detect lure type from type label text and product name.
 */
function detectType(typeLabel: string, name: string): string {
  const combined = `${typeLabel} ${name}`;

  // Direct match from APIA's type labels
  if (/トップウォーター|TOP\s?WATER/i.test(typeLabel)) return 'トップウォーター';
  if (/シンキングペンシル|SINKING\s?PENCIL/i.test(typeLabel)) return 'シンキングペンシル';
  if (/ミノー|MINNOW/i.test(typeLabel)) return 'ミノー';
  if (/シャッド|SHAD/i.test(typeLabel)) return 'シャッド';
  if (/バイブレーション|VIBRATION/i.test(typeLabel)) return 'バイブレーション';
  if (/メタルジグ|METAL\s?JIG/i.test(typeLabel)) return 'メタルジグ';
  if (/ルアーパーツ|LURE\s?PARTS/i.test(typeLabel)) return 'ルアーパーツ';

  // Keyword fallback on product name
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }

  return 'ルアー';
}

/**
 * Derive target fish from genre label(s).
 */
function deriveTargetFish(genreTexts: string[]): string[] {
  const fishSet = new Set<string>();

  for (const genre of genreTexts) {
    const trimmed = genre.trim().toUpperCase();
    for (const [key, fish] of Object.entries(GENRE_FISH_MAP)) {
      if (trimmed.includes(key.toUpperCase())) {
        for (const f of fish) fishSet.add(f);
      }
    }
  }

  // Default for APIA (saltwater specialist, primary: seabass)
  if (fishSet.size === 0) return ['シーバス'];
  return [...fishSet];
}

/**
 * Parse price from APIA format (TAX-EXCLUDED).
 * "¥2,200(税別)" → 2420 (× 1.1)
 * "¥1,350(税別)" → 1485
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/,/g, '').replace(/￥/g, '¥');
  const match = cleaned.match(/(\d{3,})/);
  if (match) {
    const priceExTax = parseInt(match[1], 10);
    if (priceExTax >= 100 && priceExTax < 1000000) {
      return Math.floor(priceExTax * 1.1);
    }
  }
  return 0;
}

/**
 * Parse weights from spec text.
 * "重量: 16g" → [16]
 * "重量: 4.5g / 5.5g" → [4.5, 5.5]
 * "重量: 22g(実測)" → [22]
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];
  const matches = text.matchAll(/([\d.]+)\s*g/gi);
  for (const m of matches) {
    const w = parseFloat(m[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }
  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Parse length from spec text.
 * "全長: 120mm" → 120
 * "全長: 55mm" → 55
 */
function parseLength(text: string): number | null {
  if (!text) return null;

  // mm format (APIA primary)
  const mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }

  // cm format (fallback)
  const cmMatch = text.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    const mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeApiaPage(url: string): Promise<ScrapedLure> {
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

    // Wait for SSR content to hydrate
    await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate(() => {
      // --- Product name ---
      const h1 = document.querySelector('h1');
      const name = h1?.textContent?.trim() || '';

      // --- Genre labels ---
      const genreLabels: string[] = [];
      const genreEls = document.querySelectorAll('[class*="GenreLabel_genreLabel"]');
      for (const el of genreEls) {
        const text = el.textContent?.trim();
        if (text) genreLabels.push(text);
      }

      // --- Lure type label ---
      let typeLabel = '';
      const typeEls = document.querySelectorAll('[class*="productSingleHeader__subtype"], [class*="productSingleHeader__lureTypes"] a');
      for (const el of typeEls) {
        const text = el.textContent?.trim().replace(/^#/, '') || '';
        if (text) { typeLabel = text; break; }
      }

      // --- Price ---
      let priceText = '';
      const priceEl = document.querySelector('[class*="Price_price"]');
      if (priceEl) {
        priceText = priceEl.textContent?.trim() || '';
      }

      // --- Spec text ---
      let specText = '';
      const specEls = document.querySelectorAll('[class*="specContent"], [class*="articleContent"]');
      for (const el of specEls) {
        const text = el.textContent?.trim() || '';
        if (text.includes('mm') || text.includes('全長') || text.includes('重量')) {
          specText = text;
          break;
        }
      }

      // --- Description ---
      let description = '';
      const descEls = document.querySelectorAll('[class*="articleContent"]');
      for (const el of descEls) {
        const text = el.textContent?.trim() || '';
        // Skip spec sections
        if (text.length > 50 && !text.startsWith('全長') && !/^重量/.test(text)) {
          description = text.substring(0, 500);
          break;
        }
      }
      // Fallback: meta description
      if (!description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        description = metaDesc?.getAttribute('content')?.trim()?.substring(0, 500) || '';
      }

      // --- Colors (variations) ---
      const colors: { name: string; imageUrl: string }[] = [];

      // Strategy 1: Extract from RSC payload in <script> tags
      // APIA uses Next.js RSC which embeds variation data as JSON in script tags:
      //   "variations":[{"title":"01 レッドヘッド","thumbnail":{"url":"https://..."}}]
      const scripts = document.querySelectorAll('script');
      for (const script of Array.from(scripts)) {
        const content = script.textContent || '';
        if (!content.includes('"variations"')) continue;

        // Extract the variations JSON array
        const varMatch = content.match(/"variations"\s*:\s*\[(.*?)\]\s*\}/);
        if (!varMatch) continue;

        try {
          const jsonStr = '[' + varMatch[1] + ']';
          const variations = JSON.parse(jsonStr) as Array<{
            title?: string;
            thumbnail?: { url?: string };
          }>;
          for (const v of variations) {
            if (v.title && v.thumbnail?.url) {
              colors.push({ name: v.title, imageUrl: v.thumbnail.url });
            }
          }
        } catch {
          // JSON parse failed, try regex fallback
          const titleUrlPairs = content.matchAll(/"title"\s*:\s*"([^"]+)"\s*,\s*"thumbnail"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/g);
          for (const m of Array.from(titleUrlPairs)) {
            if (m[1] && m[2]) {
              colors.push({ name: m[1], imageUrl: m[2] });
            }
          }
        }
        if (colors.length > 0) break;
      }

      // Strategy 2: Extract from Swiper carousel figure elements
      // Color name is encoded in the image filename (URL-encoded Japanese)
      if (colors.length === 0) {
        const figures = document.querySelectorAll('[class*="productVariationCarousel__item"] img');
        const seen = new Set<string>();
        for (const img of Array.from(figures)) {
          const src = img.getAttribute('src') || '';
          if (!src || seen.has(src)) continue;
          seen.add(src);

          // Decode color name from filename: masterpiece120_1レッドヘッド.png
          try {
            const decoded = decodeURIComponent(src);
            const filenameMatch = decoded.match(/\/[^/]+_\d+(.+)\.\w+(?:\?|$)/);
            const colorName = filenameMatch ? filenameMatch[1].trim() : '';
            if (colorName) {
              colors.push({ name: colorName, imageUrl: src });
            }
          } catch {
            colors.push({ name: `カラー${colors.length + 1}`, imageUrl: src });
          }
        }
      }

      // --- Main image ---
      let mainImageUrl = '';
      const mainPicture = document.querySelector('[class*="productSingleHeader__image"] img, [class*="ProductSingle"] picture img');
      if (mainPicture) {
        mainImageUrl = mainPicture.getAttribute('src') || '';
      }
      // Fallback: any MicroCMS image in header area
      if (!mainImageUrl) {
        const headerImgs = document.querySelectorAll('img[src*="microcms-assets"]');
        for (const img of headerImgs) {
          const src = img.getAttribute('src') || '';
          if (src && !src.includes('logo') && !src.includes('icon')) {
            mainImageUrl = src;
            break;
          }
        }
      }

      return {
        name,
        genreLabels,
        typeLabel,
        priceText,
        specText,
        description,
        colors,
        mainImageUrl,
      };
    });

    log(`Extracted: name="${pageData.name}", genres=${pageData.genreLabels.join(',')}, type="${pageData.typeLabel}", colors=${pageData.colors.length}`);

    // ----- Post-process extracted data -----
    const slug = extractSlug(url);
    const name = pageData.name || slug;
    const type = detectType(pageData.typeLabel, name);
    const targetFish = deriveTargetFish(pageData.genreLabels);
    const price = parsePrice(pageData.priceText);
    const weights = parseWeights(pageData.specText);
    const length = parseLength(pageData.specText);

    // Process colors
    const colors: ScrapedColor[] = pageData.colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl.startsWith('http') ? c.imageUrl : `${APIA_BASE_URL}${c.imageUrl}`,
    }));

    // Main image URL
    let mainImage = pageData.mainImageUrl;
    if (mainImage && !mainImage.startsWith('http')) {
      mainImage = `${APIA_BASE_URL}${mainImage}`;
    }

    const result: ScrapedLure = {
      name,
      name_kana: name,
      slug,
      manufacturer: 'APIA',
      manufacturer_slug: 'apia',
      type,
      target_fish: targetFish,
      description: pageData.description,
      price,
      colors,
      weights,
      length,
      mainImage: mainImage || '',
      sourceUrl: url,
    };

    log(`Done: ${name} | type=${type} | fish=${targetFish.join(',')} | price=${price} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
