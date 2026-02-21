// scripts/scrapers/megabass.ts
// Megabass product page scraper
// Handles both freshwater (bass) and saltwater lures from megabass.co.jp

import { chromium, type Browser } from 'playwright';
import type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEGABASS_BASE_URL = 'https://www.megabass.co.jp';

// ---------------------------------------------------------------------------
// Type detection keywords (shared concept with BlueBlue, but order matters)
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|METAL JIG/i, 'メタルジグ'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ペンシル|PENCIL/i, 'ペンシルベイト'],
  [/シンキングペンシル|SINKING PENCIL/i, 'シンキングペンシル'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/バイブレーション|VIBRATION/i, 'バイブレーション'],
  [/クランク|CRANK/i, 'クランクベイト'],
  [/スピナーベイト|SPINNER ?BAIT|WIRE ?BAIT/i, 'スピナーベイト'],
  [/バズベイト|BUZZ ?BAIT/i, 'バズベイト'],
  [/スイムベイト|SWIM ?BAIT/i, 'スイムベイト'],
  [/ジョイント|JOINT/i, 'ジョイントベイト'],
  [/トップウォーター|TOPWATER/i, 'トップウォーター'],
  [/プロップ|PROP/i, 'プロップベイト'],
  [/シャッド|SHAD/i, 'シャッド'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ジグヘッド|JIG ?HEAD/i, 'ジグヘッド'],
  [/ブレード|BLADE|SPIN ?TAIL/i, 'ブレードベイト'],
  [/ワーム|SOFT ?BAIT/i, 'ワーム'],
  [/ジグ|JIG/i, 'メタルジグ'],
];

// ---------------------------------------------------------------------------
// Kana mapping for product names (English name -> katakana reading)
// Used for search functionality in the DB
// ---------------------------------------------------------------------------

const NAME_KANA_MAP: Record<string, string> = {
  // Topwater
  'DOG-X': 'ドッグエックス',
  'DOGMAX': 'ドッグマックス',
  'POPX': 'ポップエックス',
  'BABY POPX': 'ベビーポップエックス',
  'GIANT DOG-X': 'ジャイアントドッグエックス',
  'MEGADOG': 'メガドッグ',
  'POPPING DUCK': 'ポッピングダック',
  'KARASHI': 'カラシ',
  'ANTHRAX': 'アンスラックス',
  'DYING FISH': 'ダイイングフィッシュ',
  'SIGLETT': 'シグレット',
  'I-WING': 'アイウィング',
  'WATER MONITOR': 'ウォーターモニター',

  // Minnow
  'X-80': 'エックスハチマル',
  'X-70': 'エックスナナマル',
  'X-55': 'エックスゴーゴー',
  'X-80SW': 'エックスハチマルSW',
  'X-120': 'エックスイチニーマル',
  'X-140': 'エックスイチヨンマル',
  'VISION': 'ビジョン',
  'ONETEN': 'ワンテン',
  'ITO SHINER': 'イトウシャイナー',
  'ZONK': 'ゾンク',
  'KANATA': 'カナタ',
  'CUTTER': 'カッター',
  'GENMA': 'ゲンマ',
  'MARGELINA': 'マージェリナ',
  'VATISSA': 'バティッサ',
  'KIRINJI': 'キリンジ',
  'HADARA': 'ハダラ',

  // Crankbait
  'DEEP-X': 'ディープエックス',
  'SR-X': 'エスアールエックス',
  'MR-X': 'エムアールエックス',
  'GRIFFON': 'グリフォン',
  'CYCLONE': 'サイクロン',
  'SUPER-Z': 'スーパーゼット',
  'NOISY CAT': 'ノイジーキャット',
  'BAIT-X': 'ベイトエックス',
  'ORBIT': 'オービット',
  'FX': 'エフエックス',

  // Vibration
  'VIBRATION-X': 'バイブレーションエックス',
  'SLASH BEAT': 'スラッシュビート',

  // Joint
  'VATALION': 'ヴァタリオン',
  'I-JACK': 'アイジャック',
  'I-LOUD': 'アイラウド',
  'I-SLIDE': 'アイスライド',

  // Jig
  'MAKIPPA': 'マキッパ',
  'METAL-X': 'メタルエックス',

  // Swimbait
  'MAGDRAFT': 'マグドラフト',
  'DARK SLEEPER': 'ダークスリーパー',
  'SPARK SHAD': 'スパークシャッド',

  // Saltwater
  'SWING HOT': 'スウィングホット',
  'KONOSIRUS': 'コノシラス',
  'TOUGH BOMB': 'タフボム',
  'HAZEDONG': 'ハゼドン',
  'BOTTLE SHRIMP': 'ボトルシュリンプ',
  'ROCKY FRY': 'ロッキーフライ',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [megabass] ${message}`);
}

/**
 * Convert oz-based weight string to grams.
 * Handles:
 *   "7/16oz."   → 7/16 * 28.3495 = ~12.4g
 *   "1/4oz."    → 1/4 * 28.3495 = ~7.1g
 *   "1.1/4oz."  → (1 + 1/4) * 28.3495 = ~35.4g
 *   "11g"       → 11
 *   "3g, 5g, 7g, 10g, 20g, 30g, 40g" → [3, 5, 7, 10, 20, 30, 40]
 */
function parseWeightText(text: string): number[] {
  const weights: number[] = [];

  // Normalize fullwidth chars
  let normalized = text
    .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
    .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
    .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
    .replace(/９/g, '9').replace(/ｇ/g, 'g');

  // Pattern 1: comma-separated gram values "3g, 5g, 7g, 10g, 20g, 30g, 40g"
  const commaSeparated = normalized.match(/([\d.]+)\s*g/g);
  if (commaSeparated && commaSeparated.length > 1) {
    for (const match of commaSeparated) {
      const num = parseFloat(match.replace(/[^\d.]/g, ''));
      if (!isNaN(num) && num > 0) {
        weights.push(Math.round(num * 10) / 10);
      }
    }
    return [...new Set(weights)].sort((a, b) => a - b);
  }

  // Pattern 2: oz fraction like "7/16oz." or "1.1/4oz." or "1/2oz.class"
  const ozPattern = /(\d+)\.?(\d+\/\d+)\s*oz/i;
  const ozMatch = normalized.match(ozPattern);
  if (ozMatch) {
    const wholePart = parseInt(ozMatch[1], 10);
    const [num, den] = ozMatch[2].split('/').map(Number);
    const oz = wholePart + num / den;
    weights.push(Math.round(oz * 28.3495 * 10) / 10);
    return weights;
  }

  // Pattern 2b: simple fraction "1/4oz."
  const simpleFracPattern = /(\d+)\/(\d+)\s*oz/i;
  const simpleFracMatch = normalized.match(simpleFracPattern);
  if (simpleFracMatch) {
    const num = parseInt(simpleFracMatch[1], 10);
    const den = parseInt(simpleFracMatch[2], 10);
    const oz = num / den;
    weights.push(Math.round(oz * 28.3495 * 10) / 10);
    return weights;
  }

  // Pattern 2c: decimal oz "1.5oz."
  const decOzPattern = /([\d.]+)\s*oz/i;
  const decOzMatch = normalized.match(decOzPattern);
  if (decOzMatch) {
    const oz = parseFloat(decOzMatch[1]);
    if (!isNaN(oz) && oz > 0) {
      weights.push(Math.round(oz * 28.3495 * 10) / 10);
      return weights;
    }
  }

  // Pattern 3: simple gram value "11g"
  const gramPattern = /([\d.]+)\s*g/i;
  const gramMatch = normalized.match(gramPattern);
  if (gramMatch) {
    const num = parseFloat(gramMatch[1]);
    if (!isNaN(num) && num > 0) {
      weights.push(Math.round(num * 10) / 10);
    }
  }

  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Parse Megabass price text (tax-excluded) and convert to tax-included (×1.1).
 * Handles:
 *   "メーカー希望小売価格（税別） 1,800 円"  → 1980
 *   "メーカー希望小売価格（税別） 700～860 円" → 770 (min value × 1.1)
 *   "" (no price)                             → 0
 */
function parseMegabassPrice(priceText: string): number {
  if (!priceText) return 0;

  // Remove commas and whitespace
  const cleaned = priceText.replace(/,/g, '').replace(/\s/g, '');

  // Try to find price range: "700～860" → take minimum
  const rangeMatch = cleaned.match(/(\d+)[～~\-](\d+)/);
  if (rangeMatch) {
    const minPrice = parseInt(rangeMatch[1], 10);
    return Math.round(minPrice * 1.1);
  }

  // Single price: "1800円"
  const singleMatch = cleaned.match(/(\d+)\s*円/);
  if (singleMatch) {
    const price = parseInt(singleMatch[1], 10);
    return Math.round(price * 1.1);
  }

  // Fallback: just find a number
  const numMatch = cleaned.match(/(\d+)/);
  if (numMatch) {
    const price = parseInt(numMatch[1], 10);
    if (price > 100 && price < 100000) { // sanity check
      return Math.round(price * 1.1);
    }
  }

  return 0;
}

/**
 * Generate slug from URL path.
 * /site/products/karashi_80/ → "karashi_80"
 * /site/products/dog-x_diamante_sonic_slide/ → "dog-x_diamante_sonic_slide"
 */
function generateSlug(url: string): string {
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    // URL pattern: /site/products/{slug}/
    const productsIndex = segments.indexOf('products');
    if (productsIndex >= 0 && productsIndex + 1 < segments.length) {
      return segments[productsIndex + 1].toLowerCase();
    }
    // Fallback: last segment
    const lastSegment = segments[segments.length - 1] || '';
    if (lastSegment && /^[a-zA-Z0-9_-]+$/.test(lastSegment)) {
      return lastSegment.toLowerCase();
    }
  } catch {
    // ignore URL parse errors
  }
  return '';
}

/**
 * Detect lure type from page content.
 * Uses both the SPEC "Type" field (SINKING, FLOATING, etc.) and
 * text content from title/description/breadcrumb.
 */
function detectType(titleTag: string, description: string, breadcrumb: string, specType: string): string {
  // Combine all sources for keyword matching
  const combined = `${titleTag} ${description} ${breadcrumb} ${specType}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) {
      return typeName;
    }
  }
  return 'ルアー';
}

/**
 * Generate katakana reading for the product name.
 * Megabass products mostly have English/romaji names, so we use a manual lookup table.
 */
function generateNameKana(name: string): string {
  // Try exact match
  const upperName = name.toUpperCase().trim();
  for (const [key, kana] of Object.entries(NAME_KANA_MAP)) {
    if (upperName === key.toUpperCase()) {
      return kana;
    }
  }

  // Try prefix match (e.g., "KARASHI 80" matches "KARASHI")
  const sortedKeys = Object.keys(NAME_KANA_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (upperName.startsWith(key.toUpperCase())) {
      const suffix = name.substring(key.length).trim();
      if (suffix) {
        return `${NAME_KANA_MAP[key]} ${suffix}`;
      }
      return NAME_KANA_MAP[key];
    }
  }

  // Fallback: return the name as-is (it might already be katakana or romaji)
  return name;
}

/**
 * Parse length from Megabass SPEC. Usually just "80mm" or "80.5mm".
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)\s*mm/i);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num > 0 && num < 2000) {
      return num;
    }
  }
  return null;
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
 * Megabass URLs don't encode category — all are /site/products/{slug}/.
 */
function deriveTargetFish(type: string): string[] {
  return TYPE_FISH_MAP[type] || [];
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeMegabassPage(url: string): Promise<ScrapedLure> {
  log(`Starting scrape: ${url}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Navigate
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    log('Page loaded');

    // --- Product name ---
    const name = await page.locator('main h1').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Product name: ${name}`);

    if (!name) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // --- Title tag (for type detection) ---
    const titleTag = await page.title().catch(() => '');
    log(`Title tag: ${titleTag}`);

    // --- Breadcrumb ---
    const breadcrumbText = await page.locator('main nav').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Breadcrumb: ${breadcrumbText}`);

    // --- SPEC table ---
    // Megabass SPEC is a <table> inside a section with h2 "SPEC".
    // Row 0 = headers (th or td), Row 1+ = data rows.
    // For multi-weight products (MAKIPPA), there are multiple data rows.
    const specData: Record<string, string> = {};
    try {
      // Strategy: get the full SPEC section text and parse it
      // This is more robust than trying to find exact table elements
      const specHeading = page.locator('h2:text("SPEC"), h3:text("SPEC")').first();
      const specParent = specHeading.locator('..');

      // Try table-based extraction first
      const table = await specParent.locator('table').first();
      const tableRows = await table.locator('tr').all().catch(() => []);

      if (tableRows.length >= 2) {
        // Get headers from first row
        const headerCells = await tableRows[0].locator('th, td').all();
        const headers: string[] = [];
        for (const cell of headerCells) {
          headers.push((await cell.innerText().catch(() => '')).trim());
        }

        // Get values from second row
        const valueCells = await tableRows[1].locator('td').all();
        const values: string[] = [];
        for (const cell of valueCells) {
          values.push((await cell.innerText().catch(() => '')).trim());
        }

        for (let i = 0; i < headers.length && i < values.length; i++) {
          if (headers[i] && values[i]) {
            specData[headers[i]] = values[i];
          }
        }

        // Multi-weight products: collect Lure (weight) from all data rows
        if (tableRows.length > 2) {
          const lureIndex = headers.findIndex(h => h.toLowerCase() === 'lure');
          const priceIndex = headers.findIndex(h => h.toLowerCase() === 'price');
          if (lureIndex >= 0) {
            const allWeights: string[] = [];
            const allPrices: string[] = [];
            for (let r = 1; r < tableRows.length; r++) {
              const cells = await tableRows[r].locator('td').all();
              if (lureIndex < cells.length) {
                const w = (await cells[lureIndex].innerText().catch(() => '')).trim();
                if (w) allWeights.push(w);
              }
              if (priceIndex >= 0 && priceIndex < cells.length) {
                const p = (await cells[priceIndex].innerText().catch(() => '')).trim();
                if (p) allPrices.push(p);
              }
            }
            if (allWeights.length > 0) specData['Lure'] = allWeights.join(', ');
            if (allPrices.length > 0 && !specData['Price']) specData['Price'] = allPrices[0];
          }
        }
      }

      // Fallback: some products use <div> pairs instead of <table>
      // Pattern: generic "Length" → generic "80mm" → generic "Weight" → generic "7/16oz." ...
      if (Object.keys(specData).length <= 1) {
        const fullText = await specParent.innerText().catch(() => '');
        // Split by newlines and pair up labels with values
        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l && l !== 'SPEC');
        const knownLabels = ['Length', 'Weight', 'Lure', 'Type', 'Hook', 'Price'];

        for (let i = 0; i < lines.length - 1; i++) {
          const label = lines[i];
          // Check if this line is a known label
          if (knownLabels.some(k => label.toLowerCase() === k.toLowerCase())) {
            const value = lines[i + 1];
            // Make sure the value is not another label
            if (value && !knownLabels.some(k => value.toLowerCase() === k.toLowerCase())) {
              specData[label] = value;
              i++; // skip the value line
            }
          }
          // Also catch "メーカー希望小売価格..." as Price value
          if (label === 'Price' && i + 1 < lines.length) {
            const priceVal = lines[i + 1];
            if (priceVal && priceVal.includes('円')) {
              specData['Price'] = priceVal;
              i++;
            }
          }
        }

        // Additional: check for price text that includes 円 anywhere in fullText
        if (!specData['Price']) {
          const priceMatch = fullText.match(/(メーカー希望小売価格[^\n]*\d+[^\n]*円)/);
          if (priceMatch) specData['Price'] = priceMatch[1];
        }
      }
    } catch (e) {
      log(`SPEC extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }

    log(`SPEC data: ${JSON.stringify(specData)}`);

    // --- Length ---
    const length = parseLength(specData['Length'] || '');
    log(`Length: ${length}`);

    // --- Weight ---
    // Megabass uses either "Lure" or "Weight" as the column name for weight.
    // For multi-weight products (MAKIPPA), the full SPEC text may contain patterns like "3g : ¥700 5g : ¥710 ..."
    let weightText = specData['Lure'] || specData['Weight'] || '';

    // If no weight found from standard columns, try extracting from all spec values
    if (!weightText) {
      const allSpecValues = Object.values(specData).join(' ');
      // Look for "Xg : ¥XXX" patterns (multi-weight products)
      const multiWeightPattern = allSpecValues.match(/(\d+g\s*:\s*[￥¥]\s*[\d,]+)/g);
      if (multiWeightPattern && multiWeightPattern.length > 1) {
        // Extract just the gram values
        weightText = multiWeightPattern.map(m => m.match(/(\d+)g/)?.[0] || '').filter(Boolean).join(', ');
      }
    }

    // Also check the full SPEC section text for multi-weight patterns
    if (!weightText) {
      try {
        const specHeading2 = page.locator('h2:text("SPEC"), h3:text("SPEC")').first();
        const specFullText = await specHeading2.locator('..').innerText().catch(() => '');
        const multiWeightPattern = specFullText.match(/(\d+)g\s*:\s*[￥¥]/g);
        if (multiWeightPattern && multiWeightPattern.length > 1) {
          weightText = multiWeightPattern.map(m => m.match(/(\d+)g/)?.[0] || '').filter(Boolean).join(', ');
        }
      } catch { /* ignore */ }
    }

    const weights = parseWeightText(weightText);
    log(`Weights: [${weights.join(', ')}]`);

    // --- Type from SPEC ---
    const specType = specData['Type'] || '';
    log(`Spec Type: ${specType}`);

    // --- Price ---
    const price = parseMegabassPrice(specData['Price'] || '');
    log(`Price: ${price} yen (tax incl.)`);

    // --- Description ---
    // Megabass has description text between the banner and SPEC sections
    let description = '';
    try {
      // Get all text paragraphs in main content before SPEC
      const mainContent = page.locator('main');
      const allParagraphs = await mainContent.locator('p, div.entry-content, .product_desc').allInnerTexts().catch(() => []);

      // If that didn't work, try getting generic text after the banner
      if (allParagraphs.length === 0 || allParagraphs.join('').trim().length < 10) {
        const bannerNext = await page.locator('main > div:nth-child(3), main > section:nth-child(3)').first().innerText()
          .then(t => t.trim())
          .catch(() => '');
        description = bannerNext.substring(0, 500);
      } else {
        description = allParagraphs
          .filter(t => t.trim().length > 20 && !t.includes('SPEC') && !t.includes('COLOR'))
          .join('\n')
          .substring(0, 500);
      }
    } catch {
      description = '';
    }
    // Fallback: use title tag content
    if (!description) {
      description = titleTag;
    }
    log(`Description: ${description.substring(0, 80)}...`);

    // --- Colors ---
    const colors: ScrapedColor[] = [];
    try {
      // Find the COLOR VARIATION heading, then get its parent section's list items
      const colorHeading = page.locator('h2:text("COLOR VARIATION"), h3:text("COLOR VARIATION")').first();
      const colorParent = colorHeading.locator('..');
      const colorItems = await colorParent.locator('ul > li, ol > li').all();

      for (const item of colorItems) {
        const link = item.locator('a').first();
        const href = await link.getAttribute('href').catch(() => '') || '';

        // Only accept links to image files (jpg/jpeg/png/webp), not product pages
        if (!href || !href.match(/\.(jpg|jpeg|png|webp)/i)) {
          continue;
        }

        const colorName = await link.innerText()
          .then(t => t.trim())
          .catch(() => '');

        if (colorName) {
          colors.push({
            name: colorName,
            imageUrl: href.startsWith('http') ? href : `${MEGABASS_BASE_URL}${href}`,
          });
        }
      }
    } catch (e) {
      log(`Color extraction error: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`Found ${colors.length} colors`);

    // --- Main image ---
    let mainImage = '';
    try {
      // Banner section contains the main product image
      const bannerImg = await page.locator('main [class*="banner"] img, main header img, main > div:first-child img, main > section:first-child img').first().getAttribute('src')
        .catch(() => '') || '';
      mainImage = bannerImg.startsWith('http') ? bannerImg : (bannerImg ? `${MEGABASS_BASE_URL}${bannerImg}` : '');
    } catch {
      mainImage = '';
    }
    // Fallback: use first color image
    if (!mainImage && colors.length > 0) {
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
    const type = detectType(titleTag, description, breadcrumbText, specType);
    log(`Detected type: ${type}`);

    // --- Target fish ---
    const target_fish = deriveTargetFish(type);
    log(`Target fish: [${target_fish.join(', ')}]`);

    // --- Name kana ---
    const name_kana = generateNameKana(name);
    log(`Name kana: ${name_kana}`);

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana,
      slug,
      manufacturer: 'Megabass',
      manufacturer_slug: 'megabass',
      type,
      target_fish,
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
