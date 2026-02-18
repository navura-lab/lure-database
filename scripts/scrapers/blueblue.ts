// scripts/scrapers/blueblue.ts
// BlueBlueFishing product page scraper

import { chromium, type Browser, type Page } from 'playwright';
import { BLUEBLUE_BASE_URL } from '../config.js';
import type { ScrapedColor, ScrapedLure } from './types.js';

// Re-export types for backward compatibility
export type { ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Slug mapping  (Japanese product name -> romanized slug)
// ---------------------------------------------------------------------------

const SLUG_MAP: Record<string, string> = {
  // Seabass / Light-game
  'シーライド': 'sea-ride',
  'シーライドミニ': 'sea-ride-mini',
  'シーライドロング': 'sea-ride-long',
  'ガボッツ150': 'gabotz-150',
  'ガボッツ90': 'gabotz-90',
  'ガボッツ65': 'gabotz-65',
  'ガボッツ': 'gabotz',
  'ブローウィン140S': 'blowin-140s',
  'ブローウィン165F': 'blowin-165f',
  'ブローウィン125F': 'blowin-125f',
  'ブローウィン80S': 'blowin-80s',
  'ブローウィン': 'blowin',
  'スネコン130S': 'snecon-130s',
  'スネコン90S': 'snecon-90s',
  'スネコン150S': 'snecon-150s',
  'スネコン': 'snecon',
  'トレイシー': 'tracy',
  'トレイシー25': 'tracy-25',
  'トレイシー15': 'tracy-15',
  'ナレージ65': 'narage-65',
  'ナレージ50': 'narage-50',
  'ナレージ': 'narage',
  'アミコン40S': 'amicon-40s',
  'アミコン': 'amicon',
  'ジョルティ': 'jolty',
  'ジョルティミニ': 'jolty-mini',
  'ジョルティ22': 'jolty-22',
  'ジョルティ30': 'jolty-30',
  'フォルテン': 'forten',
  'フォルテンミッド': 'forten-mid',
  'フォルテンロング': 'forten-long',
  'スピンビット': 'spinbit',
  'グラバーHi68S': 'grabber-hi-68s',
  'グラバーHi': 'grabber-hi',
  'グラバー': 'grabber',
  'ゼッパー': 'zepper',
  'ゼッパー140': 'zepper-140',
  'ニンジャリ': 'ninjari',
  'シャルダス20': 'shalldus-20',
  'シャルダス35': 'shalldus-35',
  'シャルダス': 'shalldus',
  'ラザミン90': 'lazamin-90',
  'ラザミン': 'lazamin',
  'メタルシャルダス': 'metal-shalldus',
  'ガチペン130': 'gachpen-130',
  'ガチペン200': 'gachpen-200',
  'ガチペン': 'gachpen',
  'スカーナッシュ': 'scarnash',
  'スカーナッシュ120F': 'scarnash-120f',
  'スカーナッシュ140F': 'scarnash-140f',
  // Inemun
  'イネムン60': 'inemun-60',
  'イネムン': 'inemun',
  // Aiser
  'アイザー125リラード': 'aiser-125-rerard',
  'アイザー160F': 'aiser-160f',
  'アイザー125F': 'aiser-125f',
  'アイザー100F': 'aiser-100f',
  'アイザー': 'aiser',
  // Arvin
  'アービン150S': 'arvin-150s',
  'アービン60S': 'arvin-60s',
  'アービン': 'arvin',
  // Outstar
  'アウトスター120S': 'outstar-120s',
  'アウトスター': 'outstar',
  // Amicon additional
  'アミコン40HS': 'amicon-40hs',
  // Eguid
  'エグイド90F': 'eguid-90f',
  'エグイド': 'eguid',
  // Esnal
  'エスナル': 'esnal',
  // Ebicon
  'エビコン60S': 'ebicon-60s',
  'エビコン60Ｓ': 'ebicon-60s',
  'エビコン': 'ebicon',
  // Gachisla
  'ガチスラ230HS': 'gachisla-230hs',
  'ガチスラ180HS': 'gachisla-180hs',
  'ガチスラ': 'gachisla',
  // Gachpen additional
  'ガチペン160': 'gachpen-160',
  'ガチペンスイマー180': 'gachpen-swimmer-180',
  // Gachpop
  'ガチポップトゥリーパ': 'gachpop-tulipa',
  'ガチポップ100': 'gachpop-100',
  'ガチポップ60': 'gachpop-60',
  'ガチポップ': 'gachpop',
  // Gabotz additional
  'ガボッツ120': 'gabotz-120',
  // Kumihon
  'クミホンディープ75F（フローティング）': 'kumihon-deep-75f',
  'クミホンディープ75S': 'kumihon-deep-75s',
  'クミホンディープ': 'kumihon-deep',
  'クミホン70S': 'kumihon-70s',
  'クミホン': 'kumihon',
  // Conifer
  'コニファー': 'conifer',
  // Konoyaro
  'コノ野郎180': 'konoyaro-180',
  'コノ野郎': 'konoyaro',
  // Shalldus additional
  'シャルダス14': 'shalldus-14',
  // Jolty additional
  'ジョルティ45.55': 'jolty-45-55',
  'ジョルティmini': 'jolty-mini',
  // Offshore
  'フリッド': 'freed',
  'フリッドスリム': 'freed-slim',
  // Shore jigging
  'シーバイツ': 'seabites',
};

// ---------------------------------------------------------------------------
// Type detection keywords
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ/, 'メタルジグ'],
  [/ジグ/, 'メタルジグ'],
  [/ポッパー/, 'ポッパー'],
  [/ペンシル/, 'ペンシルベイト'],
  [/シンペン|シンキングペンシル/, 'シンキングペンシル'],
  [/ミノー/, 'ミノー'],
  [/バイブレーション/, 'バイブレーション'],
  [/ワーム/, 'ワーム'],
  [/トップウォーター/, 'トップウォーター'],
  [/クランク/, 'クランクベイト'],
  [/シャッド/, 'シャッド'],
  [/スプーン/, 'スプーン'],
  [/スピナーベイト/, 'スピナーベイト'],
  [/バズベイト/, 'バズベイト'],
  [/ジグヘッド/, 'ジグヘッド'],
  [/ブレード/, 'ブレードベイト'],
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [blueblue] ${message}`);
}

/**
 * Normalize color name: strip leading fullwidth/halfwidth #XX prefix whitespace,
 * but keep the actual color name.  e.g. "＃01 ブルーブルー" -> "01 ブルーブルー"
 */
function normalizeColorName(raw: string): string {
  // Replace fullwidth ＃ with halfwidth #
  let s = raw.replace(/＃/g, '#').trim();
  // Strip leading # if present  (e.g. "#01 ブルーブルー" -> "01 ブルーブルー")
  s = s.replace(/^#/, '').trim();
  return s;
}

/**
 * Generate a slug for the given product name.
 * First checks the manual mapping table, then falls back to extracting
 * a segment from the source URL.
 */
function generateSlug(name: string, sourceUrl: string): string {
  // Try exact match first
  if (SLUG_MAP[name]) {
    return SLUG_MAP[name];
  }

  // Try match after stripping trailing numbers/whitespace
  const stripped = name.replace(/[\s\d]+$/, '');
  if (SLUG_MAP[stripped]) {
    return SLUG_MAP[stripped];
  }

  // Try matching longest prefix
  const sortedKeys = Object.keys(SLUG_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (name.includes(key)) {
      const suffix = name.replace(key, '').trim().toLowerCase().replace(/[\s]+/g, '-');
      if (suffix) {
        return `${SLUG_MAP[key]}-${suffix}`;
      }
      return SLUG_MAP[key];
    }
  }

  // Fallback: extract from URL path
  // e.g. https://www.bluebluefishing.com/products/searaid -> "searaid"
  try {
    const urlObj = new URL(sourceUrl);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    if (lastSegment && /^[a-zA-Z0-9_-]+$/.test(lastSegment)) {
      return lastSegment.toLowerCase();
    }
  } catch {
    // ignore URL parse errors
  }

  // Last resort: encode the name
  return encodeURIComponent(name).toLowerCase();
}

/**
 * Detect lure type from text content.
 */
function detectType(titleTag: string, description: string): string {
  const combined = `${titleTag} ${description}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) {
      return typeName;
    }
  }
  return 'ルアー';
}

/**
 * Parse a price string like "2,950円（税込 3,245円）" to extract the
 * tax-included price as a number (3245).
 */
function parseTaxIncludedPrice(priceText: string): number {
  // Try to find 税込 price first
  const taxMatch = priceText.match(/税込[^\d]*([\d,]+)/);
  if (taxMatch) {
    return parseInt(taxMatch[1].replace(/,/g, ''), 10);
  }
  // Fallback: just get the first number
  const fallback = priceText.match(/([\d,]+)円/);
  if (fallback) {
    return parseInt(fallback[1].replace(/,/g, ''), 10);
  }
  return 0;
}

/**
 * Parse weight values from spec text.
 * Handles multiple formats:
 *   "Weight: 20g / 30g / 40g / 60g"
 *   "[重さ] 42g"
 *   "重量：20g"
 *   "20ｇ" (fullwidth g)
 */
function parseWeightsFromSpec(specText: string): number[] {
  const weights: number[] = [];

  // Normalize fullwidth digits and "ｇ" to halfwidth
  let normalized = specText
    .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
    .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
    .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
    .replace(/９/g, '9').replace(/ｇ/g, 'g');

  // Pattern 1: "Weight: 20g / 30g / 40g" or similar with slashes
  const slashPattern = /(?:weight|重さ|重量)[^\d]*([\d.]+g(?:\s*\/\s*[\d.]+g)*)/i;
  const slashMatch = normalized.match(slashPattern);
  if (slashMatch) {
    const parts = slashMatch[1].split('/');
    for (const part of parts) {
      const num = parseFloat(part.replace(/[^\d.]/g, ''));
      if (!isNaN(num) && num > 0) {
        weights.push(num);
      }
    }
  }

  // Pattern 2: "[重さ] 42g" or "重量：20g" (single value)
  if (weights.length === 0) {
    const singlePattern = /(?:重さ|重量|Weight)[：:\]]\s*([\d.]+)\s*g/gi;
    let match;
    while ((match = singlePattern.exec(normalized)) !== null) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0) {
        weights.push(num);
      }
    }
  }

  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Parse length from spec text.
 * Handles: "[全長] 150mm", "Length: 150mm", "全長：150mm"
 */
function parseLengthFromSpec(specText: string): number | null {
  let normalized = specText
    .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
    .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
    .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
    .replace(/９/g, '9');

  const patterns = [
    /(?:全長|Length|レングス|サイズ)[：:\]]\s*([\d.]+)\s*mm/i,
    /([\d.]+)\s*mm/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0 && num < 1000) {
        return num;
      }
    }
  }
  return null;
}

/**
 * Parse unique weight values from the select option strings.
 * Handles:
 *   "＃01 ブルーブルー × 20g 　×"          -> 20
 *   "＃01 ブルーブルー × 30ｇ　在庫あり"    -> 30
 *   "#01 ブルーブルー　在庫あり"             -> (no weight, single-weight product)
 */
function parseWeightsFromOptions(optionTexts: string[]): number[] {
  const weights: number[] = [];

  for (const text of optionTexts) {
    // Normalize fullwidth chars
    let normalized = text
      .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
      .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
      .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
      .replace(/９/g, '9').replace(/ｇ/g, 'g').replace(/×/g, '×');

    // Look for "× Xg" pattern
    const weightMatch = normalized.match(/×\s*([\d.]+)\s*g/);
    if (weightMatch) {
      const num = parseFloat(weightMatch[1]);
      if (!isNaN(num) && num > 0) {
        weights.push(num);
      }
    }
  }

  return [...new Set(weights)].sort((a, b) => a - b);
}

/**
 * Make a relative image URL absolute using the BlueBlue base URL.
 */
function makeAbsoluteUrl(src: string): string {
  if (!src) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  // Strip leading slash for consistency
  const path = src.startsWith('/') ? src : `/${src}`;
  return `${BLUEBLUE_BASE_URL}${path}`;
}

// ---------------------------------------------------------------------------
// Main scraper function
// ---------------------------------------------------------------------------

export async function scrapeBlueBluePage(url: string): Promise<ScrapedLure> {
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
    const name = await page.locator('.itemDet_name').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Product name: ${name}`);

    if (!name) {
      throw new Error(`Could not find product name at ${url}`);
    }

    // --- Title tag (for type detection and series extraction) ---
    const titleTag = await page.title().catch(() => '');
    log(`Title tag: ${titleTag}`);

    // Extract type from title tag second segment: "{Name} | {Series} | ルアー | ..."
    let typeFromTitle = '';
    const titleParts = titleTag.split('|').map(s => s.trim());
    if (titleParts.length >= 3) {
      typeFromTitle = titleParts[1] || '';
    }

    // --- Colors ---
    // Collect from ALL .itemDet_colorList sections (regular + WEB限定)
    const colorElements = await page.locator('.itemDet_colorItem').all();
    const colors: ScrapedColor[] = [];

    for (const el of colorElements) {
      const rawName = await el.innerText().then(t => t.trim()).catch(() => '');
      const imgEl = el.locator('img').first();
      const imgSrc = await imgEl.getAttribute('src').catch(() => '') || '';

      if (rawName) {
        colors.push({
          name: normalizeColorName(rawName),
          imageUrl: makeAbsoluteUrl(imgSrc),
        });
      }
    }
    log(`Found ${colors.length} colors`);

    // --- Check if any colors are WEB限定 ---
    const colorTitles = await page.locator('.itemDet_colorTitle').allInnerTexts().catch(() => []);
    const hasWebLimited = colorTitles.some(t => t.includes('WEB限定'));
    if (hasWebLimited) {
      log('Found WEB限定カラー section');
    }

    // --- Specs ---
    const specText = await page.locator('.itemDet_setBody').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    log(`Spec text: ${specText.substring(0, 100)}...`);

    const specWeights = parseWeightsFromSpec(specText);
    const length = parseLengthFromSpec(specText);
    log(`Spec weights: [${specWeights.join(', ')}], length: ${length}`);

    // --- Price ---
    const priceText = await page.locator('.itemDet_setBody-price').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    const price = parseTaxIncludedPrice(priceText);
    log(`Price text: "${priceText}" -> ${price} yen (tax incl.)`);

    // --- Description ---
    const rawDescription = await page.locator('.itemDet_wisiwyg.editor').first().innerText()
      .then(t => t.trim())
      .catch(() => '');
    const description = rawDescription.substring(0, 500);
    log(`Description: ${description.substring(0, 80)}...`);

    // --- Weight variants from select options ---
    const optionTexts = await page.locator('.itemDet_select-long option').allInnerTexts()
      .catch(() => [] as string[]);
    const optionWeights = parseWeightsFromOptions(optionTexts);
    log(`Option weights: [${optionWeights.join(', ')}]`);

    // Merge weights from spec and options, deduplicate
    const allWeights = [...new Set([...specWeights, ...optionWeights])].sort((a, b) => a - b);
    log(`Final weights: [${allWeights.join(', ')}]`);

    // --- Main image ---
    const mainImgSrc = await page.locator('.itemDet_bigList img').first().getAttribute('src')
      .catch(() => '') || '';
    const mainImage = makeAbsoluteUrl(mainImgSrc);
    log(`Main image: ${mainImage}`);

    // --- Generate slug ---
    const slug = generateSlug(name, url);
    log(`Slug: ${slug}`);

    // --- Detect type ---
    const type = detectType(`${titleTag} ${typeFromTitle}`, description);
    log(`Detected type: ${type}`);

    // --- Build result ---
    const result: ScrapedLure = {
      name,
      name_kana: name,  // BlueBlue products are all katakana
      slug,
      manufacturer: 'BlueBlueFishing',
      manufacturer_slug: 'blueblue',
      type,
      description,
      price,
      colors,
      weights: allWeights,
      length,
      mainImage,
      sourceUrl: url,
    };

    log(`Scrape complete: ${name} (${colors.length} colors, ${allWeights.length} weights)`);
    return result;

  } finally {
    if (browser) {
      await browser.close();
      log('Browser closed');
    }
  }
}
