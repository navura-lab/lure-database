// scripts/scrapers/hayabusa.ts
// Hayabusa product page scraper
// Site: www.hayabusa.co.jp/hayabusa/ — WordPress (hayabusa2019 theme), UTF-8, fetch-only
// Product page pattern: https://www.hayabusa.co.jp/hayabusa/products/{PRODUCT_CODE}/
// WP REST API available but specs only in HTML
//
// DOM structure:
//   Product name: <h1> in main content
//   Description: #productsItemDescription section
//   Spec table: #productsItemColorSpec <table> with columns: 重さ | № | カラー | 価格(税込) | JAN
//   Color images: {CODE}_N.png in gallery carousel
//   Main image: /web_img/him_img/{CODE}.png
//   Price: ¥XXX format (already tax-included in spec table)

import type { ScraperFunction, ScrapedLure, ScrapedColor } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'ハヤブサ';
const MANUFACTURER_SLUG = 'hayabusa';
const SITE_BASE = 'https://www.hayabusa.co.jp';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(src: string): string {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${SITE_BASE}${src}`;
  return `${SITE_BASE}/${src}`;
}

function extractProductCode(url: string): string {
  const match = url.match(/\/products\/([^/]+)\/?$/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/エギ|EGI|スクイッド|SQUID/i, 'エギ'],
  [/メタルジグ|ジグ|JIG|マキマキ|ジャックアイ/i, 'メタルジグ'],
  [/タイラバ|鯛ラバ|TAIRABA|無双/i, 'タイラバ'],
  [/バイブ|VIBRATION/i, 'バイブレーション'],
  [/ミノー|MINNOW/i, 'ミノー'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/スピン|ブレード|BLADE/i, 'ブレードジグ'],
  [/ワーム|WORM/i, 'ワーム'],
  [/仕掛|サビキ/i, '仕掛け'],
];

function detectType(name: string, description: string): string {
  const combined = name + ' ' + description.substring(0, 200);
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }
  return 'メタルジグ';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, description: string): string[] {
  const combined = (name + ' ' + description).toLowerCase();

  if (/イカ|エギ|スクイッド|squid/.test(combined)) return ['イカ'];
  if (/マダイ|真鯛|タイラバ|鯛/.test(combined)) return ['マダイ'];
  if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ'];
  if (/アジ|アジング/.test(combined)) return ['アジ'];
  if (/メバル|メバリング/.test(combined)) return ['メバル'];
  if (/青物|ブリ|カンパチ|ヒラマサ|ショアジギ/.test(combined)) return ['青物'];

  return ['青物', 'シーバス'];
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction
// ---------------------------------------------------------------------------

export const scrapeHayabusaPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`[hayabusa] Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();

  const productCode = extractProductCode(url);

  // --- Product name from <h1> ---
  let name = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    name = stripTags(h1Match[1]);
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      name = stripTags(titleMatch[1]).split('|')[0].trim();
    }
  }
  if (!name) name = productCode;

  const slug = productCode.toLowerCase();

  // --- Description ---
  const descParts: string[] = [];
  const descSectionMatch = html.match(/id="productsItemDescription"[^>]*>([\s\S]*?)(?=<section|<div[^>]*id="productsItem)/i);
  if (descSectionMatch) {
    const pMatches = [...descSectionMatch[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    for (const m of pMatches) {
      const text = stripTags(m[1]);
      if (text.length > 15) {
        descParts.push(text);
      }
    }
  }
  if (descParts.length === 0) {
    const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    for (const m of pMatches) {
      const text = stripTags(m[1]);
      if (text.length > 30 && !text.includes('JAN') && !text.includes('メーカー希望')
          && descParts.length < 3) {
        descParts.push(text);
      }
    }
  }
  const description = descParts.join(' ').substring(0, 500).trim();

  const type = detectType(name, description);
  const targetFish = detectTargetFish(name, description);

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
  if (ogImageMatch) {
    mainImage = absoluteUrl(ogImageMatch[1]);
  }
  if (!mainImage) {
    const codeImgMatch = html.match(new RegExp(`src="([^"]+${productCode}[^"]*\\.(png|jpg|jpeg|webp))"`, 'i'));
    if (codeImgMatch) {
      mainImage = absoluteUrl(codeImgMatch[1]);
    }
  }
  if (!mainImage) {
    mainImage = `${SITE_BASE}/hayabusa/wp/wp-content/themes/hayabusa2019/web_img/him_img/${productCode}.png`;
  }

  // --- Spec table parsing ---
  const weights: number[] = [];
  const seenWeights = new Set<number>();
  let price = 0;
  const colorNamesFromTable: string[] = [];
  const seenColorNames = new Set<string>();

  const tableMatches = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const tm of tableMatches) {
    const tableHtml = tm[1];
    const tableText = stripTags(tableHtml);
    if (!tableText.includes('重さ') && !tableText.includes('カラー')) continue;

    // Parse header
    const headerMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)
      || tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
    if (!headerMatch) continue;

    const headerCells = [...headerMatch[1].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map(c => stripTags(c[1]));

    const weightIdx = headerCells.findIndex(h => /重さ|ウエイト|重量/.test(h));
    const colorIdx = headerCells.findIndex(h => /カラー/.test(h));
    const priceIdx = headerCells.findIndex(h => /価格|税込/.test(h));

    // Parse data rows
    const bodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const rowsHtml = bodyMatch ? bodyMatch[1] : tableHtml;
    const rowMatches = [...rowsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (let i = 0; i < rowMatches.length; i++) {
      const rowHtml = rowMatches[i][1];
      if (/<th/.test(rowHtml) && !/<td/.test(rowHtml)) continue;

      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(c => stripTags(c[1]));
      if (cells.length < 2) continue;

      if (weightIdx >= 0 && weightIdx < cells.length) {
        const wtMatch = cells[weightIdx].match(/([\d.]+)\s*g/);
        if (wtMatch) {
          const w = parseFloat(wtMatch[1]);
          if (w > 0 && !seenWeights.has(w)) {
            seenWeights.add(w);
            weights.push(w);
          }
        }
      }

      if (colorIdx >= 0 && colorIdx < cells.length) {
        const colorText = cells[colorIdx].trim();
        if (colorText && !seenColorNames.has(colorText)) {
          seenColorNames.add(colorText);
          colorNamesFromTable.push(colorText);
        }
      }

      if (priceIdx >= 0 && priceIdx < cells.length && price === 0) {
        const priceText = cells[priceIdx].replace(/[,，\s]/g, '');
        const priceMatch = priceText.match(/[¥￥]?([\d]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1], 10) || 0;
        }
      }
    }

    if (weights.length > 0 || colorNamesFromTable.length > 0) break;
  }

  // Fallback weight extraction
  if (weights.length === 0) {
    const bodyText = stripTags(html);
    const wtMatches = [...bodyText.matchAll(/([\d.]+)\s*g/g)];
    for (const m of wtMatches) {
      const w = parseFloat(m[1]);
      if (w >= 1 && w <= 500 && !seenWeights.has(w)) {
        seenWeights.add(w);
        weights.push(w);
      }
      if (weights.length >= 10) break;
    }
  }

  // --- Length ---
  let length: number | null = null;
  const bodyText = stripTags(html);
  const lenMatch = bodyText.match(/全長\s*([\d.]+)\s*(mm|cm)/);
  if (lenMatch) {
    const val = parseFloat(lenMatch[1]);
    length = lenMatch[2] === 'cm' ? val * 10 : val;
  }

  // --- Color images ---
  const colors: ScrapedColor[] = [];
  const seenColorUrls = new Set<string>();
  const codePattern = new RegExp(`${productCode}[_-](\\d+)\\.(png|jpg|jpeg|webp)`, 'i');

  const imgMatches = [...html.matchAll(/src="([^"]+)"/gi)];
  for (const m of imgMatches) {
    const src = m[1];
    if (codePattern.test(src) && !seenColorUrls.has(src)) {
      seenColorUrls.add(src);
      const imgUrl = absoluteUrl(src);
      const numMatch = src.match(new RegExp(`${productCode}[_-](\\d+)`, 'i'));
      const num = numMatch ? parseInt(numMatch[1], 10) : colors.length + 1;
      const colorName = colorNamesFromTable[num - 1] || `カラー${num}`;
      colors.push({ name: colorName, imageUrl: imgUrl });
    }
  }

  if (colors.length === 0 && colorNamesFromTable.length > 0) {
    for (const cn of colorNamesFromTable) {
      colors.push({ name: cn, imageUrl: '' });
    }
  }

  return {
    name,
    name_kana: '',
    slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type,
    target_fish: targetFish,
    description,
    price,
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };
};
