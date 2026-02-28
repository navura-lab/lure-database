// scripts/scrapers/grassroots.ts
// GRASS ROOTS (grassroots-fishing.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: Static/WordPress
// Product URL pattern: https://grassroots-fishing.com/products/{slug}/ or similar
// Types: メタルジグ, etc.
// Target fish: 青物

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'GRASS ROOTS';
const MANUFACTURER_SLUG = 'grassroots';
const SITE_BASE = 'https://grassroots-fishing.com';
const DEFAULT_TARGET_FISH = ['青物'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/メタルバイブ|metal\s*vib/i, 'メタルバイブ'],
  [/ジグ|jig/i, 'メタルジグ'],
  [/ミノー|minnow/i, 'ミノー'],
  [/シンキングペンシル|シンペン|sinking\s*pencil/i, 'シンキングペンシル'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/プラグ|plug/i, 'プラグ'],
  [/タイラバ|鯛ラバ/i, 'タイラバ'],
  [/インチク/i, 'インチク'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [grassroots] ${msg}`);
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
  return 'メタルジグ';
}

function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  const taxInclMatch = cleaned.match(/税込[^\d]*([\d,]+)/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  const taxExclMatch = cleaned.match(/([\d,]+)円[（(]税(?:別|抜)/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

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

  if (/青物|ブリ|ヒラマサ|カンパチ|ショアジギ/i.test(combined)) fish.push('青物');
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/マダイ|真鯛|タイラバ/i.test(combined)) fish.push('マダイ');
  if (/タチウオ|太刀魚/i.test(combined)) fish.push('タチウオ');
  if (/ヒラメ|マゴチ|フラット/i.test(combined)) fish.push('ヒラメ');
  if (/根魚|ロック|カサゴ|ハタ/i.test(combined)) fish.push('ロックフィッシュ');

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

export const scrapeGrassrootsPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
  const entryTitleMatch = html.match(/<h1[^>]*class=["'][^"']*(?:entry-title|post-title|product-title)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (entryTitleMatch) name = stripHtml(entryTitleMatch[1]).trim();
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) name = stripHtml(h1Match[1]).trim();
  }
  if (!name) {
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) name = stripHtml(h2Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜].*$/, '').replace(/\s*-\s*GRASS.*$/i, '').trim();
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
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    slug = lastSegment.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  } catch { /* ignore */ }
  if (!slug) slug = slugify(name);
  log(`Slug: ${slug}`);

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) mainImage = ogImageMatch[1];
  if (!mainImage) {
    const wpImgMatch = html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (wpImgMatch) mainImage = wpImgMatch[1];
  }
  if (!mainImage) {
    const firstImgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
    if (firstImgMatch) mainImage = firstImgMatch[1];
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
    const contentMatch = html.match(/<div[^>]*class=["'][^"']*(?:entry-content|product-content|post-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (contentMatch) {
      const pMatches = contentMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      for (const p of pMatches) {
        const text = stripHtml(p).trim();
        if (text.length > 30 && !/spec|スペック|カラー|color|価格|price|重量/i.test(text.substring(0, 30))) {
          description = text.substring(0, 500);
          break;
        }
      }
    }
  }
  if (!description) {
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 30 && !/spec|スペック|カラー|color|価格|price|重量/i.test(text.substring(0, 30))) {
        description = text.substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Spec table parsing ---
  let price = 0;
  let weights: number[] = [];
  let length: number | null = null;
  let specText = '';

  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const tableText = stripHtml(tableHtml);
    if (/重量|ウエイト|weight|全長|length|サイズ|size|価格|price|円/i.test(tableText)) {
      specText += ' ' + tableText;
      const rows = parseTableRows(tableHtml);

      for (const cells of rows) {
        if (cells.length >= 2) {
          const label = cells[0].toLowerCase();
          const value = cells[1];

          if (/重量|ウエイト|weight/i.test(label)) weights = weights.concat(parseWeights(value));
          if (/全長|length|サイズ|レングス|size/i.test(label) && length === null) length = parseLength(value);
          if (/価格|price|円/i.test(label) && price === 0) price = parsePrice(value);
        }
      }

      if (rows.length >= 2) {
        const headers = rows[0].map(h => h.toLowerCase());
        const weightIdx = headers.findIndex(h => /重量|ウエイト|weight/i.test(h));
        const lengthIdx = headers.findIndex(h => /全長|length|サイズ|size/i.test(h));
        const priceIdx = headers.findIndex(h => /価格|price|円/i.test(h));

        for (let r = 1; r < rows.length; r++) {
          if (weightIdx >= 0 && rows[r][weightIdx]) weights = weights.concat(parseWeights(rows[r][weightIdx]));
          if (lengthIdx >= 0 && length === null && rows[r][lengthIdx]) length = parseLength(rows[r][lengthIdx]);
          if (priceIdx >= 0 && price === 0 && rows[r][priceIdx]) price = parsePrice(rows[r][priceIdx]);
        }
      }
    }
  }

  const bodyText = stripHtml(html);
  if (weights.length === 0) weights = parseWeights(specText || bodyText);
  if (length === null) length = parseLength(specText || bodyText);
  if (price === 0) price = parsePrice(specText || bodyText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  const figureMatches = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
  for (const fig of figureMatches) {
    const imgMatch = fig.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    const captionMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch && captionMatch) {
      const colorName = stripHtml(captionMatch[1]).trim();
      if (colorName && colorName.length < 50 && !seenColors.has(colorName) &&
          !/spec|スペック|price|価格/i.test(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  if (colors.length === 0) {
    const colorImgMatches = html.match(/<img[^>]+src=["'][^"']*(?:color|col_|カラー)[^"']*["'][^>]*>/gi) || [];
    for (const imgTag of colorImgMatches) {
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
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
