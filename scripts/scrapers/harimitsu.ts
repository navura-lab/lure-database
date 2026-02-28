// scripts/scrapers/harimitsu.ts
// Harimitsu product page scraper
// Site: harimitsu.co.jp — WordPress + USC e-Shop plugin, UTF-8, fetch-only
// Product page pattern: https://harimitsu.co.jp/{numeric-id}
// Primarily squid lures (sutte/egi)
//
// DOM structure:
//   Product name: <h3> in main content area
//   Description: <p> elements with product info
//   Spec table: <table> with size/JAN/price columns (e.g., 2.5号 | JAN | ¥450 (税込¥495))
//   Images: <img> gallery with wp-content/uploads paths, thumbnails as -150x150
//   Breadcrumb: Home > 商品 > Category > SubCategory > Product
//   Price format: ¥XXX (税込¥YYY) or ¥XXX（税込¥YYY）

import type { ScraperFunction, ScrapedLure, ScrapedColor } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'ハリミツ';
const MANUFACTURER_SLUG = 'harimitsu';
const SITE_BASE = 'https://harimitsu.co.jp';
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

function extractSlugFromUrl(url: string): string {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Type detection from product name / breadcrumb category
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/エギ|EGI/i, 'エギ'],
  [/スッテ|SUTTE|墨族/i, 'スッテ'],
  [/タコ|OCTOPUS|蛸/i, 'タコベイト'],
  [/メタルジグ|ジグ|JIG/i, 'メタルジグ'],
  [/ワーム|WORM/i, 'ワーム'],
  [/仕掛/i, '仕掛け'],
];

function detectType(name: string, breadcrumb: string): string {
  const combined = name + ' ' + breadcrumb;
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(combined)) return type;
  }
  return 'スッテ';
}

// ---------------------------------------------------------------------------
// Target fish detection
// ---------------------------------------------------------------------------

function detectTargetFish(name: string, breadcrumb: string): string[] {
  const combined = (name + ' ' + breadcrumb).toLowerCase();

  if (/アオリイカ|aoriika|エギング/.test(combined)) return ['アオリイカ'];
  if (/タコ|octopus|蛸/.test(combined)) return ['タコ'];
  if (/イカ|スッテ|sutte|墨族/.test(combined)) return ['イカ'];
  if (/マダイ|真鯛|madai/.test(combined)) return ['マダイ'];
  if (/ヒラメ|hirame/.test(combined)) return ['ヒラメ'];
  if (/イシダイ/.test(combined)) return ['イシダイ'];
  if (/青物|ブリ|カンパチ/.test(combined)) return ['青物'];

  return ['イカ'];
}

// ---------------------------------------------------------------------------
// Parse tax-included price from text
// ---------------------------------------------------------------------------

function parseTaxIncludedPrice(text: string): number {
  const taxIncMatch = text.match(/税込[¥￥]?\s*([\d,]+)/);
  if (taxIncMatch) {
    return parseInt(taxIncMatch[1].replace(/,/g, ''), 10) || 0;
  }
  const plainMatch = text.match(/[¥￥]\s*([\d,]+)/);
  if (plainMatch) {
    return parseInt(plainMatch[1].replace(/,/g, ''), 10) || 0;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction
// ---------------------------------------------------------------------------

export const scrapeHarimitsuPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`[harimitsu] Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();

  const slug = extractSlugFromUrl(url);

  // --- Product name from <h3> ---
  let name = '';
  const h3Match = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3Match) {
    name = stripTags(h3Match[1]);
  }
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      name = stripTags(titleMatch[1]).split('|')[0].trim();
    }
  }
  if (!name) name = 'Unknown';

  // --- Breadcrumb for type/target detection ---
  const breadcrumbParts: string[] = [];
  const breadcrumbMatches = [...html.matchAll(/<a[^>]*href="[^"]*(?:\/category\/|\/item\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const m of breadcrumbMatches) {
    breadcrumbParts.push(stripTags(m[1]));
  }
  const breadcrumb = breadcrumbParts.join(' ');

  // --- Type and target fish ---
  const type = detectType(name, breadcrumb);
  const targetFish = detectTargetFish(name, breadcrumb);

  // --- Description ---
  const descParts: string[] = [];
  const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = stripTags(m[1]);
    if (text.length > 15
        && !text.includes('在庫')
        && !text.includes('数量')
        && !text.includes('ケース入数')
        && !text.includes('パッケージサイズ')
        && !text.includes('JAN')
        && descParts.length < 3) {
      descParts.push(text);
    }
  }
  const description = descParts.join(' ').substring(0, 500).trim();

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
  if (ogImageMatch) {
    mainImage = absoluteUrl(ogImageMatch[1]);
  }
  if (!mainImage) {
    const imgMatches = [...html.matchAll(/<img[^>]+src="([^"]+\/wp-content\/uploads\/[^"]+)"/gi)];
    for (const m of imgMatches) {
      const src = m[1];
      if (!src.includes('150x150') && !src.includes('logo') && !src.includes('icon')) {
        mainImage = absoluteUrl(src);
        break;
      }
    }
  }

  // --- Spec table: extract prices, weights ---
  const weights: number[] = [];
  const seenWeights = new Set<number>();
  let price = 0;

  const tableMatches = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  for (const tm of tableMatches) {
    const tableHtml = tm[1];
    const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rm of rowMatches) {
      const rowText = stripTags(rm[1]);

      if ((rowText.includes('¥') || rowText.includes('￥')) && price === 0) {
        price = parseTaxIncludedPrice(rowText);
      }

      const wtMatch = rowText.match(/([\d.]+)\s*g/);
      if (wtMatch) {
        const w = parseFloat(wtMatch[1]);
        if (w > 0 && !seenWeights.has(w)) {
          seenWeights.add(w);
          weights.push(w);
        }
      }
    }
  }

  // --- Length from page text ---
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

  const allImgMatches = [...html.matchAll(/<img[^>]+src="([^"]+\/wp-content\/uploads\/[^"]+)"[^>]*alt="([^"]*)"/gi)];
  for (const m of allImgMatches) {
    const src = m[1];
    const alt = m[2] || '';
    if (src.includes('150x150') || src.includes('logo') || src.includes('icon') || src.includes('banner')) continue;
    const imgUrl = absoluteUrl(src);
    if (seenColorUrls.has(imgUrl)) continue;
    seenColorUrls.add(imgUrl);
    colors.push({
      name: alt.trim() || `カラー${colors.length + 1}`,
      imageUrl: imgUrl,
    });
  }

  if (colors.length === 0) {
    const imgMatchesNoAlt = [...html.matchAll(/<img[^>]+src="([^"]+\/wp-content\/uploads\/[^"]+)"/gi)];
    for (const m of imgMatchesNoAlt) {
      const src = m[1];
      if (src.includes('150x150') || src.includes('logo') || src.includes('icon') || src.includes('banner')) continue;
      const imgUrl = absoluteUrl(src);
      if (seenColorUrls.has(imgUrl)) continue;
      seenColorUrls.add(imgUrl);
      colors.push({
        name: `カラー${colors.length + 1}`,
        imageUrl: imgUrl,
      });
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
