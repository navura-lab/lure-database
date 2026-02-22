// scripts/scrapers/gancraft.ts
// GANCRAFT product page scraper
// Handles lure products from gancraft.com/lures/{slug}.html
//
// Site: Static HTML + jQuery, EUC-JP encoding, no WAF, headless OK.
// Images: self-hosted /image/item/{folder}/mini/{code}_mini.jpg (colors)
// Price format: "￥5,000(税抜)\n￥5,500(税込)" — TAX-INCLUDED price used
// Spec: table inside div.spec (Length/Weight/Price columns, variable headers)
// Colors: div.color table td — each td has <a><img></a><p>#NN name</p>

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GANCRAFT_BASE = 'https://gancraft.com';

// ---------------------------------------------------------------------------
// Type detection: product name / slug keyword-based
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/jointed\s*claw|jointedclaw|鮎邪|rippleclaw/i, 'ビッグベイト'],
  [/shift\s*\d|shift\d/i, 'ビッグベイト'],
  [/magnum/i, 'ビッグベイト'],
  [/shaku.?one|尺ワン|jc303/i, 'ビッグベイト'],
  [/zepro/i, 'ビッグベイト'],
  [/ratchet/i, 'ビッグベイト'],
  [/joicrawler/i, 'ビッグベイト'],
  [/deadslow/i, 'ビッグベイト'],
  [/paradox/i, 'ビッグベイト'],
  [/s-caper|scaper/i, 'ペンシルベイト'],
  [/z-claw/i, 'ペンシルベイト'],
  [/s-song/i, 'ペンシルベイト'],
  [/ayrton|エアートン/i, 'クランクベイト'],
  [/bacra/i, 'クランクベイト'],
  [/kaiten|回天/i, 'クランクベイト'],
  [/screwbait/i, 'クランクベイト'],
  [/rest\d|rest128|ayuja/i, 'ミノー'],
  [/osa\d|osa80|osa115/i, 'ミノー'],
  [/kikumoto/i, 'ミノー'],
  [/betty/i, 'シャッド'],
  [/killer.?bait|killers.?bait/i, 'スピナーベイト'],
  [/killer.?buzz|killers.?buzz/i, 'バズベイト'],
  [/bomb.?slide/i, 'フロッグ'],
  [/bigspider/i, 'フロッグ'],
  [/kabrata/i, 'チャターベイト'],
  [/corehead/i, 'ジグ'],
  [/bariki|バリキ/i, 'ワーム'],
  [/shape-s|shapes/i, 'ワーム'],
];

// ---------------------------------------------------------------------------
// Target fish detection — category-based + product name
// ---------------------------------------------------------------------------

const TARGET_FISH_KEYWORDS: [RegExp, string[]][] = [
  [/sw$|salt\s*water|ソルト/i, ['シーバス', '青物']],
  [/jyashin|鮎邪.*ayu|ayu/i, ['アユ']],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [gancraft] ${message}`);
}

/**
 * Extract product slug from URL.
 * /lures/jointedclaw178.html → "jointedclaw178"
 * /lures/jointedclaw-shift263/ → "jointedclaw-shift263"
 */
function extractSlug(url: string): string {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/\/lures\/([^/?#]+?)(?:\.html)?$/);
  if (match) return match[1].toLowerCase().replace(/\/$/, '');
  const segments = new URL(decoded).pathname.split('/').filter(Boolean);
  return (segments[segments.length - 1] || '').toLowerCase().replace(/\.html$/, '');
}

/**
 * Detect lure type from product name and slug.
 */
function detectType(name: string, slug: string): string {
  const combined = `${name} ${slug}`;
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }
  return 'ルアー';
}

/**
 * Detect target fish from category text and product name/slug.
 */
function detectTargetFish(name: string, slug: string, category: string): string[] {
  const combined = `${name} ${slug} ${category}`;

  for (const [pattern, fish] of TARGET_FISH_KEYWORDS) {
    if (pattern.test(combined)) return fish;
  }

  // Default by category
  if (/salt\s*water/i.test(category)) return ['シーバス', '青物'];
  if (/ayu/i.test(category)) return ['アユ'];
  // Default: bass
  return ['ブラックバス'];
}

/**
 * Parse tax-included price from text.
 * "￥5,500(税込)" → 5500
 * "\1,430-(税込)" → 1430
 * "￥6,800-(税抜)/ ￥7,480-(税込)" → 7480
 */
function parsePriceIncTax(text: string): number {
  if (!text) return 0;

  // Try to match tax-included price: ￥N,NNN(税込) or \N,NNN-(税込)
  const incTaxMatch = text.match(/[￥¥\\]([\d,]+)-?\s*[（(]税込[）)]/);
  if (incTaxMatch) {
    const price = parseInt(incTaxMatch[1].replace(/,/g, ''), 10);
    if (price >= 100 && price < 1000000) return price;
  }

  // Also try: 税込 prefix pattern
  const incTaxMatch2 = text.match(/税込[）)]\s*[￥¥\\]([\d,]+)/);
  if (incTaxMatch2) {
    const price = parseInt(incTaxMatch2[1].replace(/,/g, ''), 10);
    if (price >= 100 && price < 1000000) return price;
  }

  // Fallback: tax-excluded price × 1.1
  const exTaxMatch = text.match(/[￥¥\\]([\d,]+)/);
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
 * "2oz class" → [56.7]  (1oz = 28.35g)
 * "約7.3g" → [7.3]
 * "1・1/16oz class" → [30.1]
 * "約42g" → [42]
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];

  // Match gram values: "約7.3g", "42g"
  const gMatches = text.matchAll(/約?([\d.]+)\s*g/gi);
  for (const m of gMatches) {
    const w = parseFloat(m[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }

  // Match oz values: "2oz", "1・1/16oz"
  if (weights.length === 0) {
    // Simple oz: "2oz", "2.5oz"
    const ozMatch = text.match(/([\d.]+)\s*oz/i);
    if (ozMatch) {
      const oz = parseFloat(ozMatch[1]);
      if (oz > 0 && oz < 100) weights.push(Math.round(oz * 28.35 * 10) / 10);
    }
    // Fraction oz: "1・1/16oz"
    const fracMatch = text.match(/(\d+)[・](\d+)\/(\d+)\s*oz/i);
    if (fracMatch) {
      const whole = parseInt(fracMatch[1], 10);
      const num = parseInt(fracMatch[2], 10);
      const den = parseInt(fracMatch[3], 10);
      const oz = whole + num / den;
      if (oz > 0 && oz < 100) weights.push(Math.round(oz * 28.35 * 10) / 10);
    }
  }

  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Parse length from spec text.
 * "178mm" → 178
 * "6.8inch" → 173 (mm)
 * "180mm class" → 180
 * "63mm" → 63
 */
function parseLength(text: string): number | null {
  if (!text) return null;

  // mm format
  const mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }

  // inch format
  const inchMatch = text.match(/([\d.]+)\s*inch/i);
  if (inchMatch) {
    const mm = Math.round(parseFloat(inchMatch[1]) * 25.4);
    if (mm > 0 && mm < 5000) return mm;
  }

  // cm format
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

export async function scrapeGancraftPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

    // Wait for static content to render
    await page.waitForTimeout(2000);

    // ----- Extract all data in a single page.evaluate -----
    const pageData = await page.evaluate(() => {
      const BASE = 'https://gancraft.com/';

      // --- Product name from breadcrumb (#topicPath) ---
      let name = '';
      let category = '';
      const topicPath = document.querySelector('#topicPath');
      if (topicPath) {
        const text = topicPath.textContent || '';
        const parts = text.split('>').map(s => s.trim());
        // Last segment is product name
        if (parts.length >= 2) {
          name = parts[parts.length - 1].trim();
        }
        // Category is second segment (BASS, SALTWATER, AYU)
        if (parts.length >= 3) {
          category = parts[1].trim();
        }
      }

      // Fallback: alt of main image
      if (!name) {
        const mainImg = document.querySelector('#item_top img, #category_right > div:first-child img');
        name = mainImg?.getAttribute('alt')?.trim() || '';
      }

      // --- Description ---
      let description = '';
      const itemTextP = document.querySelector('.item_text > p');
      if (itemTextP) {
        description = (itemTextP.textContent || '').trim().substring(0, 500);
      }
      // Fallback: item_text_top
      if (!description) {
        const tagline = document.querySelector('.item_text_top');
        description = (tagline?.textContent || '').trim().substring(0, 500);
      }

      // --- Spec table ---
      let lengthText = '';
      let weightText = '';
      let priceText = '';
      const specTable = document.querySelector('.spec table');
      if (specTable) {
        const ths = Array.from(specTable.querySelectorAll('th')).map(
          th => (th.textContent || '').trim().toLowerCase(),
        );
        const tds = Array.from(specTable.querySelectorAll('tr:nth-child(2) td'));

        ths.forEach((header, i) => {
          const td = tds[i];
          if (!td) return;
          const val = (td.textContent || '').trim();
          if (header.includes('length') || header === 'size') {
            if (!lengthText) lengthText = val;
          } else if (header.includes('weight')) {
            if (!weightText) weightText = val;
          } else if (header.includes('price')) {
            if (!priceText) priceText = val;
          }
        });

        // If multiple rows (multiple spec variants), check for additional weight/price
        const allRows = specTable.querySelectorAll('tr');
        for (let r = 2; r < allRows.length; r++) {
          const rowTds = allRows[r].querySelectorAll('td');
          rowTds.forEach((td, i) => {
            const header = ths[i] || '';
            const val = (td.textContent || '').trim();
            if (header.includes('weight') && val) {
              weightText += ' / ' + val;
            }
          });
        }
      }

      // --- Colors from div.color table td ---
      const colors: { name: string; imageUrl: string }[] = [];
      const colorTds = document.querySelectorAll('.color table td');
      const seenNames = new Set<string>();

      for (const td of colorTds) {
        // Color name from <p> text
        const pEl = td.querySelector('p');
        let colorName = (pEl?.textContent || '').trim();

        // Skip empty tds
        if (!colorName) continue;

        // Skip duplicates
        if (seenNames.has(colorName)) continue;
        seenNames.add(colorName);

        // Color image from lightbox <a> href (full size) or <img> src (mini)
        let imageUrl = '';
        const aEl = td.querySelector('a[href]');
        if (aEl) {
          const href = aEl.getAttribute('href') || '';
          imageUrl = href.startsWith('http') ? href : href.startsWith('//') ? 'https:' + href : href ? BASE + href.replace(/^\.?\//, '') : '';
        }
        if (!imageUrl) {
          const img = td.querySelector('img');
          if (img) {
            const src = img.getAttribute('src') || '';
            imageUrl = src.startsWith('http') ? src : src.startsWith('//') ? 'https:' + src : src ? BASE + src.replace(/^\.?\//, '') : '';
          }
        }

        if (imageUrl) {
          colors.push({ name: colorName, imageUrl });
        }
      }

      // --- Main image ---
      let mainImageUrl = '';
      const mainImg =
        document.querySelector('#item_top img') ||
        document.querySelector('#category_right > div:first-child img');
      if (mainImg) {
        const src = (mainImg as HTMLImageElement).getAttribute('src') || '';
        mainImageUrl = src.startsWith('http') ? src : src.startsWith('//') ? 'https:' + src : src ? BASE + src.replace(/^\.?\//, '') : '';
      }

      // --- Has standard template? ---
      const hasItemInfo = !!document.querySelector('.item_info');

      return {
        name,
        category,
        description,
        lengthText,
        weightText,
        priceText,
        colors,
        mainImageUrl,
        hasItemInfo,
      };
    });

    log(
      `Extracted: name="${pageData.name}", cat="${pageData.category}", colors=${pageData.colors.length}, template=${pageData.hasItemInfo ? 'standard' : 'custom'}`,
    );

    // ----- Post-process extracted data -----
    const slug = extractSlug(url);
    const name = pageData.name || slug.replace(/[-_]/g, ' ');
    const type = detectType(name, slug);
    const price = parsePriceIncTax(pageData.priceText);
    const weights = parseWeights(pageData.weightText);
    const length = parseLength(pageData.lengthText);
    const targetFish = detectTargetFish(name, slug, pageData.category);

    // Colors
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
      manufacturer: 'GANCRAFT',
      manufacturer_slug: 'gancraft',
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

    log(
      `Done: ${name} | type=${type} | price=${price} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | fish=${targetFish.join(',')}`,
    );

    return result;
  } finally {
    if (browser) await browser.close();
  }
}
