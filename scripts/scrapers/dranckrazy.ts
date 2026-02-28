// scripts/scrapers/dranckrazy.ts
// DRANCKRAZY (dranckrazy.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: WordPress + WooCommerce
// Product URL pattern: https://dranckrazy.com/product/{slug}/
// WooCommerce product pages with descriptions, images, color dropdowns
// Types: クランクベイト, ミノー, メタルバイブ, etc.
// Target fish: ブラックバス, シーバス

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'DRANCKRAZY';
const MANUFACTURER_SLUG = 'dranckrazy';
const SITE_BASE = 'https://dranckrazy.com';
const DEFAULT_TARGET_FISH = ['ブラックバス', 'シーバス'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/クランク|crank/i, 'クランクベイト'],
  [/メタルバイブ|metal\s*vib/i, 'メタルバイブ'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/ミノー|minnow/i, 'ミノー'],
  [/シンキングペンシル|シンペン|sinking\s*pencil/i, 'シンキングペンシル'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/メタルジグ|metal\s*jig|ジグ/i, 'メタルジグ'],
  [/トップウォーター|topwater|top\s*water/i, 'トップウォーター'],
  [/スピナーベイト|spinnerbait/i, 'スピナーベイト'],
  [/バズベイト|buzzbait/i, 'バズベイト'],
  [/ジグヘッド|jig\s*head/i, 'ジグヘッド'],
  [/ワーム|worm/i, 'ワーム'],
  [/スプーン|spoon/i, 'スプーン'],
  [/ブレード|blade/i, 'ブレードベイト'],
  [/シャッド|shad/i, 'シャッド'],
  [/プラグ|plug/i, 'プラグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [dranckrazy] ${msg}`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function makeAbsolute(href: string): string {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return SITE_BASE + href;
  return SITE_BASE + '/' + href;
}

function detectType(name: string, description: string, categories: string): string {
  const combined = `${name} ${description} ${categories}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return typeName;
  }
  return 'ルアー';
}

/**
 * Parse price from WooCommerce format.
 * Handles: "¥1,980", "1,980円（税込）", "1,800円（税別）"
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  const taxInclMatch = cleaned.match(/税込[^\d]*([\d,]+)/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  const taxExclMatch = cleaned.match(/([\d,]+)円[（(]税別/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  const yenMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

  const plainMatch = cleaned.match(/([\d,]+)円/);
  if (plainMatch) return parseInt(plainMatch[1].replace(/,/g, ''), 10);

  return 0;
}

/**
 * Parse weight values from text.
 */
function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];
  const normalized = text
    .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
    .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
    .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
    .replace(/９/g, '9').replace(/ｇ/g, 'g');

  let match: RegExpExecArray | null;
  const re = /([\d.]+)\s*g/gi;
  while ((match = re.exec(normalized)) !== null) {
    const w = parseFloat(match[1]);
    if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
  }
  return Array.from(new Set(weights)).sort((a, b) => a - b);
}

/**
 * Parse length from text in mm.
 */
function parseLength(text: string): number | null {
  if (!text) return null;
  const normalized = text
    .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2')
    .replace(/３/g, '3').replace(/４/g, '4').replace(/５/g, '5')
    .replace(/６/g, '6').replace(/７/g, '7').replace(/８/g, '8')
    .replace(/９/g, '9');

  const mmMatch = normalized.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }
  const cmMatch = normalized.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    const mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }
  return null;
}

/**
 * Derive target fish from product context.
 */
function deriveTargetFish(name: string, description: string, categories: string): string[] {
  const combined = `${name} ${description} ${categories}`;
  const fish: string[] = [];

  if (/ブラックバス|バス釣り|BASS/i.test(combined) || /クランク|スピナーベイト/i.test(combined)) {
    fish.push('ブラックバス');
  }
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/トラウト/i.test(combined)) fish.push('トラウト');
  if (/ヒラメ|マゴチ|フラット/i.test(combined)) fish.push('ヒラメ');
  if (/青物/i.test(combined)) fish.push('青物');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

/**
 * Parse HTML table rows into an array of cell arrays.
 */
function parseTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells: string[] = [];
    const cellMatches = tr.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
    for (const cell of cellMatches) {
      cells.push(stripHtml(cell));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export const scrapeDranckrazyPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  log(`Starting scrape: ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();

  // --- Product name ---
  let name = '';
  // WooCommerce product title
  const productTitleMatch = html.match(/<h1[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (productTitleMatch) name = stripHtml(productTitleMatch[1]).trim();
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) name = stripHtml(h1Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|–—].*$/, '').trim();
  }
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*[|–—].*$/, '').trim();
  }
  if (!name) name = 'Unknown';
  log(`Product name: ${name}`);

  // --- Slug from URL ---
  let slug = '';
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const productIdx = segments.indexOf('product');
    if (productIdx >= 0 && segments[productIdx + 1]) {
      slug = segments[productIdx + 1].toLowerCase();
    } else {
      slug = (segments[segments.length - 1] || '').toLowerCase();
    }
  } catch { /* ignore */ }
  if (!slug) slug = slugify(name);
  log(`Slug: ${slug}`);

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) mainImage = ogImageMatch[1];
  if (!mainImage) {
    // WooCommerce gallery main image
    const wooImgMatch = html.match(/woocommerce-product-gallery__image[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)
      || html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (wooImgMatch) mainImage = wooImgMatch[1];
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Categories from breadcrumb ---
  let categoryText = '';
  const breadcrumbMatch = html.match(/<nav[^>]*breadcrumb[\s\S]*?<\/nav>/i)
    || html.match(/<div[^>]*breadcrumb[\s\S]*?<\/div>/i);
  if (breadcrumbMatch) {
    categoryText = stripHtml(breadcrumbMatch[0]);
  }
  // Also check product_meta for posted_in
  const postedInMatch = html.match(/posted_in[\s\S]*?<\/span>/i);
  if (postedInMatch) categoryText += ' ' + stripHtml(postedInMatch[0]);
  log(`Categories: ${categoryText.substring(0, 100)}`);

  // --- Description ---
  let description = '';
  // WooCommerce: #tab-description or short description
  const tabDescMatch = html.match(/<div[^>]*id=["']tab-description["'][^>]*>([\s\S]*?)<\/div>/i);
  if (tabDescMatch) {
    const text = stripHtml(tabDescMatch[1]).trim();
    if (text.length > 20) description = text.replace(/\s+/g, ' ').substring(0, 500);
  }
  if (!description) {
    const shortDescMatch = html.match(/<div[^>]*class=["'][^"']*woocommerce-product-details__short-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (shortDescMatch) {
      const text = stripHtml(shortDescMatch[1]).trim();
      if (text.length > 20) description = text.replace(/\s+/g, ' ').substring(0, 500);
    }
  }
  if (!description) {
    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
    if (metaDescMatch && metaDescMatch[1].length > 20) {
      description = stripHtml(metaDescMatch[1]).substring(0, 500);
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Price ---
  let price = 0;
  // WooCommerce price element
  const priceMatch = html.match(/<p[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<span[^>]*class=["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (priceMatch) {
    price = parsePrice(stripHtml(priceMatch[1]));
  }
  if (price === 0) {
    const bodyText = stripHtml(html);
    const bodyPriceMatch = bodyText.match(/(?:定価|価格|PRICE)[：:\s]*([\d,]+)\s*円/i);
    if (bodyPriceMatch) price = parseInt(bodyPriceMatch[1].replace(/,/g, ''), 10);
  }
  log(`Price: ${price}`);

  // --- Specs from WooCommerce additional info or body text ---
  let specText = '';
  let weights: number[] = [];
  let length: number | null = null;

  // WooCommerce additional information table
  const additionalInfoMatch = html.match(/<table[^>]*class=["'][^"']*(?:woocommerce-product-attributes|shop_attributes)[^"']*["'][^>]*>[\s\S]*?<\/table>/i)
    || html.match(/<div[^>]*id=["']tab-additional_information["'][^>]*>[\s\S]*?<\/div>/i);
  if (additionalInfoMatch) {
    specText = stripHtml(additionalInfoMatch[0]);
    const rows = parseTableRows(additionalInfoMatch[0]);
    for (const cells of rows) {
      if (cells.length >= 2) {
        const label = cells[0].toLowerCase();
        const value = cells[1];
        if (/重量|ウエイト|weight/i.test(label)) weights = weights.concat(parseWeights(value));
        if (/全長|length|サイズ|レングス/i.test(label) && length === null) length = parseLength(value);
      }
    }
  }

  // Parse from description/body text
  if (weights.length === 0) weights = parseWeights(description + ' ' + specText);
  if (length === null) length = parseLength(description + ' ' + specText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm`);

  // --- Colors from WooCommerce variation selects ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Pattern 1: <option> in variation select
  const selectMatch = html.match(/<select[^>]*(?:name|id)=["'][^"']*(?:color|colour|カラー)[^"']*["'][^>]*>([\s\S]*?)<\/select>/i);
  if (selectMatch) {
    const optionMatches = selectMatch[1].match(/<option[^>]+value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi) || [];
    for (const opt of optionMatches) {
      const valueMatch = opt.match(/value=["']([^"']+)["']/i);
      const textMatch = opt.match(/<option[^>]*>([\s\S]*?)<\/option>/i);
      if (valueMatch && textMatch) {
        const colorName = stripHtml(textMatch[1]).trim();
        if (colorName && colorName !== 'オプションを選択' && colorName !== '選択してください' && !seenColors.has(colorName)) {
          seenColors.add(colorName);
          colors.push({ name: colorName, imageUrl: mainImage });
        }
      }
    }
  }

  // Pattern 2: All variation select options (generic)
  if (colors.length === 0) {
    const allSelectMatches = html.match(/<select[^>]*class=["'][^"']*variation[^"']*["'][^>]*>([\s\S]*?)<\/select>/gi) || [];
    for (const sel of allSelectMatches) {
      const optMatches = sel.match(/<option[^>]+value=["']([^"']+)["'][^>]*>[^<]+<\/option>/gi) || [];
      for (const opt of optMatches) {
        const textMatch = opt.match(/<option[^>]*>([\s\S]*?)<\/option>/i);
        if (textMatch) {
          const colorName = stripHtml(textMatch[1]).trim();
          if (colorName && !seenColors.has(colorName) && colorName !== 'オプションを選択' && colorName !== '選択してください') {
            seenColors.add(colorName);
            colors.push({ name: colorName, imageUrl: mainImage });
          }
        }
      }
    }
  }

  // Pattern 3: Color swatches (WooCommerce Variation Swatches plugin)
  if (colors.length === 0) {
    const swatchRe = /<(?:div|span|li)[^>]*(?:class=["'][^"']*swatch|data-value=["'][^"']+["'])[^>]*>/gi;
    const swatchMatches = html.match(swatchRe) || [];
    for (const swatch of swatchMatches) {
      const titleMatch = swatch.match(/title=["']([^"']+)["']/i)
        || swatch.match(/data-value=["']([^"']+)["']/i);
      if (titleMatch) {
        const colorName = titleMatch[1].trim();
        if (colorName && !seenColors.has(colorName)) {
          seenColors.add(colorName);
          colors.push({ name: colorName, imageUrl: mainImage });
        }
      }
    }
  }

  // Pattern 4: WooCommerce gallery images as fallback
  if (colors.length === 0) {
    const galleryImgMatches = html.match(/woocommerce-product-gallery__image[\s\S]*?<img[^>]+(?:src|data-large_image)=["']([^"']+)["'][^>]*/gi) || [];
    for (const imgBlock of galleryImgMatches) {
      const srcMatch = imgBlock.match(/(?:data-large_image|src)=["']([^"']+)["']/i);
      const altMatch = imgBlock.match(/alt=["']([^"']+)["']/i);
      if (srcMatch && altMatch) {
        const colorName = altMatch[1].trim();
        if (colorName && !seenColors.has(colorName)) {
          seenColors.add(colorName);
          colors.push({ name: colorName, imageUrl: makeAbsolute(srcMatch[1]) });
        }
      }
    }
  }

  log(`Colors: ${colors.length}`);

  // --- Type detection ---
  const type = detectType(name, description, categoryText);
  log(`Type: ${type}`);

  // --- Target fish ---
  const target_fish = deriveTargetFish(name, description, categoryText);
  log(`Target fish: [${target_fish.join(', ')}]`);

  const result: ScrapedLure = {
    name,
    name_kana: '',
    slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
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

  log(`Done: ${name} | type=${type} | colors=${colors.length} | weights=[${weights.join(',')}] | length=${length}mm | price=${price}`);
  return result;
};
