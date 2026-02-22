// scripts/scrapers/pazdesign.ts
// Pazdesign (reed brand) product page scraper
// Handles lure products from pazdesign.co.jp/products/reed/{slug}/
//
// Site: Static HTML + jQuery, no WAF, headless OK.
// Images: self-hosted /products/reed/{slug}/img/{number}.jpg
// Price format: "¥2,700（税込¥2,970）" — TAX-INCLUDED price used directly
// Spec format: "label：value" pairs in body text (length, weight, type, etc.)
// Colors: ul.thumb li img thumbnails + "#001 カラー名" text patterns

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAZDESIGN_BASE_URL = 'https://pazdesign.co.jp';

// ---------------------------------------------------------------------------
// Type detection: product name keyword-based
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/紅雫|benishizuku/i, 'タイラバ'],
  [/kaisey|ケイシー|海晴/i, 'メタルジグ'],
  [/grand\s*soldier|グランソルジャー|ultimate.*230|アルティメット.*230/i, 'ビッグベイト'],
  [/backwash|バックウォッシュ|labra|ラブラ/i, 'シンキングペンシル'],
  [/feel|フィール/i, 'シンキングペンシル'],
  [/rebird|リ・バード|リバード/i, 'ミノー'],
  [/dibule|ディブル/i, 'ミノー'],
  [/albatross|アルバトロス/i, 'ミノー'],
  [/matchbow|マッチボウ/i, 'ミノー'],
  [/akane|アカネ/i, 'ミノー'],
  [/zubat|ズバット/i, 'ミノー'],
  [/el\s*caliber|エルキャリバー/i, 'ミノー'],
  [/stream\s*beyond|ストリームビヨンド/i, 'ミノー'],
  [/ultimate|アルティメット/i, 'ミノー'],
  [/fallon|ファロン/i, 'ミノー'],
];

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

const TARGET_FISH_KEYWORDS: [RegExp, string[]][] = [
  [/紅雫|benishizuku|タイラバ/i, ['マダイ']],
  [/grand\s*soldier|グランソルジャー|ultimate.*230|アルティメット.*230/i, ['シーバス', '青物']],
  [/backwash|バックウォッシュ|feel|フィール/i, ['シーバス']],
  [/sakuramasu|サクラマス/i, ['サクラマス']],
  [/kaisey|ケイシー|海晴|rebird|リ・バード|dibule|ディブル|albatross|アルバトロス/i, ['トラウト']],
  [/matchbow|マッチボウ|akane|アカネ/i, ['トラウト']],
  [/labra|ラブラ/i, ['シーバス']],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [pazdesign] ${message}`);
}

/**
 * Extract product slug from URL.
 * /products/reed/grandsoldier/ → "grandsoldier"
 */
function extractSlug(url: string): string {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/\/products\/reed\/([^/?#]+)/);
  if (match) return match[1].toLowerCase().replace(/\/$/, '');
  // Fallback: last non-empty path segment
  const segments = new URL(decoded).pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] || '').toLowerCase();
}

/**
 * Detect lure type from product name and spec text.
 */
function detectType(name: string, specType: string): string {
  const combined = `${name} ${specType}`;

  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }

  // Fallback: use spec type field if available
  if (/フローティング|floating/i.test(specType)) return 'ミノー';
  if (/シンキング|sinking/i.test(specType)) return 'シンキングペンシル';

  return 'ルアー';
}

/**
 * Detect target fish from product name and slug only.
 * Do NOT use bodyText/description — it contains navigation text from other products
 * which causes false matches (e.g., REBIRD page contains "BackWash" in nav → detects as seabass).
 */
function detectTargetFish(name: string, slug: string): string[] {
  const combined = `${name} ${slug}`;

  for (const [pattern, fish] of TARGET_FISH_KEYWORDS) {
    if (pattern.test(combined)) return fish;
  }

  // Default for reed brand: trout specialist
  return ['トラウト'];
}

/**
 * Parse tax-included price from text.
 * "¥2,700（税込¥2,970）" → 2970
 * "¥780（税込￥858）" → 858
 */
function parsePriceIncTax(text: string): number {
  if (!text) return 0;
  // Try to match tax-included price first
  const incTaxMatch = text.match(/税込[¥￥]([\d,]+)/);
  if (incTaxMatch) {
    const price = parseInt(incTaxMatch[1].replace(/,/g, ''), 10);
    if (price >= 100 && price < 1000000) return price;
  }
  // Fallback: take the first ¥ price and multiply by 1.1
  const exTaxMatch = text.match(/[¥￥]([\d,]+)/);
  if (exTaxMatch) {
    const priceExTax = parseInt(exTaxMatch[1].replace(/,/g, ''), 10);
    if (priceExTax >= 100 && priceExTax < 1000000) {
      return Math.floor(priceExTax * 1.1);
    }
  }
  return 0;
}

/**
 * Parse weights from spec text.
 * "weight：12.5g" → [12.5]
 * "weight：18g / 30g" → [18, 30]
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
 * "length：90mm" → 90
 * "length：60mm（アイを除く）" → 60
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

export async function scrapePazdesignPage(url: string): Promise<ScrapedLure> {
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

    // Wait for jQuery to finish loading content
    await page.waitForTimeout(3000);

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate((baseUrl: string) => {
      // --- Product name from <title> or <h1> ---
      let name = '';
      const titleText = document.title || '';
      // Format: "Pazdesign | PRODUCTS | reed グランソルジャー 190F"
      const reedIdx = titleText.indexOf('reed ');
      if (reedIdx >= 0) {
        name = titleText.substring(reedIdx + 5).trim();
      }
      // Fallback: h1 text
      if (!name) {
        const h1 = document.querySelector('h1');
        name = h1?.textContent?.trim() || '';
      }
      // Fallback: first h2 or h3
      if (!name) {
        const h = document.querySelector('h2, h3');
        name = h?.textContent?.trim() || '';
      }

      // --- Description ---
      let description = '';
      // Look for substantial text paragraphs (skip spec blocks and navigation)
      const allPs = document.querySelectorAll('p');
      for (const p of allPs) {
        const text = p.textContent?.trim() || '';
        if (text.length > 50 &&
            !text.includes('length：') &&
            !text.includes('weight：') &&
            !text.includes('¥') &&
            !text.includes('hook：') &&
            !text.includes('VEST -') &&
            !text.includes('WEAR -') &&
            !text.includes('ACCESSORY') &&
            !text.includes('BAG & CASE') &&
            !text.includes('CAP & HAT') &&
            !text.includes('Copyright') &&
            !text.includes('pazdesign.co.jp')) {
          description = text.substring(0, 500);
          break;
        }
      }
      // Fallback: meta description
      if (!description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        description = metaDesc?.getAttribute('content')?.trim()?.substring(0, 500) || '';
      }

      // --- Spec text extraction (label：value pairs) ---
      const bodyText = document.body.innerText || '';

      let lengthText = '';
      let weightText = '';
      let specType = '';
      let rangeText = '';
      let priceText = '';

      // Extract spec fields
      const lengthMatch = bodyText.match(/length[：:]\s*(.+?)(?:\n|$)/i);
      if (lengthMatch) lengthText = lengthMatch[1].trim();

      const weightMatch = bodyText.match(/weight[：:]\s*(.+?)(?:\n|$)/i);
      if (weightMatch) weightText = weightMatch[1].trim();

      const typeMatch = bodyText.match(/type[：:]\s*(.+?)(?:\n|$)/i);
      if (typeMatch) specType = typeMatch[1].trim();

      const rangeMatch = bodyText.match(/range[：:]\s*(.+?)(?:\n|$)/i);
      if (rangeMatch) rangeText = rangeMatch[1].trim();

      // Price: look for tax-included format
      const priceMatch = bodyText.match(/[¥￥][\d,]+[^）]*税込[¥￥][\d,]+[）)]/);
      if (priceMatch) {
        priceText = priceMatch[0];
      } else {
        // Broader match
        const broaderPriceMatch = bodyText.match(/[¥￥][\d,]+/);
        if (broaderPriceMatch) priceText = broaderPriceMatch[0];
      }

      // --- Colors from thumbnails ---
      const colors: { name: string; imageUrl: string }[] = [];
      const thumbImgs = document.querySelectorAll('ul.thumb li img, .thumb li img');
      const seenSrcs = new Set<string>();

      // Track color index separately (only for actual color images)
      let colorIndex = 0;

      for (let i = 0; i < thumbImgs.length; i++) {
        const img = thumbImgs[i] as HTMLImageElement;
        const src = img.getAttribute('src') || '';
        if (!src || seenSrcs.has(src)) continue;

        // Only accept color images: img/{digits}.jpg pattern
        // Skip catch reports (img/a1.jpg), product shots (img/image.jpg), etc.
        if (!/img\/\d+\.jpg$/i.test(src)) continue;

        seenSrcs.add(src);
        colorIndex++;

        // Build full URL
        const fullSrc = src.startsWith('http')
          ? src
          : `${window.location.href.replace(/\/$/, '')}/${src.replace(/^\.\//, '')}`;

        // Try to get color name from alt text
        let colorName = img.getAttribute('alt')?.trim() || '';

        // Fallback: try to find #NNN pattern in nearby text
        if (!colorName) {
          const index = String(colorIndex).padStart(3, '0');
          // Look for "#NNN colorname" pattern in body text
          const colorNameMatch = bodyText.match(new RegExp(`#${index}\\s+(.+?)(?:\\n|$)`));
          if (colorNameMatch) {
            colorName = `#${index} ${colorNameMatch[1].trim()}`;
          } else {
            // Use simple number
            colorName = `#${index}`;
          }
        }

        colors.push({ name: colorName, imageUrl: fullSrc });
      }

      // --- Main image ---
      let mainImageUrl = '';
      // Try main gallery first color image (img/{digits}.jpg pattern)
      const mainGalleryImgs = document.querySelectorAll('ul.main li img, .main li img');
      for (const img of mainGalleryImgs) {
        const src = (img as HTMLImageElement).getAttribute('src') || '';
        if (/img\/\d+\.jpg$/i.test(src)) {
          mainImageUrl = src.startsWith('http')
            ? src
            : `${window.location.href.replace(/\/$/, '')}/${src.replace(/^\.\//, '')}`;
          break;
        }
      }
      // Fallback: first significant img
      if (!mainImageUrl) {
        const allImgs = document.querySelectorAll('img');
        for (const img of allImgs) {
          const src = img.getAttribute('src') || '';
          if (src.includes('/img/') && !src.includes('logo')) {
            mainImageUrl = src.startsWith('http')
              ? src
              : `${window.location.href.replace(/\/$/, '')}/${src.replace(/^\.\//, '')}`;
            break;
          }
        }
      }

      return {
        name,
        description,
        lengthText,
        weightText,
        specType,
        rangeText,
        priceText,
        colors,
        mainImageUrl,
        bodyText: bodyText.substring(0, 3000), // For target fish detection
      };
    }, PAZDESIGN_BASE_URL);

    log(`Extracted: name="${pageData.name}", colors=${pageData.colors.length}, specType="${pageData.specType}"`);

    // ----- Post-process extracted data -----
    const slug = extractSlug(url);
    const name = pageData.name || slug.replace(/[-_]/g, ' ');
    const specType = pageData.specType;
    const type = detectType(name, specType);
    const price = parsePriceIncTax(pageData.priceText);

    // Parse specs
    const weights = parseWeights(pageData.weightText);
    const length = parseLength(pageData.lengthText);

    // Target fish — use name + slug only (bodyText contains nav text from other products)
    const targetFish = detectTargetFish(name, slug);

    // Colors — fix relative URLs
    const colors: ScrapedColor[] = pageData.colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl,
    }));

    // Main image
    const mainImage = pageData.mainImageUrl || (colors.length > 0 ? colors[0].imageUrl : '');

    const result: ScrapedLure = {
      name,
      name_kana: name,
      slug,
      manufacturer: 'Pazdesign',
      manufacturer_slug: 'pazdesign',
      type,
      target_fish: targetFish,
      description: pageData.description,
      price,
      colors,
      weights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(`Done: ${name} | type=${type} | price=${price} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | fish=${targetFish.join(',')}`);

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
