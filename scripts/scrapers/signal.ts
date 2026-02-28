// scripts/scrapers/signal.ts
// SIGNAL (signal-lure.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: Static HTML (minimal product pages)
// Product URL pattern: http://www.signal-lure.com/products/item{N}.html
// Specs embedded in images; limited text content on pages
// Types: ミノー, クランクベイト, スイムベイト
// Target fish: シーバス

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'SIGNAL';
const MANUFACTURER_SLUG = 'signal';
const SITE_BASE = 'http://www.signal-lure.com';
const DEFAULT_TARGET_FISH = ['シーバス'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ミノー|minnow/i, 'ミノー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/シンキングペンシル|シンペン|sinking\s*pencil/i, 'シンキングペンシル'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/クランク|crank/i, 'クランクベイト'],
  [/スイムベイト|swim\s*bait|swimmer/i, 'スイムベイト'],
  [/バズベイト|buzz/i, 'バズベイト'],
  [/クローラー|crawler/i, 'クローラーベイト'],
  [/ビッグベイト|big\s*bait/i, 'ビッグベイト'],
  [/ワーム|worm|soft/i, 'ワーム'],
  [/メタルジグ|metal\s*jig|ジグ/i, 'メタルジグ'],
  [/スプーン|spoon/i, 'スプーン'],
  [/プラグ|plug/i, 'プラグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [signal] ${msg}`);
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
  if (href.startsWith('//')) return 'http:' + href;
  if (href.startsWith('/')) return SITE_BASE + href;
  if (href.startsWith('../')) return SITE_BASE + '/' + href.replace(/^\.\.\//, '');
  return SITE_BASE + '/' + href;
}

function detectType(name: string, description: string): string {
  const combined = `${name} ${description}`;
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

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  const taxExclMatch = cleaned.match(/([\d,]+)円[（(]税別/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  const plainMatch = cleaned.match(/([\d,]+)円/);
  if (plainMatch) return parseInt(plainMatch[1].replace(/,/g, ''), 10);

  const yenMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

  return 0;
}

function parseWeights(text: string): number[] {
  if (!text) return [];
  const weights: number[] = [];
  const normalized = text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/ｇ/g, 'g');

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
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

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

  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/ブラックバス|バス釣り|bass/i.test(combined)) fish.push('ブラックバス');
  if (/ナマズ|鯰|catfish/i.test(combined)) fish.push('ナマズ');
  if (/ヒラメ|マゴチ|フラット/i.test(combined)) fish.push('ヒラメ');
  if (/青物|ショアジギ/i.test(combined)) fish.push('青物');
  if (/トラウト|trout/i.test(combined)) fish.push('トラウト');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export const scrapeSignalPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) name = stripHtml(h1Match[1]).trim();
  if (!name) {
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) name = stripHtml(h2Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜].*$/, '').replace(/\s*SIGNAL.*$/i, '').trim();
  }
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*[|｜].*$/, '').trim();
  }
  // Signal pages often have minimal text -- try extracting from image alt text
  if (!name || name === 'Unknown' || /SIGNAL|シグナル|公式/.test(name)) {
    const altMatch = html.match(/<img[^>]+alt=["']([^"']+)["'][^>]*src=["'][^"']*lure/i);
    if (altMatch) name = stripHtml(altMatch[1]).trim();
  }
  if (!name) name = 'Unknown';
  log(`Product name: ${name}`);

  // --- Slug from URL ---
  let slug = '';
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    slug = lastSegment.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  } catch { /* ignore */ }
  if (!slug) slug = slugify(name);
  log(`Slug: ${slug}`);

  // --- Main image ---
  let mainImage = '';
  // Look for product/lure image
  const lureImgMatch = html.match(/<img[^>]+src=["']([^"']*(?:lure|product)[^"']*\.(?:jpg|jpeg|png|webp|gif))["']/i);
  if (lureImgMatch) mainImage = lureImgMatch[1];
  if (!mainImage) {
    const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
    if (ogImageMatch) mainImage = ogImageMatch[1];
  }
  if (!mainImage) {
    const firstImg = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
    if (firstImg) mainImage = firstImg[1];
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Description ---
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
      if (text.length > 30 && !/copyright|©|menu|nav/i.test(text)) {
        description = text.substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Specs from page text ---
  const bodyText = stripHtml(html);
  let price = parsePrice(bodyText);
  let weights = parseWeights(bodyText);
  let length = parseLength(bodyText);

  // Also try parsing from any table or dl structures
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const tableText = stripHtml(tableHtml);
    if (/重量|ウエイト|weight|全長|length|価格|price|円/i.test(tableText)) {
      if (weights.length === 0) weights = parseWeights(tableText);
      if (length === null) length = parseLength(tableText);
      if (price === 0) price = parsePrice(tableText);
    }
  }

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Look for color chart image
  const colorImgMatch = html.match(/<img[^>]+src=["']([^"']*color[^"']*)["']/i);
  if (colorImgMatch) {
    // Signal uses a single color chart image; no individual color names in HTML
    colors.push({ name: 'カラーチャート', imageUrl: makeAbsolute(colorImgMatch[1]) });
  }

  // Try figure/figcaption pattern
  const figureMatches = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
  for (const fig of figureMatches) {
    const imgMatch = fig.match(/<img[^>]+src=["']([^"']+)["']/i);
    const captionMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch && captionMatch) {
      const colorName = stripHtml(captionMatch[1]).trim();
      if (colorName && !seenColors.has(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  // Try alt-text based color images
  if (colors.length <= 1) {
    const imgMatches = html.match(/<img[^>]+alt=["']([^"']+)["'][^>]+src=["']([^"']+)["']/gi) || [];
    for (const imgTag of imgMatches) {
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      if (altMatch && srcMatch && /color|カラー/i.test(srcMatch[1])) {
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
  const type = detectType(name, description);
  log(`Type: ${type}`);

  // --- Target fish ---
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
