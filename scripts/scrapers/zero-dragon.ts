// scripts/scrapers/zero-dragon.ts
// ZERO DRAGON (zero-dragon.com) product page scraper
// Fetch-only — no Playwright or cheerio needed.
//
// Site: Shop-Pro e-commerce platform (Color Me Shop)
// Product URL pattern: https://zero-dragon.com/?pid={PRODUCT_ID}
// JS object: var Colorme = { product: { name, sales_price, ... } }
// Product images from img02.shop-pro.jp
// Types: メタルジグ, タイラバ
// Target fish: マダイ, 青物

import type { ScraperFunction, ScrapedColor, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'ZERO DRAGON';
const MANUFACTURER_SLUG = 'zero-dragon';
const SITE_BASE = 'https://zero-dragon.com';
const DEFAULT_TARGET_FISH = ['マダイ', '青物'];

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/メタルジグ|metal\s*jig|ジグ|DENJIG|jig/i, 'メタルジグ'],
  [/タイラバ|鯛ラバ|tai\s*raba/i, 'タイラバ'],
  [/インチク|inchiku/i, 'インチク'],
  [/スロージグ|slow\s*jig/i, 'スロージグ'],
  [/ミノー|minnow/i, 'ミノー'],
  [/バイブレーション|vibration/i, 'バイブレーション'],
  [/スプーン|spoon/i, 'スプーン'],
  [/ワーム|worm/i, 'ワーム'],
  [/プラグ|plug/i, 'プラグ'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [zero-dragon] ${msg}`);
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

  if (/マダイ|真鯛|鯛|タイ|tai/i.test(combined)) fish.push('マダイ');
  if (/青物|ブリ|ハマチ|カンパチ|ヒラマサ/i.test(combined)) fish.push('青物');
  if (/根魚|ロック|カサゴ|ハタ/i.test(combined)) fish.push('ロックフィッシュ');
  if (/ヒラメ|マゴチ|フラット/i.test(combined)) fish.push('ヒラメ');
  if (/タチウオ|太刀魚/i.test(combined)) fish.push('タチウオ');
  if (/シーバス|スズキ/i.test(combined)) fish.push('シーバス');
  if (/イカ|squid/i.test(combined)) fish.push('イカ');

  return fish.length > 0 ? fish : DEFAULT_TARGET_FISH;
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export const scrapeZeroDragonPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
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

  // --- Try to extract from Colorme JS object ---
  let colormeName = '';
  let colormePrice = 0;
  let colormePriceInc = 0;

  const colormeMatch = html.match(/var\s+Colorme\s*=\s*(\{[\s\S]*?\});/);
  if (colormeMatch) {
    try {
      // Extract name
      const nameMatch = colormeMatch[1].match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) colormeName = nameMatch[1];

      // Extract prices
      const priceMatch = colormeMatch[1].match(/"sales_price"\s*:\s*(\d+)/);
      if (priceMatch) colormePrice = parseInt(priceMatch[1], 10);

      const priceIncMatch = colormeMatch[1].match(/"sales_price_including_tax"\s*:\s*(\d+)/);
      if (priceIncMatch) colormePriceInc = parseInt(priceIncMatch[1], 10);
    } catch { /* ignore parse errors */ }
  }

  // --- Product name ---
  let name = colormeName || '';
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
    if (titleMatch) name = stripHtml(titleMatch[1]).replace(/\s*[|｜–—].*$/, '').replace(/\s*ZERODRAGON.*$/i, '').replace(/\s*ZERO DRAGON.*$/i, '').trim();
  }
  if (!name) {
    const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogMatch) name = stripHtml(ogMatch[1]).replace(/\s*[|｜–—].*$/, '').trim();
  }
  if (!name) name = 'Unknown';
  log(`Product name: ${name}`);

  // --- Slug from URL or product name ---
  let slug = '';
  // Try to extract pid from URL: ?pid=166544727
  const pidMatch = url.match(/[?&]pid=(\d+)/);
  if (pidMatch) {
    // Create slug from product name + pid for uniqueness
    const nameSlug = slugify(name);
    slug = nameSlug || `zero-dragon-${pidMatch[1]}`;
  }
  if (!slug) {
    try {
      const urlObj = new URL(url);
      const segments = urlObj.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';
      slug = lastSegment.replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    } catch { /* ignore */ }
  }
  if (!slug) slug = slugify(name);
  log(`Slug: ${slug}`);

  // --- Main image ---
  let mainImage = '';
  // Shop-Pro images: img02.shop-pro.jp/PAxxxxx/xxx/product/{pid}.jpg
  const shopProImg = html.match(/<img[^>]+src=["'](https?:\/\/img\d+\.shop-pro\.jp\/[^"']+)["']/i);
  if (shopProImg) mainImage = shopProImg[1];
  if (!mainImage) {
    const ogImageMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
    if (ogImageMatch) mainImage = ogImageMatch[1];
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
    // Shop-Pro description area
    const descAreaMatch = html.match(/<div[^>]*class=["'][^"']*(?:product_description|product-detail|item_description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (descAreaMatch) {
      description = stripHtml(descAreaMatch[1]).substring(0, 500);
    }
  }
  if (!description) {
    const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    for (const p of pMatches) {
      const text = stripHtml(p).trim();
      if (text.length > 30 && !/spec|スペック|カラー|copyright|menu|nav/i.test(text.substring(0, 30))) {
        description = text.substring(0, 500);
        break;
      }
    }
  }
  log(`Description: ${description.substring(0, 80)}...`);

  // --- Price from Colorme or body text ---
  let price = colormePriceInc || colormePrice || 0;
  if (price === 0) price = parsePrice(stripHtml(html));

  // --- Weights from product name and body ---
  // ZERO DRAGON product names often include weight: "DENJIG MIMIC 280g"
  const bodyText = stripHtml(html);
  let weights = parseWeights(name);
  if (weights.length === 0) weights = parseWeights(bodyText);

  // --- Length ---
  let length = parseLength(bodyText);

  weights = Array.from(new Set(weights)).sort((a, b) => a - b);
  log(`Weights: [${weights.join(', ')}], Length: ${length}mm, Price: ${price}`);

  // --- Colors ---
  // ZERO DRAGON embeds color name in product title: "DENJIG MIMIC 280g センターピンクライン（CPL）"
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Try to extract color from product name parenthetical
  const colorInName = name.match(/[（(]([^）)]+)[）)]\s*$/);
  if (colorInName) {
    const colorName = colorInName[1].trim();
    if (colorName && !seenColors.has(colorName)) {
      seenColors.add(colorName);
      colors.push({ name: colorName, imageUrl: mainImage });
    }
  }

  // Also try the text after weight: "280g センターピンクライン" -> "センターピンクライン"
  if (colors.length === 0) {
    const afterWeightMatch = name.match(/\d+\s*g\s+(.+?)(?:\s*[（(]|$)/);
    if (afterWeightMatch) {
      const colorName = afterWeightMatch[1].trim();
      if (colorName && colorName.length > 1 && !seenColors.has(colorName)) {
        seenColors.add(colorName);
        colors.push({ name: colorName, imageUrl: mainImage });
      }
    }
  }

  // Pattern: figure + figcaption
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

  // Pattern: gallery/color items
  if (colors.length === 0) {
    const colorImgMatches = html.match(/<img[^>]+alt=["']([^"']+)["'][^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
    for (const imgTag of colorImgMatches) {
      const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
      const srcMatch = imgTag.match(/src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
      if (altMatch && srcMatch) {
        const colorName = altMatch[1].trim();
        if (colorName && colorName.length > 1 && colorName.length < 60
            && !seenColors.has(colorName) && !/logo|banner|icon|arrow|cart|button/i.test(colorName)) {
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
