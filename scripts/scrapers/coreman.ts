// scripts/scrapers/coreman.ts
// COREMAN product page scraper
// Handles lure products from www.coreman.jp/product_lure/{slug}/
//
// Site: WordPress + Elementor, no WAF, headless OK.
// Images: self-hosted /img/product/{folder}/ and /wp-content/uploads/
// Price format: "1400円（税別）" — TAX-EXCLUDED → multiply by 1.1
// Spec format: Plain text block with "■ LURE SPEC ■" or "■ SPEC ■" marker
// Colors: Thumbnail grid with img[src*="/color-"] and adjacent text

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COREMAN_BASE_URL = 'https://www.coreman.jp';

// ---------------------------------------------------------------------------
// Type detection: category name + product name keyword-based
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/バイブレーション\s*ジグヘッド|VIBRATION\s*JIGHEAD|VJ-/i, 'バイブレーションジグヘッド'],
  [/ローリング\s*ジグヘッド|ROLLING\s*JIGHEAD|RJ-/i, 'ローリングジグヘッド'],
  [/アイアン\s*ジグヘッド|IRON\s*JIGHEAD|IJ-/i, 'アイアンジグヘッド'],
  [/パワーブレード|POWER\s*BLADE|PB-/i, 'ブレードベイト'],
  [/アイアンプレート|IRON\s*PLATE|IP-/i, 'メタルバイブ'],
  [/バックチャッター|BACK\s*CHATTER|BC-/i, 'バイブレーション'],
  [/ゼッタイ|ZETTAI|CZ-/i, 'メタルジグ'],
  [/パワーヘッド|POWER\s*HEAD|PH-/i, 'ジグヘッド'],
  [/ダートヘッド|DART\s*HEAD/i, 'ジグヘッド'],
  [/アルカリ\s*シャッド|ALKALI\s*SHAD/i, 'ワーム'],
  [/アルカリ|ALKALI/i, 'ワーム'],
  [/シルバークロー|SILVER\s*CLAW/i, 'フック'],
  [/ブースター|BOOSTER/i, 'ブレードベイト'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [coreman] ${message}`);
}

/**
 * Extract product slug from URL.
 * /product_lure/vj-16-vibration-jighead/ → "vj-16-vibration-jighead"
 */
function extractSlug(url: string): string {
  // Decode URL-encoded characters first
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/\/product_lure\/([^/?#]+)/);
  if (match) return match[1].toLowerCase().replace(/\/$/, '');
  // Fallback: last non-empty path segment
  const segments = new URL(decoded).pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] || '').toLowerCase();
}

/**
 * Detect lure type from category heading and product name.
 */
function detectType(categoryText: string, name: string): string {
  const combined = `${categoryText} ${name}`;

  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }

  return 'ルアー';
}

/**
 * Parse price from COREMAN format (TAX-EXCLUDED).
 * "1400円（税別）" → 1540 (× 1.1)
 * "1400JPY（+Tax）" → 1540
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/,/g, '');
  const match = cleaned.match(/(\d{3,})\s*(?:円|JPY)/);
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
 * "WEIGHT: 16g" → [16]
 * "WEIGHT: HEAD 16g / WORM 3g" → [16, 3]
 * "26g" → [26]
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
 * "LENGTH: 95mm" → 95
 * "60mm" → 60
 */
function parseLength(text: string): number | null {
  if (!text) return null;

  // mm format
  const mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }

  // cm format fallback
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

export async function scrapeCoremanPage(url: string): Promise<ScrapedLure> {
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

    // Wait for Elementor content to render
    await page.waitForSelector('.e-con', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate((baseUrl: string) => {
      // --- Product name from <title> ---
      let name = '';
      const titleText = document.title || '';
      // Format: "VJ-16 VIBRATIONJIGHEAD | COREMAN - コアマン公式サイト"
      const pipeIdx = titleText.indexOf(' | ');
      if (pipeIdx > 0) {
        name = titleText.substring(0, pipeIdx).trim();
      }
      // Fallback: first h1 or h2
      if (!name) {
        const h = document.querySelector('h1, h2');
        name = h?.textContent?.trim() || '';
      }

      // --- Breadcrumb for category info ---
      let breadcrumbText = '';
      // JSON-LD BreadcrumbList
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent || '');
          if (json['@type'] === 'BreadcrumbList' && json.itemListElement) {
            breadcrumbText = json.itemListElement
              .map((item: { name: string }) => item.name)
              .join(' > ');
          }
        } catch { /* ignore */ }
      }

      // --- Description ---
      let description = '';
      // Look for substantial text paragraphs (skip spec blocks)
      // Try Elementor first, then fallback to classic WP selectors
      const descSelectors = [
        '.e-con p', '.e-con .elementor-widget-text-editor',
        '.entry-content p', '.post-content p', 'article p', '.page-content p',
      ];
      const allText = document.querySelectorAll(descSelectors.join(', '));
      for (const el of allText) {
        const text = el.textContent?.trim() || '';
        if (text.length > 50 &&
            !text.includes('■ LURE SPEC') &&
            !text.includes('■ SPEC') &&
            !text.includes('■ SYSTEM SPEC') &&
            !text.includes('LENGTH') &&
            !text.includes('WEIGHT') &&
            !/^\d+円/.test(text)) {
          description = text.substring(0, 500);
          break;
        }
      }
      // Fallback: meta description
      if (!description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        description = metaDesc?.getAttribute('content')?.trim()?.substring(0, 500) || '';
      }

      // --- Spec text (everything after ■ LURE SPEC ■ or ■ SPEC ■ or ■ SYSTEM SPEC ■) ---
      let specText = '';
      const bodyText = document.body.innerText || '';
      const specMarkerMatch = bodyText.match(/■\s*(?:LURE\s+|SYSTEM\s+)?SPEC\s*■([\s\S]*?)(?=■|カラーチャート|Color|$)/i);
      if (specMarkerMatch) {
        specText = specMarkerMatch[1].trim().substring(0, 1000);
      }

      // --- Price from spec block or body text ---
      let priceText = '';
      // Look for price pattern in spec text first
      const priceMatch = bodyText.match(/(?:PRICE\s*[：:]\s*)?(\d[\d,]*)\s*(?:円\s*[（(]\s*税別|JPY\s*[（(]\s*\+\s*Tax)/);
      if (priceMatch) {
        priceText = priceMatch[0];
      }

      // --- Colors ---
      const colors: { name: string; imageUrl: string }[] = [];

      // COREMAN uses TWO color markup patterns:
      //   Pattern A (VJ-16 etc): <figure class="wp-caption"><img/><figcaption>name</figcaption></figure>
      //   Pattern B (BC-26, IP-26): <div|p><img/></div|p> followed by <p>name</p>
      const colorImgs = document.querySelectorAll('img[src*="/color-"]');
      const seenColors = new Set<string>();

      for (const img of colorImgs) {
        const src = img.getAttribute('src') || '';
        if (seenColors.has(src)) continue;
        seenColors.add(src);

        const fullSrc = src.startsWith('http') ? src : `${baseUrl}${src}`;

        let colorName = '';
        const parent = img.parentElement;

        if (parent) {
          // Pattern A: parent is <figure>, look for <figcaption> child
          if (parent.tagName === 'FIGURE') {
            const caption = parent.querySelector('figcaption');
            if (caption) {
              colorName = caption.textContent?.trim() || '';
            }
          }

          // Pattern B: parent is <div> or <p>, look for next sibling <p>
          if (!colorName) {
            const nextSibling = parent.nextElementSibling;
            if (nextSibling && nextSibling.tagName === 'P') {
              const sibText = nextSibling.textContent?.trim() || '';
              // Verify it looks like a color name (starts with # or contains /)
              if (/^#\d/.test(sibText) || sibText.includes('/')) {
                colorName = sibText;
              }
            }
          }
        }

        // Fallback 1: alt attribute (some pages populate it)
        if (!colorName) {
          const alt = img.getAttribute('alt') || '';
          if (alt && alt.length > 0) {
            colorName = alt;
          }
        }

        // Fallback 2: extract color number from filename
        if (!colorName) {
          const filenameMatch = src.match(/color-(\d+)/);
          if (filenameMatch) {
            colorName = `#${filenameMatch[1]}`;
          }
        }

        colors.push({ name: colorName, imageUrl: fullSrc });
      }

      // --- Fallback color extraction: figures after COLOR LINEUP marker ---
      if (colors.length === 0) {
        // Find the figure that contains "COLOR LINEUP" in its caption
        const allFigures = document.querySelectorAll('figure');
        let colorStartIdx = -1;
        for (let fi = 0; fi < allFigures.length; fi++) {
          const caption = allFigures[fi].querySelector('figcaption');
          if (caption && /COLOR\s*LINEUP/i.test(caption.textContent || '')) {
            colorStartIdx = fi + 1; // Colors start from the NEXT figure
            break;
          }
        }
        if (colorStartIdx >= 0) {
          for (let fi = colorStartIdx; fi < allFigures.length; fi++) {
            const img = allFigures[fi].querySelector('img');
            const caption = allFigures[fi].querySelector('figcaption');
            if (img && caption) {
              const src = img.getAttribute('src') || '';
              const capText = (caption.textContent || '').trim();
              // Only take entries that look like color names: "#NNN name" or short text
              if (src && capText && /^#\d+/.test(capText)) {
                const fullSrc = src.startsWith('http') ? src : `${baseUrl}${src}`;
                if (!seenColors.has(fullSrc)) {
                  seenColors.add(fullSrc);
                  colors.push({ name: capText, imageUrl: fullSrc });
                }
              }
            }
          }
        }
        // Fallback: parse COLOR LINEUP text and pair with first product image
        if (colors.length === 0) {
          const colorLineupMatch = bodyText.match(/COLOR\s*LINEUP\s*■?([\s\S]*?)$/i);
          if (colorLineupMatch) {
            const colorEntries = colorLineupMatch[1].match(/#\d+\s+[^\n#]+/g);
            if (colorEntries) {
              const wpImgs = document.querySelectorAll('img[src*="/wp-content/uploads/"]');
              let mainImg = '';
              for (const img of wpImgs) {
                const src = img.getAttribute('src') || '';
                if (src.includes('1024x1024') && !src.includes('logo')) {
                  mainImg = src.startsWith('http') ? src : `${baseUrl}${src}`;
                  break;
                }
              }
              for (let ci = 0; ci < colorEntries.length; ci++) {
                const cName = colorEntries[ci].trim();
                if (cName && mainImg) {
                  colors.push({ name: cName, imageUrl: mainImg });
                }
              }
            }
          }
        }
      }

      // --- Main image ---
      let mainImageUrl = '';
      // Look for main-img pattern
      const mainImg = document.querySelector('img[src*="main-img"]');
      if (mainImg) {
        mainImageUrl = mainImg.getAttribute('src') || '';
      }
      // Fallback: first substantial product image from /img/product/
      if (!mainImageUrl) {
        const productImgs = document.querySelectorAll('img[src*="/img/product/"]');
        for (const img of productImgs) {
          const src = img.getAttribute('src') || '';
          if (!src.includes('/color-')) {
            mainImageUrl = src;
            break;
          }
        }
      }
      // Fallback: wp-content product image
      if (!mainImageUrl) {
        const wpImgs = document.querySelectorAll('img[src*="/wp-content/uploads/"]');
        for (const img of wpImgs) {
          const src = img.getAttribute('src') || '';
          const width = parseInt(img.getAttribute('width') || '0', 10);
          if (width > 200 || src.includes('resize')) {
            mainImageUrl = src;
            break;
          }
        }
      }

      if (mainImageUrl && !mainImageUrl.startsWith('http')) {
        mainImageUrl = `${baseUrl}${mainImageUrl}`;
      }

      // --- Multi-variant spec blocks ---
      // Some pages (e.g., IRON PLATE SC) list multiple variants
      // Try to extract individual variant specs
      const variantSpecs: { name: string; length: string; weight: string; price: string }[] = [];

      // Pattern: "IP-13 / IP-18 / IP-26" with separate spec blocks
      const specSections = bodyText.split(/■\s*(?:LURE\s+)?SPEC\s*■/i);
      for (let i = 1; i < specSections.length; i++) {
        const section = specSections[i].substring(0, 500);
        const lengthMatch = section.match(/LENGTH\s*[：:]\s*([\d.]+\s*mm)/i);
        const weightMatch = section.match(/WEIGHT\s*[：:]?\s*(.*?)(?:\n|$)/i);
        const priceMatchLocal = section.match(/(?:PRICE\s*[：:]\s*)?(\d[\d,]*)\s*(?:円|JPY)/);

        variantSpecs.push({
          name: '',
          length: lengthMatch ? lengthMatch[1] : '',
          weight: weightMatch ? weightMatch[1] : '',
          price: priceMatchLocal ? priceMatchLocal[0] : '',
        });
      }

      return {
        name,
        breadcrumbText,
        description,
        specText,
        priceText,
        colors,
        mainImageUrl,
        variantSpecs,
      };
    }, COREMAN_BASE_URL);

    log(`Extracted: name="${pageData.name}", colors=${pageData.colors.length}, variants=${pageData.variantSpecs.length}`);

    // ----- Post-process extracted data -----
    const slug = extractSlug(url);
    const name = pageData.name || slug.replace(/-/g, ' ');
    const type = detectType(pageData.breadcrumbText, name);
    const price = parsePrice(pageData.priceText);

    // Parse specs
    const weights = parseWeights(pageData.specText);
    const length = parseLength(pageData.specText);

    // If main spec block didn't have data, try variant specs
    let finalWeights = weights;
    let finalLength = length;
    let finalPrice = price;

    if (pageData.variantSpecs.length > 0 && (weights.length === 0 || length === null)) {
      for (const vs of pageData.variantSpecs) {
        if (finalWeights.length === 0) {
          finalWeights = parseWeights(vs.weight);
        }
        if (finalLength === null) {
          finalLength = parseLength(vs.length);
        }
        if (finalPrice === 0) {
          finalPrice = parsePrice(vs.price);
        }
      }
    }

    // Colors
    const colors: ScrapedColor[] = pageData.colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl.startsWith('http') ? c.imageUrl : `${COREMAN_BASE_URL}${c.imageUrl}`,
    }));

    // Main image
    let mainImage = pageData.mainImageUrl;
    if (mainImage && !mainImage.startsWith('http')) {
      mainImage = `${COREMAN_BASE_URL}${mainImage}`;
    }
    // Fallback to first color image
    if (!mainImage && colors.length > 0) {
      mainImage = colors[0].imageUrl;
    }

    // Fallback: if 0 colors but mainImage exists, create default color entry
    if (colors.length === 0 && mainImage) {
      log('Warning: 0 colors found, creating default entry from main image');
      colors.push({ name, imageUrl: mainImage });
    }

    // COREMAN is a seabass-specialist brand
    const targetFish = ['シーバス'];

    const result: ScrapedLure = {
      name,
      name_kana: name,
      slug,
      manufacturer: 'COREMAN',
      manufacturer_slug: 'coreman',
      type,
      target_fish: targetFish,
      description: pageData.description,
      price: finalPrice,
      colors,
      weights: finalWeights,
      length: finalLength,
      mainImage: mainImage || '',
      sourceUrl: url,
    };

    log(`Done: ${name} | type=${type} | price=${finalPrice} | colors=${colors.length} | weights=[${finalWeights.join(',')}] | length=${finalLength}mm`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
