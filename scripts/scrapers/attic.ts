// scripts/scrapers/attic.ts
// ATTIC (attic.ne.jp) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: Static HTML
// Product URL pattern: https://www.attic.ne.jp/{slug}.html
// Types: ミノー, シンキングペンシル, etc.
// Target fish: シーバス

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'ATTIC';
const MANUFACTURER_SLUG = 'attic';
const SITE_BASE = 'https://www.attic.ne.jp';
const DEFAULT_TARGET_FISH = ['シーバス'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/ミノー|minnow/i, 'ミノー'],
  [/シンキングペンシル|シンペン|sinking\s*pencil/i, 'シンキングペンシル'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/クランク|crank/i, 'クランクベイト'],
  [/ジョイント|joint/i, 'ジョイントベイト'],
  [/トップウォーター|topwater/i, 'トップウォーター'],
  [/プラグ|plug/i, 'プラグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [attic] ${msg}`);
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

  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/青物|ショアジギ|ブリ|ヒラマサ/i.test(combined)) fish.push('青物');
  if (/ヒラメ|マゴチ|フラット|サーフ/i.test(combined)) fish.push('ヒラメ');
  if (/チヌ|クロダイ/i.test(combined)) fish.push('チヌ');
  if (/メバル/i.test(combined)) fish.push('メバル');
  if (/タチウオ|太刀魚/i.test(combined)) fish.push('タチウオ');

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

export const scrapeAtticPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜].*$/, '').replace(/\s*-\s*ATTIC.*$/i, '').trim();
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
  // Priority: og:image > first image inside post_content (skip logo_image)
  let mainImage = '';
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) {
    const ogUrl = ogImageMatch[1];
    // サイト共通画像（topview, banner, logo等）はスキップ
    if (!/topview|banner|logo|header|favicon/i.test(ogUrl)) {
      mainImage = ogUrl;
    }
  }
  if (!mainImage) {
    // Look for first real product image inside post_content, excluding logos
    const contentMatch = html.match(/<div\s+class="post_content[^"]*">([\s\S]*?)<\/article>/i);
    if (contentMatch) {
      const contentImgs = contentMatch[1].match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["'][^>]*>/gi) || [];
      for (const imgTag of contentImgs) {
        if (/class="[^"]*logo_image/i.test(imgTag)) continue;
        const srcM = imgTag.match(/src=["']([^"']+)["']/i);
        if (srcM) { mainImage = srcM[1]; break; }
      }
    }
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
    // Look for <p> inside post_content, skip buttons/links-only paragraphs
    const contentBlock = html.match(/<div\s+class="post_content[^"]*">([\s\S]*?)<\/article>/i);
    const searchHtml = contentBlock ? contentBlock[1] : html;
    const pMatches = searchHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 30
        && !/spec|スペック|カラー|color|価格|price|重量/i.test(text.substring(0, 30))
        && !/ONLINE\s*SHOP|購入/i.test(text.substring(0, 30))) {
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

          if (/重量|ウエイト|weight/i.test(label)) {
            weights = weights.concat(parseWeights(value));
          }
          if (/全長|length|サイズ|レングス|size/i.test(label) && length === null) {
            length = parseLength(value);
          }
          if (/価格|price|円/i.test(label) && price === 0) {
            price = parsePrice(value);
          }
        }
      }

      // Columnar table
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

  // Fallback from body text
  const bodyText = stripHtml(html);
  if (weights.length === 0) weights = parseWeights(specText || bodyText);
  if (length === null) length = parseLength(specText || bodyText);
  if (price === 0) price = parsePrice(specText || bodyText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  // ATTIC site uses <table><caption>COLOR</caption> with <th> for color names.
  // There are NO color-specific images — just text names in the table.
  // Each color gets the mainImage as its shared product image.
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Primary: Extract from COLOR table (<caption>COLOR</caption> → <th> cells)
  for (const tableHtml of tableMatches) {
    if (/<caption[^>]*>\s*COLOR\s*<\/caption>/i.test(tableHtml)) {
      const rows = parseTableRows(tableHtml);
      for (const cells of rows) {
        if (cells.length >= 1) {
          let colorName = cells[0].trim();
          // Remove JAN prefix/number patterns if in first cell
          if (/^JAN/i.test(colorName)) continue;
          // Clean up "#1 アユ" → "アユ", remove "(2023年新色)" etc.
          colorName = colorName
            .replace(/^\s*#?\d+\s*/, '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s*[（(]\d{4}年[^)）]*[)）]\s*/g, '')
            .replace(/\s*[（(]新色[)）]\s*/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (colorName && colorName.length < 50 && !seenColors.has(colorName)) {
            seenColors.add(colorName);
            colors.push({ name: colorName, imageUrl: mainImage });
          }
        }
      }
    }
  }

  // Fallback: Look for カラー row in SPEC table that lists color names
  if (colors.length === 0) {
    for (const tableHtml of tableMatches) {
      if (/<caption[^>]*>\s*SPEC\s*<\/caption>/i.test(tableHtml)) {
        const rows = parseTableRows(tableHtml);
        for (const cells of rows) {
          if (cells.length >= 2 && /カラー|color/i.test(cells[0])) {
            // Sometimes lists color names separated by / or 、
            const colorText = cells[1];
            if (/[/、・]/.test(colorText)) {
              const names = colorText.split(/[/、・]/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 50);
              for (const cn of names) {
                if (!seenColors.has(cn)) {
                  seenColors.add(cn);
                  colors.push({ name: cn, imageUrl: mainImage });
                }
              }
            }
          }
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
