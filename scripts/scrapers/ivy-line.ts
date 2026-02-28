// scripts/scrapers/ivy-line.ts
// IVY LINE (ivyline.jp) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: WordPress (SWELL theme)
// Product URL pattern: https://www.ivyline.jp/products/{slug}/
// Category pages: /brand/cat-il/cat-il-spoon/, /brand/cat-hs/cat-hs-spoon/
// Product pages have: h1 for name (e.g. "Penta / ペンタ"), SPEC tables with
//   Name/Weight/Size/Hook/Price columns, COLOR CHART sections with color images
// Types: スプーン, プラグ, メタルバイブ
// Target fish: トラウト

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'IVY LINE';
const MANUFACTURER_SLUG = 'ivy-line';
const SITE_BASE = 'https://www.ivyline.jp';
const DEFAULT_TARGET_FISH = ['トラウト'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/スプーン|spoon/i, 'スプーン'],
  [/メタルバイブ|metal\s*vib/i, 'メタルバイブ'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/クランク|crank/i, 'クランクベイト'],
  [/ミノー|minnow/i, 'ミノー'],
  [/プラグ|plug/i, 'プラグ'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/ジグ|jig/i, 'メタルジグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [ivy-line] ${msg}`);
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

function detectType(name: string, description: string, breadcrumb: string): string {
  const combined = `${name} ${description} ${breadcrumb}`;
  for (const [pattern, typeName] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return typeName;
  }
  return 'スプーン';
}

function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  const taxInclMatch = cleaned.match(/税込[^\d]*([\d,]+)/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  const priceWithTaxMatch = cleaned.match(/([\d,]+)円?[（(]税込/);
  if (priceWithTaxMatch) return parseInt(priceWithTaxMatch[1].replace(/,/g, ''), 10);

  // "+税" pattern: tax-excluded
  const plusTaxMatch = cleaned.match(/[¥￥]([\d,]+)\s*[（(]\+税/);
  if (plusTaxMatch) return Math.round(parseInt(plusTaxMatch[1].replace(/,/g, ''), 10) * 1.1);

  const taxExclMatch = cleaned.match(/([\d,]+)円?[（(]税(?:別|抜)/);
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
  // Handle patterns like "1.0g / 1.3g" and "1.7g / 2.5g"
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

  if (/トラウト|マス|ニジマス|イワナ|ヤマメ|trout/i.test(combined)) fish.push('トラウト');
  if (/エリア|area|管理釣り場|管釣り/i.test(combined)) fish.push('トラウト');
  if (/ネイティブ|native|渓流/i.test(combined)) fish.push('トラウト');

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

export const scrapeIvyLinePage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
  // IVY LINE uses h1 with product name like "Penta / ペンタ"
  let name = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) name = stripHtml(h1Match[1]).trim();
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1])
      .replace(/\s*-\s*愛知県.*$/i, '')
      .replace(/\s*[|｜].*$/, '')
      .trim();
  }
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*-\s*愛知.*$/, '').replace(/\s*[|｜].*$/, '').trim();
  }
  if (!name) name = 'Unknown';
  log(`Product name: ${name}`);

  // --- Slug from URL ---
  let slug = '';
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    const productsIdx = segments.indexOf('products');
    if (productsIdx >= 0 && segments[productsIdx + 1]) {
      slug = segments[productsIdx + 1].toLowerCase();
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
    const wpImgMatch = html.match(/<img[^>]+class=["'][^"']*wp-post-image[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (wpImgMatch) mainImage = wpImgMatch[1];
  }
  if (!mainImage) {
    // SWELL theme often uses c-postThumb__img
    const thumbMatch = html.match(/<img[^>]+class=["'][^"']*(?:postThumb|post-thumbnail)[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (thumbMatch) mainImage = thumbMatch[1];
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Breadcrumb (for type detection) ---
  let breadcrumb = '';
  const breadcrumbMatch = html.match(/<(?:nav|div)[^>]*class=["'][^"']*breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/(?:nav|div)>/i);
  if (breadcrumbMatch) breadcrumb = stripHtml(breadcrumbMatch[1]);

  // --- Description ---
  let description = '';
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (metaDescMatch && metaDescMatch[1].length > 20) {
    description = stripHtml(metaDescMatch[1]).substring(0, 500);
  }
  if (!description) {
    // SWELL theme content
    const contentMatch = html.match(/<div[^>]*class=["'][^"']*(?:post_content|entry-content|swell-block)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (contentMatch) {
      const pMatches = contentMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      for (const p of pMatches) {
        const text = stripHtml(p).trim();
        if (text.length > 30 && !/SPEC|FEATURE|COLOR|スペック|カラー|特長/i.test(text.substring(0, 15))) {
          description = text.replace(/\s+/g, ' ').substring(0, 500);
          break;
        }
      }
    }
  }
  if (!description) {
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 40 && !/SPEC|COLOR|HOME|PRODUCTS|特長|スペック|カラー/i.test(text.substring(0, 15))) {
        description = text.replace(/\s+/g, ' ').substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Spec table parsing ---
  // IVY LINE uses tables with columns: Name | Weight | Size | Hook | Price
  // e.g.: ペンタ | 1.0g / 1.3g | 19mm | Mantis NANO #8 | ￥530 (+税)
  let price = 0;
  let weights: number[] = [];
  let length: number | null = null;
  let specText = '';

  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const tableText = stripHtml(tableHtml);
    if (/weight|size|price|hook|重量|サイズ|価格|￥|¥/i.test(tableText)) {
      specText += ' ' + tableText;
      const rows = parseTableRows(tableHtml);

      if (rows.length >= 2) {
        const headers = rows[0].map(h => h.toLowerCase());
        const weightIdx = headers.findIndex(h => /weight|重量|ウエイト/i.test(h));
        const sizeIdx = headers.findIndex(h => /size|サイズ|全長|length/i.test(h));
        const priceIdx = headers.findIndex(h => /price|価格|円/i.test(h));

        for (let r = 1; r < rows.length; r++) {
          if (weightIdx >= 0 && rows[r][weightIdx]) weights = weights.concat(parseWeights(rows[r][weightIdx]));
          if (sizeIdx >= 0 && length === null && rows[r][sizeIdx]) length = parseLength(rows[r][sizeIdx]);
          if (priceIdx >= 0 && price === 0 && rows[r][priceIdx]) price = parsePrice(rows[r][priceIdx]);
        }
      }

      // Key-value style
      for (const cells of rows) {
        if (cells.length >= 2) {
          const label = cells[0].toLowerCase();
          const value = cells[1];
          if (/weight|重量|ウエイト/i.test(label)) weights = weights.concat(parseWeights(value));
          if (/size|サイズ|全長|length/i.test(label) && length === null) length = parseLength(value);
          if (/price|価格|円/i.test(label) && price === 0) price = parsePrice(value);
        }
      }
    }
  }

  if (weights.length === 0) weights = parseWeights(specText);
  if (length === null) length = parseLength(specText);
  if (price === 0) price = parsePrice(specText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  // IVY LINE shows color charts with names like "E16\nロリポップ" next to color images
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Look for figures with figcaption
  const figMatches = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
  for (const fig of figMatches) {
    const imgMatch = fig.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    const captionMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch && captionMatch) {
      const rawCaption = stripHtml(captionMatch[1]).trim();
      // IVY LINE captions may contain code + name like "E16\nロリポップ"
      const colorName = rawCaption.replace(/^[A-Z]\d+\s*/, '').trim() || rawCaption;
      if (colorName && colorName.length < 50 && !seenColors.has(colorName) &&
          !/spec|スペック|price|価格|feature|特長/i.test(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  // Pattern 2: gallery images with alt text
  if (colors.length === 0) {
    const galleryMatch = html.match(/(?:gallery|color|カラー)[\s\S]*?(?:<\/div>|<\/section>)/i);
    if (galleryMatch) {
      const imgMatches = galleryMatch[0].match(/<img[^>]+>/gi) || [];
      for (const imgTag of imgMatches) {
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
  }

  log(`Colors: ${colors.length}`);

  const type = detectType(name, description, breadcrumb);
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
