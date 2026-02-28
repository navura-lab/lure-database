// scripts/scrapers/itocraft.ts
// ITO.CRAFT (itocraft.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: WordPress (static-like)
// Product URL pattern: https://itocraft.com/products/lurelist/ (all lures on one page)
//   or individual sections at https://itocraft.com/products/lurelist/#{anchor}
// The scraper handles both the lurelist page (anchor-based) and potential
// individual product pages.
// Types: ミノー, スプーン
// Target fish: トラウト

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'ITO.CRAFT';
const MANUFACTURER_SLUG = 'itocraft';
const SITE_BASE = 'https://itocraft.com';
const DEFAULT_TARGET_FISH = ['トラウト'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ミノー|minnow/i, 'ミノー'],
  [/スプーン|spoon/i, 'スプーン'],
  [/クランク|crank/i, 'クランクベイト'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/プラグ|plug/i, 'プラグ'],
  [/ジグ|jig/i, 'メタルジグ'],
  [/バイブ|vib/i, 'バイブレーション'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [itocraft] ${msg}`);
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

function detectType(name: string, description: string): string {
  const combined = `${name} ${description}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return typeName;
  }
  return 'ミノー';
}

function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  const taxInclMatch = cleaned.match(/税込[^\d]*([\d,]+)/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円?[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  const taxExclMatch = cleaned.match(/([\d,]+)円?[（(]税(?:別|抜)/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  const yenMatch = cleaned.match(/[¥￥]([\d,]+)[（(]税込/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

  const yenPlainMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenPlainMatch) return parseInt(yenPlainMatch[1].replace(/,/g, ''), 10);

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
  const re = /([\d.]+)\s*g(?:\s*[（(]フック含む[）)])?/gi;
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

  if (/トラウト|マス|ニジマス|イワナ|ヤマメ|trout/i.test(combined)) fish.push('トラウト');
  if (/渓流|ネイティブ|native/i.test(combined)) fish.push('トラウト');
  if (/サクラマス/i.test(combined)) fish.push('サクラマス');
  if (/サーモン|鮭/i.test(combined)) fish.push('サーモン');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

/**
 * Scrapes a single product page from ITO.CRAFT.
 * The site uses https://itocraft.com/products/lurelist/ as a catalog page
 * with individual product sections. Each section has SPEC data inline.
 * This scraper handles individual URLs that may be passed with anchor hashes.
 */
export const scrapeItocraftPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  log(`Starting scrape: ${url}`);

  const res = await fetch(url.split('#')[0], {
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
  // Try h1 first
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) name = stripHtml(h1Match[1]).trim();
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜].*$/, '').replace(/\s*-\s*イトウクラフト.*$/i, '').trim();
  }
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*[|｜-].*$/, '').trim();
  }
  if (!name) name = 'Unknown';
  log(`Product name: ${name}`);

  // --- Slug from URL ---
  let slug = '';
  try {
    const urlObj = new URL(url);
    // Check for hash anchor (e.g., #bowie50s)
    if (urlObj.hash) {
      slug = urlObj.hash.replace('#', '').toLowerCase();
    }
    if (!slug) {
      const segments = urlObj.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';
      slug = lastSegment.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
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
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+(?:lure|product|minnow|spoon)[^"']*)["']/i);
    if (imgMatch) mainImage = imgMatch[1];
  }
  if (!mainImage) {
    const wpImgMatch = html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (wpImgMatch) mainImage = wpImgMatch[1];
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Description ---
  // ITO.CRAFT products have descriptive text in paragraphs following the product name
  let description = '';
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (metaDescMatch && metaDescMatch[1].length > 20) {
    description = stripHtml(metaDescMatch[1]).substring(0, 500);
  }
  if (!description) {
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 30 && !/SPEC|SIZE|TYPE|SYSTEM|HOOK|MATERIAL|PRICE|DETAILS|Gallery/i.test(text.substring(0, 30)) &&
          !/HOME|PRODUCTS|SUPPORT|ABOUT|NEWS|COPYRIGHT/i.test(text)) {
        description = text.replace(/\s+/g, ' ').substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Spec parsing ---
  // ITO.CRAFT uses inline SPEC blocks like:
  // SIZE 50mm, TYPE SINKING, WT 4.0g(フック含む), HOOK #12, PRICE ¥3,960(税込)
  let price = 0;
  let weights: number[] = [];
  let length: number | null = null;

  const bodyText = stripHtml(html);

  // Try parsing spec from structured text patterns
  const sizeMatch = bodyText.match(/SIZE\s+([\d.]+)\s*mm/i);
  if (sizeMatch) length = parseLength(sizeMatch[0]);

  const wtMatch = bodyText.match(/WT\s+([\d.]+)\s*g/i);
  if (wtMatch) weights = parseWeights(wtMatch[0]);

  const priceMatch = bodyText.match(/PRICE\s*[¥￥]([\d,]+)/i);
  if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

  // Also try table-based spec parsing
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const tableText = stripHtml(tableHtml);
    if (/SIZE|WT|WEIGHT|PRICE|重量|全長|価格/i.test(tableText)) {
      const trMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const tr of trMatches) {
        const cells: string[] = [];
        const cellMatches = tr.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [];
        for (const cell of cellMatches) cells.push(stripHtml(cell));
        if (cells.length >= 2) {
          const label = cells[0].toLowerCase();
          const value = cells[1];
          if (/size|全長|length/i.test(label) && length === null) length = parseLength(value);
          if (/wt|weight|重量/i.test(label) && weights.length === 0) weights = parseWeights(value);
          if (/price|価格|円/i.test(label) && price === 0) price = parsePrice(value);
        }
      }
    }
  }

  // Fallback
  if (weights.length === 0) weights = parseWeights(bodyText);
  if (length === null) length = parseLength(bodyText);
  if (price === 0) price = parsePrice(bodyText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  // ITO.CRAFT generally does not show colors on individual product pages; they use gallery
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  const figureMatches = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
  for (const fig of figureMatches) {
    const imgMatch = fig.match(/<img[^>]+src=["']([^"']+)["']/i);
    const captionMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch && captionMatch) {
      const colorName = stripHtml(captionMatch[1]).trim();
      if (colorName && colorName.length < 50 && !seenColors.has(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  if (colors.length === 0) {
    const colorImgMatches = html.match(/<img[^>]+alt=["']([^"']+)["'][^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
    for (const imgTag of colorImgMatches) {
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
      if (srcMatch && altMatch && /color|カラー/i.test(srcMatch[1] + altMatch[1])) {
        const colorName = altMatch[1].trim();
        if (colorName && !seenColors.has(colorName)) {
          seenColors.add(colorName);
          colors.push({ name: colorName, imageUrl: makeAbsolute(srcMatch[1]) });
        }
      }
    }
  }

  log(`Colors: ${colors.length}`);

  const type = detectType(name, description);
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
