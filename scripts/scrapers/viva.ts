// scripts/scrapers/viva.ts
// VIVA (vivanet.co.jp/viva/) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: WordPress (Cormoran Products)
// Product URL pattern: https://vivanet.co.jp/viva/{product-slug}/
// Specs as inline text: "58mm / 12g / ¥1,700（税別）"
// Color chart: <li><a><img><div>#code<br>name</div></a></li>
// Types: various (クローラー, ポッパー, バイブ, ワーム, etc.)
// Target fish: ブラックバス, ナマズ, トラウト

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'VIVA';
const MANUFACTURER_SLUG = 'viva';
const SITE_BASE = 'https://vivanet.co.jp';
const DEFAULT_TARGET_FISH = ['ブラックバス'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/クローラー|crawler/i, 'クローラーベイト'],
  [/ポッパー|popper/i, 'ポッパー'],
  [/バイブレーション|vibration|バイブ|vib/i, 'バイブレーション'],
  [/メタルバイブ|metal\s*vib/i, 'メタルバイブ'],
  [/ミノー|minnow/i, 'ミノー'],
  [/シャッド|shad/i, 'シャッド'],
  [/クランク|crank/i, 'クランクベイト'],
  [/スピナーベイト|spinner\s*bait|スピン/i, 'スピナーベイト'],
  [/バズベイト|buzz/i, 'バズベイト'],
  [/ビッグベイト|big\s*bait/i, 'ビッグベイト'],
  [/ワーム|worm|ネイル|サターン/i, 'ワーム'],
  [/スプーン|spoon/i, 'スプーン'],
  [/メタルジグ|metal\s*jig/i, 'メタルジグ'],
  [/トップウォーター|topwater|マウス|mouse/i, 'トップウォーター'],
  [/プラグ|plug/i, 'プラグ'],
  [/ブレード|blade/i, 'ブレードベイト'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [viva] ${msg}`);
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
  return 'ルアー';
}

/**
 * Parse price from VIVA format: "￥1,700（税別）" or "￥1,870（税込）"
 */
function parsePrice(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, '');

  // Tax-included price
  const taxInclMatch = cleaned.match(/[¥￥]([\d,]+)[（(]税込/);
  if (taxInclMatch) return parseInt(taxInclMatch[1].replace(/,/g, ''), 10);

  // Tax-excluded price — convert to tax-included
  const taxExclMatch = cleaned.match(/[¥￥]([\d,]+)[（(]税別/);
  if (taxExclMatch) return Math.round(parseInt(taxExclMatch[1].replace(/,/g, ''), 10) * 1.1);

  // Plain yen
  const yenMatch = cleaned.match(/[¥￥]([\d,]+)/);
  if (yenMatch) return parseInt(yenMatch[1].replace(/,/g, ''), 10);

  const enMatch = cleaned.match(/([\d,]+)円/);
  if (enMatch) return parseInt(enMatch[1].replace(/,/g, ''), 10);

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

  if (/ブラックバス|バス|bass/i.test(combined)) fish.push('ブラックバス');
  if (/ナマズ|鯰|catfish|ナマズSP/i.test(combined)) fish.push('ナマズ');
  if (/トラウト|trout|マス/i.test(combined)) fish.push('トラウト');
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/メバル|アジ|ライトゲーム/i.test(combined)) fish.push('メバル');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export const scrapeVivaPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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
  // VIVA uses h3 for product name or image alt for logo
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) name = stripHtml(h1Match[1]).trim();
  if (!name) {
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) name = stripHtml(h2Match[1]).trim();
  }
  if (!name) {
    const h3Match = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3Match) name = stripHtml(h3Match[1]).trim();
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜–—].*$/, '').replace(/\s*Viva.*$/i, '').trim();
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
    // URL: /viva/{slug}/ — skip 'viva' prefix
    const lastSegment = segments[segments.length - 1] || '';
    slug = lastSegment.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  } catch { /* ignore */ }
  if (!slug) slug = slugify(name);
  log(`Slug: ${slug}`);

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
    || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
  if (ogImageMatch) mainImage = ogImageMatch[1];
  if (!mainImage) {
    // Look for product images (not logo, not color chart)
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+(?:product|main|hero|wp-content\/uploads)[^"']*)["'][^>]*(?:class=["'][^"']*(?:product|main|featured)[^"']*["'])?/i);
    if (imgMatch) mainImage = imgMatch[1];
  }
  if (!mainImage) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
    if (imgMatch) mainImage = imgMatch[1];
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
      if (text.length > 30 && !/spec|スペック|カラー|copyright|TOPページ/i.test(text.substring(0, 30))) {
        description = text.substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Specs: VIVA uses inline format "58mm / 12g / ¥1,700（税別）" ---
  const bodyText = stripHtml(html);
  let price = 0;
  let weights: number[] = [];
  let length: number | null = null;

  // Try the slash-separated spec format first
  const inlineSpecMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*mm\s*[/／]\s*([\d.]+)\s*g\s*[/／]\s*[¥￥]([\d,]+)/);
  if (inlineSpecMatch) {
    length = Math.round(parseFloat(inlineSpecMatch[1]));
    weights = [parseFloat(inlineSpecMatch[2])];
    price = parsePrice(`¥${inlineSpecMatch[3]}`);
  }

  // Also try reversed format: "12g / 58mm / ¥1,700"
  if (weights.length === 0) {
    const reversedSpec = bodyText.match(/([\d.]+)\s*g\s*[/／]\s*(\d+(?:\.\d+)?)\s*mm\s*[/／]\s*[¥￥]([\d,]+)/);
    if (reversedSpec) {
      weights = [parseFloat(reversedSpec[1])];
      length = Math.round(parseFloat(reversedSpec[2]));
      price = parsePrice(`¥${reversedSpec[3]}`);
    }
  }

  // Fallback: general parsing
  if (weights.length === 0) weights = parseWeights(bodyText);
  if (length === null) length = parseLength(bodyText);
  if (price === 0) price = parsePrice(bodyText);

  // Parse tables if any
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

  // --- Colors: VIVA uses <li><a><img><div>#code<br>name</div></a></li> ---
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Pattern 1: <li> with img and div containing color code + name
  const liMatches = html.match(/<li[^>]*>\s*<a[^>]*>[\s\S]*?<\/a>\s*<\/li>/gi) || [];
  for (const li of liMatches) {
    const imgMatch = li.match(/<img[^>]+src=["']([^"']+)["']/i);
    // Color name in <div> with format: "#11E<br>キンクロ" or "#83<br>チャートバス"
    const divMatch = li.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
    if (imgMatch && divMatch) {
      const rawText = divMatch[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
      // Extract color name: "#11E キンクロ" -> "キンクロ" or keep full string
      const colorName = rawText.replace(/^\s*#?\d+[A-Z]?\s*/i, '').trim() || rawText.trim();
      if (colorName && colorName.length > 0 && !seenColors.has(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: rawText.trim(), imageUrl: makeAbsolute(imgMatch[1]) });
      }
    }
  }

  // Pattern 2: figure + figcaption
  if (colors.length === 0) {
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
  }

  // Pattern 3: images with color/col in src with alt text
  if (colors.length === 0) {
    const colorImgMatches = html.match(/<img[^>]+(?:src=["'][^"']*(?:color|col_|カラー)[^"']*["']|alt=["'][^"']+["'])[^>]*>/gi) || [];
    for (const imgTag of colorImgMatches) {
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
      if (srcMatch && altMatch) {
        const colorName = altMatch[1].trim();
        if (colorName && !seenColors.has(colorName) && !/logo|banner|icon/i.test(colorName)) {
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
