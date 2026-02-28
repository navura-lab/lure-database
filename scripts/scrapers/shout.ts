// scripts/scrapers/shout.ts
// SHOUT! (shout-net.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: Static HTML (not WordPress)
// Product URL pattern: https://shout-net.com/{category}/{product}.html
// Types: メタルジグ, アシストフック
// Target fish: 青物 (ブリ, ヒラマサ, カンパチ, マグロ)

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'SHOUT!';
const MANUFACTURER_SLUG = 'shout';
const SITE_BASE = 'https://shout-net.com';
const DEFAULT_TARGET_FISH = ['ブリ', 'ヒラマサ', 'カンパチ', 'マグロ'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/ジグ|jig/i, 'メタルジグ'],
  [/ダイビングペンシル|diving\s*pencil/i, 'ダイビングペンシル'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/ペンシル|pencil/i, 'ペンシルベイト'],
  [/ミノー|minnow/i, 'ミノー'],
  [/プラグ|plug/i, 'プラグ'],
  [/タイラバ|鯛ラバ/i, 'タイラバ'],
  [/インチク/i, 'インチク'],
  [/スプーン|spoon/i, 'スプーン'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [shout] ${msg}`);
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
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
  const mmMatch = text.match(/([\d.]+)\s*mm/i);
  if (mmMatch) {
    const len = parseFloat(mmMatch[1]);
    if (len > 0 && len < 5000) return Math.round(len);
  }
  const cmMatch = text.match(/([\d.]+)\s*cm/i);
  if (cmMatch) {
    const mm = Math.round(parseFloat(cmMatch[1]) * 10);
    if (mm > 0 && mm < 5000) return mm;
  }
  return null;
}

function deriveTargetFish(name: string, description: string): string[] {
  const combined = `${name} ${description}`;
  const fish: string[] = [];

  if (/マグロ|ツナ|tuna/i.test(combined)) fish.push('マグロ');
  if (/ヒラマサ/i.test(combined)) fish.push('ヒラマサ');
  if (/カンパチ/i.test(combined)) fish.push('カンパチ');
  if (/ブリ|ハマチ|青物/i.test(combined)) fish.push('ブリ');
  if (/GT|ロウニンアジ/i.test(combined)) fish.push('GT');
  if (/タチウオ/i.test(combined)) fish.push('タチウオ');
  if (/マダイ|真鯛/i.test(combined)) fish.push('マダイ');
  if (/根魚|ロック|ハタ/i.test(combined)) fish.push('ロックフィッシュ');

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

export const scrapeShoutPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
  // Static HTML site: try h1, then h2, then title
  let name = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) name = stripHtml(h1Match[1]).trim();
  if (!name) {
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) name = stripHtml(h2Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜–—].*$/, '').replace(/\s*-\s*SHOUT.*$/i, '').trim();
  }
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*[|｜–—].*$/, '').trim();
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
  // Static sites: first large product image
  if (!mainImage) {
    const productImgMatch = html.match(/<img[^>]+src=["']([^"']*(?:product|item|jig|lure)[^"']*)["']/i);
    if (productImgMatch) mainImage = productImgMatch[1];
  }
  if (!mainImage) {
    // First content image that's not a logo or icon
    const imgMatches = html.match(/<img[^>]+src=["']([^"']+\.(jpg|jpeg|png|webp))["']/gi) || [];
    for (const imgTag of imgMatches) {
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      if (srcMatch && !/logo|icon|banner|header|footer|nav|sns|twitter|facebook/i.test(srcMatch[1])) {
        mainImage = srcMatch[1];
        break;
      }
    }
  }
  mainImage = makeAbsolute(mainImage);
  log(`Main image: ${mainImage}`);

  // --- Description ---
  let description = '';
  // Static HTML: look for content divs or substantial paragraphs
  const contentDivMatch = html.match(/<div[^>]*(?:class=["'][^"']*(?:content|main|product|detail|description)[^"']*["']|id=["'][^"']*(?:content|main|product|detail)[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i);
  if (contentDivMatch) {
    const pMatches = contentDivMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 30 && !/spec|スペック|カラー|color|価格|price|重量/i.test(text.substring(0, 30))) {
        description = text.replace(/\s+/g, ' ').substring(0, 500);
        break;
      }
    }
  }
  if (!description) {
    // Try all paragraphs
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 50 && !/spec|スペック|copyright|©/i.test(text.substring(0, 30))) {
        description = text.replace(/\s+/g, ' ').substring(0, 500);
        break;
      }
    }
  }
  if (!description) {
    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    if (metaDescMatch && metaDescMatch[1].length > 20) {
      description = stripHtml(metaDescMatch[1]).substring(0, 500);
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Spec table ---
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

      // Key-value rows
      for (const cells of rows) {
        if (cells.length >= 2) {
          const label = cells[0];
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

        if (weightIdx >= 0 || priceIdx >= 0) {
          for (let r = 1; r < rows.length; r++) {
            if (weightIdx >= 0 && rows[r][weightIdx]) {
              weights = weights.concat(parseWeights(rows[r][weightIdx]));
            }
            if (lengthIdx >= 0 && length === null && rows[r][lengthIdx]) {
              length = parseLength(rows[r][lengthIdx]);
            }
            if (priceIdx >= 0 && price === 0 && rows[r][priceIdx]) {
              price = parsePrice(rows[r][priceIdx]);
            }
          }
        }
      }
    }
  }

  // Static HTML sites may have specs in definition lists
  if (weights.length === 0 || price === 0) {
    const dlMatches = html.match(/<dl[\s\S]*?<\/dl>/gi) || [];
    for (const dl of dlMatches) {
      const dtDdPairs = Array.from(dl.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi));
      for (const [, dtHtml, ddHtml] of dtDdPairs) {
        const label = stripHtml(dtHtml);
        const value = stripHtml(ddHtml);
        if (/重量|ウエイト|weight/i.test(label) && weights.length === 0) {
          weights = weights.concat(parseWeights(value));
        }
        if (/全長|length|サイズ/i.test(label) && length === null) {
          length = parseLength(value);
        }
        if (/価格|price|円/i.test(label) && price === 0) {
          price = parsePrice(value);
        }
      }
    }
  }

  // Also check inline text patterns like "●100g ￥1,200(税抜)"
  if (weights.length === 0) {
    const bulletSpecs = Array.from(html.matchAll(/[●・]\s*([\d.]+)\s*g\s*[^\d]*?[¥￥]([\d,]+)/gi));
    for (const m of bulletSpecs) {
      const w = parseFloat(m[1]);
      if (w > 0 && w < 10000) weights.push(Math.round(w * 10) / 10);
      if (price === 0) {
        price = parseInt(m[2].replace(/,/g, ''), 10);
      }
    }
  }

  if (weights.length === 0) weights = parseWeights(specText || stripHtml(html));
  if (length === null) length = parseLength(specText || stripHtml(html));
  if (price === 0) price = parsePrice(specText || stripHtml(html));

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Pattern 1: figures with figcaption
  const figMatches = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
  for (const fig of figMatches) {
    const imgMatch = fig.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    const captionMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch && captionMatch) {
      const colorName = stripHtml(captionMatch[1]).trim();
      if (colorName && colorName.length < 50 && !seenColors.has(colorName) &&
          !/spec|スペック|price|価格|重量|weight/i.test(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  // Pattern 2: images with alt text containing color names
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

  // Pattern 3: numbered color images (static site pattern)
  if (colors.length === 0) {
    const numberedImgMatches = html.match(/<img[^>]+src=["'][^"']*(?:col|color)[-_]?\d+[^"']*["'][^>]*>/gi) || [];
    for (let i = 0; i < numberedImgMatches.length; i++) {
      const srcMatch = numberedImgMatches[i].match(/src=["']([^"']+)["']/i);
      const altMatch = numberedImgMatches[i].match(/alt=["']([^"']*?)["']/i);
      if (srcMatch) {
        const colorName = altMatch && altMatch[1] ? altMatch[1].trim() : `カラー${i + 1}`;
        if (!seenColors.has(colorName)) {
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
