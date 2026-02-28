// scripts/scrapers/jazz-lure.ts
// JAZZ (jazz-lure.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: WordPress (custom theme)
// Product URL pattern: https://www.jazz-lure.com/product/{slug}
// Structure: h2.main_h2 for product name, spec table with
//   型番/length/weight/price columns, color thumbnails with alt text
// Types: ジグヘッド, ワーム, メタルジグ, etc.
// Target fish: アジ, メバル

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'JAZZ';
const MANUFACTURER_SLUG = 'jazz';
const SITE_BASE = 'https://www.jazz-lure.com';
const DEFAULT_TARGET_FISH = ['アジ', 'メバル'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ジグヘッド|jig\s*head/i, 'ジグヘッド'],
  [/ワーム|worm/i, 'ワーム'],
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/ミノー|minnow/i, 'ミノー'],
  [/シンキングペンシル|シンペン|sinking\s*pencil/i, 'シンキングペンシル'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/メタルバイブ|metal\s*vib/i, 'メタルバイブ'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/プラグ|plug/i, 'プラグ'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/クランク|crank/i, 'クランクベイト'],
  [/スプーン|spoon/i, 'スプーン'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [jazz] ${msg}`);
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

function detectType(name: string, description: string, categoryText: string): string {
  const combined = `${name} ${description} ${categoryText}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return typeName;
  }
  return 'ルアー';
}

function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  const taxInclMatch = cleaned.match(/税込[^\d]*([\d,]+)/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円?[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  // "price(税抜)" → x1.1
  const taxExclMatch = cleaned.match(/([\d,]+)円?[（(]税(?:別|抜)/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  // ￥1,900 pattern (common on jazz-lure.com)
  const yenMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

  const plainMatch = cleaned.match(/([\d,]+)円/);
  if (plainMatch) return parseInt(plainMatch[1].replace(/,/g, ''), 10);

  return 0;
}

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

function deriveTargetFish(name: string, description: string): string[] {
  const combined = `${name} ${description}`;
  const fish: string[] = [];

  if (/アジ|アジング|aji/i.test(combined)) fish.push('アジ');
  if (/メバル|メバリング/i.test(combined)) fish.push('メバル');
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/カサゴ|ガシラ|ロック|根魚/i.test(combined)) fish.push('ロックフィッシュ');
  if (/タチウオ|太刀魚/i.test(combined)) fish.push('タチウオ');
  if (/青物|ショアジギ/i.test(combined)) fish.push('青物');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

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

export const scrapeJazzPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
  // JAZZ uses h2.main_h2 for product names
  let name = '';
  const mainH2Match = html.match(/<h2[^>]*class=["'][^"']*main_h2[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
  if (mainH2Match) name = stripHtml(mainH2Match[1]).trim();
  if (!name) {
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) name = stripHtml(h2Match[1]).trim();
  }
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) name = stripHtml(h1Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*\|\s*JAZZ.*$/i, '').trim();
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
  // Jazz uses wp-content/uploads images; the main product image has "SPEC" in alt
  let mainImage = '';
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) mainImage = ogImageMatch[1];
  if (!mainImage) {
    // Find the main product image (usually first large upload image)
    const mainImgMatch = html.match(/<img[^>]+src=["']([^"']*wp-content\/uploads[^"']*(?:332x332|main)[^"']*)["']/i);
    if (mainImgMatch) mainImage = mainImgMatch[1];
  }
  if (!mainImage) {
    // Any upload image
    const uploadImgMatch = html.match(/<img[^>]+src=["']([^"']*wp-content\/uploads[^"']*)["']/i);
    if (uploadImgMatch) mainImage = uploadImgMatch[1];
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Category text (from related product links or breadcrumb) ---
  let categoryText = '';
  const productCatMatch = html.match(/product_cat\/([^/"']+)/i);
  if (productCatMatch) categoryText = productCatMatch[1].replace(/_/g, ' ');

  // --- Description ---
  let description = '';
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (metaDescMatch && metaDescMatch[1].length > 20) {
    description = stripHtml(metaDescMatch[1]).substring(0, 500);
  }
  if (!description) {
    // Look for descriptive text in the main content area
    const mainInnerMatch = html.match(/<div[^>]*class=["'][^"']*main_inner[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (mainInnerMatch) {
      const pMatches = mainInnerMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      for (const p of pMatches) {
        const text = stripHtml(p).trim();
        if (text.length > 30 && !/SPEC|カラー|型番|関連商品/i.test(text.substring(0, 20))) {
          description = text.replace(/\s+/g, ' ').substring(0, 500);
          break;
        }
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Spec table parsing ---
  // Jazz tables have columns: 型番 | length | weight | price(税抜)
  let price = 0;
  let weights: number[] = [];
  let length: number | null = null;
  let specText = '';

  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const tableText = stripHtml(tableHtml);
    specText += ' ' + tableText;
    const rows = parseTableRows(tableHtml);

    if (rows.length >= 2) {
      const headers = rows[0].map(h => h.toLowerCase());
      const weightIdx = headers.findIndex(h => /weight|重量|ウエイト/i.test(h));
      const lengthIdx = headers.findIndex(h => /length|全長|サイズ|size/i.test(h));
      const priceIdx = headers.findIndex(h => /price|価格|円/i.test(h));

      for (let r = 1; r < rows.length; r++) {
        if (weightIdx >= 0 && rows[r][weightIdx]) weights = weights.concat(parseWeights(rows[r][weightIdx]));
        if (lengthIdx >= 0 && length === null && rows[r][lengthIdx]) length = parseLength(rows[r][lengthIdx]);
        if (priceIdx >= 0 && price === 0 && rows[r][priceIdx]) price = parsePrice(rows[r][priceIdx]);
      }
    }

    // Key-value fallback
    for (const cells of rows) {
      if (cells.length >= 2) {
        const label = cells[0].toLowerCase();
        const value = cells[1];
        if (/weight|重量|ウエイト/i.test(label) && weights.length === 0) weights = parseWeights(value);
        if (/length|全長|サイズ/i.test(label) && length === null) length = parseLength(value);
        if (/price|価格|円/i.test(label) && price === 0) price = parsePrice(value);
      }
    }
  }

  if (weights.length === 0) weights = parseWeights(specText);
  if (length === null) length = parseLength(specText);
  if (price === 0) price = parsePrice(specText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  // Jazz uses thumbnail images in wp-content/uploads with alt text for color names
  // Color images are ~109x109 and have short alt text like "ｵｲｶﾜ", "ﾎｯﾄﾀｲｶﾞｰ"
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Find color images: small thumbnails with short alt text (not the main image)
  const imgMatches = html.match(/<img[^>]+src=["'][^"']*wp-content\/uploads[^"']*["'][^>]*>/gi) || [];
  for (const imgTag of imgMatches) {
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
    if (srcMatch && altMatch) {
      const colorName = altMatch[1].trim();
      const src = srcMatch[1];
      // Filter: color images are small thumbnails (109x109) with short alt text
      // Exclude main product images and SPEC images
      if (colorName && colorName.length > 0 && colorName.length < 30 &&
          !seenColors.has(colorName) &&
          !/SPEC|画像|logo|navi|banner/i.test(colorName) &&
          /109x109|150x150|100x100/i.test(src)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: makeAbsolute(src) });
      }
    }
  }

  // Fallback: any uploads img with short alt that's not the main image
  if (colors.length === 0) {
    for (const imgTag of imgMatches) {
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
      if (srcMatch && altMatch) {
        const colorName = altMatch[1].trim();
        const src = srcMatch[1];
        if (colorName && colorName.length > 0 && colorName.length < 30 &&
            !seenColors.has(colorName) &&
            !/SPEC|画像|logo|navi|banner|main/i.test(colorName) &&
            src !== mainImage) {
          seenColors.add(colorName);
          colors.push({ name: colorName, imageUrl: makeAbsolute(src) });
        }
      }
    }
  }

  log(`Colors: ${colors.length}`);

  const type = detectType(name, description, categoryText);
  log(`Type: ${type}`);

  const target_fish = deriveTargetFish(name, description);
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
