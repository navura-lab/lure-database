// scripts/scrapers/xesta.ts
// XESTA product page scraper
// Site: xesta.jp — WordPress (Freestyle/Edge theme), UTF-8, fetch-only
// Product page patterns:
//   https://xesta.jp/{product-slug}/
//   https://xesta.jp/products/metaljig/{slug}/
// Metal jigs for shore jigging, slow jigging, offshore
//
// DOM structure:
//   Product name: <h2> with product name (sometimes markdown-like **/_ formatting)
//   Description: <p> or <strong> blocks
//   Weight/Price: Text-based, format "120g: ¥1,600 (税込¥1,760)" — NOT in <table> elements
//   Color images: <img> in wp-content/uploads, thumbnail-sized in galleries
//   Main image: og:image or first hero image from uploads
//   CSS classes: .edgtf-* (Edge theme framework)

import type { ScraperFunction, ScrapedLure, ScrapedColor } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'XESTA';
const MANUFACTURER_SLUG = 'xesta';
const SITE_BASE = 'https://xesta.jp';
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
  // Handle /products/metaljig/{slug}/ and /{slug}/
  const match = url.match(/\/([^/]+)\/?$/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/スロージグ|SLOW.*JIG|SLOW.*EMOTION|スローエモーション/i, 'スロージグ'],
  [/キャスティング|CASTING|ショアジギ|SHORE/i, 'メタルジグ'],
  [/バイブ|VIBRATION/i, 'バイブレーション'],
  [/ブレード|BLADE/i, 'ブレードジグ'],
  [/タイラバ|TAIRABA/i, 'タイラバ'],
  [/ワーム|WORM/i, 'ワーム'],
];

function detectType(name: string, description: string, urlPath: string): string {
  const combined = name + ' ' + description.substring(0, 200) + ' ' + urlPath;
  if (/slow-jigging|slow-emotion/i.test(urlPath)) return 'スロージグ';
  if (/shore-jigging/i.test(urlPath)) return 'メタルジグ';
  if (/offshore/i.test(urlPath)) return 'メタルジグ';

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

  if (/マダイ|真鯛|タイラバ/.test(combined)) return ['マダイ'];
  if (/タチウオ|太刀魚|tachiuo/i.test(combined)) return ['タチウオ'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ'];
  if (/アジ|アジング/i.test(combined)) return ['アジ'];
  if (/メバル|メバリング/i.test(combined)) return ['メバル'];
  if (/サワラ/i.test(combined)) return ['サワラ'];
  if (/アカムツ|中深海/i.test(combined)) return ['アカムツ'];

  return ['青物', 'シーバス', 'マダイ', 'ヒラメ'];
}

// ---------------------------------------------------------------------------
// Parse weight and price from text-based specs
// XESTA format: "120g: ¥1,600 (税込¥1,760)" or "120g：¥1,600（税込¥1,760）"
// ---------------------------------------------------------------------------

interface WeightPrice {
  weight: number;
  price: number; // tax-included
}

function parseWeightPriceSpecs(text: string): WeightPrice[] {
  const results: WeightPrice[] = [];
  const seenWeights = new Set<number>();

  // Pattern: Ng: ¥X,XXX (税込¥Y,YYY) or Ng：¥X,XXX（税込¥Y,YYY）
  const fullRegex = /([\d.]+)\s*g\s*[:：]\s*[¥￥]\s*([\d,]+)\s*[（(]税込[¥￥]?\s*([\d,]+)[）)]/g;
  let match;
  while ((match = fullRegex.exec(text)) !== null) {
    const weight = parseFloat(match[1]);
    const taxIncPrice = parseInt(match[3].replace(/,/g, ''), 10);
    if (weight > 0 && !seenWeights.has(weight)) {
      seenWeights.add(weight);
      results.push({ weight, price: taxIncPrice });
    }
  }

  // Fallback: Ng ¥XXX without tax breakdown
  if (results.length === 0) {
    const fallbackRegex = /([\d.]+)\s*g\s*[:：]?\s*[¥￥]\s*([\d,]+)/g;
    let fallbackMatch;
    while ((fallbackMatch = fallbackRegex.exec(text)) !== null) {
      const weight = parseFloat(fallbackMatch[1]);
      const price = parseInt(fallbackMatch[2].replace(/,/g, ''), 10);
      if (weight > 0 && !seenWeights.has(weight)) {
        seenWeights.add(weight);
        results.push({ weight, price });
      }
    }
  }

  return results.sort((a, b) => a.weight - b.weight);
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction
// ---------------------------------------------------------------------------

export const scrapeXestaPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`[xesta] Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();

  const urlSlug = extractSlugFromUrl(url);

  // --- Product name ---
  let name = '';
  // Try <h2> elements (XESTA uses h2 for product titles)
  const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  for (const m of h2Matches) {
    let text = stripTags(m[1])
      .replace(/[_*]/g, '') // Strip markdown-like formatting
      .trim();
    // Must contain alphabetical product name and be reasonable length
    if (text.length > 3 && text.length < 100 && /[A-Za-z]/.test(text)) {
      name = text;
      break;
    }
  }
  // Fallback: og:title
  if (!name) {
    const ogTitleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (ogTitleMatch) {
      name = ogTitleMatch[1].replace(/\s*[|–—]\s*XESTA.*$/i, '').trim();
    }
  }
  // Fallback: <title>
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      name = stripTags(titleMatch[1]).split('|')[0].replace(/\s*[–—]\s*XESTA.*$/i, '').trim();
    }
  }
  // Fallback: <h1>
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) name = stripTags(h1Match[1]);
  }
  if (!name) name = urlSlug;

  // --- Slug ---
  const slug = urlSlug;

  // --- Description ---
  const descParts: string[] = [];
  // Look for <strong> and <p> blocks with substantial text
  const contentMatches = [...html.matchAll(/<(?:p|strong)[^>]*>([\s\S]*?)<\/(?:p|strong)>/gi)];
  for (const m of contentMatches) {
    const text = stripTags(m[1]);
    if (text.length > 30
        && !text.includes('ご購入')
        && !text.includes('ONLINE SHOP')
        && !text.includes('cookie')
        && !text.includes('Cookie')
        && !text.includes('©')
        && !/^\d+g\s*[:：]/.test(text) // Skip weight spec lines
        && descParts.length < 3) {
      descParts.push(text);
    }
  }
  const description = descParts.join(' ').substring(0, 500).trim();

  // --- Type and target fish ---
  const type = detectType(name, description, url);
  const targetFish = detectTargetFish(name, description);

  // --- Main image ---
  let mainImage = '';
  const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
  if (ogImageMatch) {
    mainImage = absoluteUrl(ogImageMatch[1]);
  }
  // Fallback: first /wp-content/uploads/ image
  if (!mainImage) {
    const imgMatches = [...html.matchAll(/src="([^"]+\/wp-content\/uploads\/[^"]+)"/gi)];
    for (const m of imgMatches) {
      const src = m[1];
      if (!src.includes('150x150') && !src.includes('logo') && !src.includes('icon')
          && !src.includes('banner')) {
        mainImage = absoluteUrl(src);
        break;
      }
    }
  }
  // Fallback: first /wp/ image
  if (!mainImage) {
    const wpImgMatches = [...html.matchAll(/src="([^"]+\/wp\/wp-content\/uploads\/[^"]+)"/gi)];
    for (const m of wpImgMatches) {
      const src = m[1];
      if (!src.includes('150x150')) {
        mainImage = absoluteUrl(src);
        break;
      }
    }
  }

  // --- Weight and price from text-based specs ---
  const bodyText = stripTags(html);
  const weightPriceSpecs = parseWeightPriceSpecs(bodyText);

  const weights = weightPriceSpecs.map(wp => wp.weight);
  const price = weightPriceSpecs.length > 0 ? weightPriceSpecs[0].price : 0;

  // Fallback: extract weights from text if no structured specs found
  if (weights.length === 0) {
    const seenWeights = new Set<number>();
    const weightMatches = [...bodyText.matchAll(/([\d.]+)\s*g/g)];
    for (const m of weightMatches) {
      const w = parseFloat(m[1]);
      if (w >= 3 && w <= 1000 && !seenWeights.has(w)) {
        seenWeights.add(w);
        weights.push(w);
      }
      if (weights.length >= 15) break;
    }
    weights.sort((a, b) => a - b);
  }

  // --- Length ---
  let length: number | null = null;
  const lenMatch = bodyText.match(/全長\s*([\d.]+)\s*(mm|cm)/);
  if (lenMatch) {
    const val = parseFloat(lenMatch[1]);
    length = lenMatch[2] === 'cm' ? val * 10 : val;
  }

  // --- Color images ---
  // XESTA shows color images as thumbnails in galleries via wp-content/uploads
  const colors: ScrapedColor[] = [];
  const seenColorUrls = new Set<string>();

  // Collect images that appear to be color variants
  // Look for linked thumbnail images (inside <a> tags with full-size image links)
  const linkedImgMatches = [...html.matchAll(/<a[^>]+href="([^"]+\/wp-content\/uploads\/[^"]+\.(jpg|jpeg|png|webp))"[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi)];
  for (const m of linkedImgMatches) {
    const fullUrl = absoluteUrl(m[1]);
    const thumbSrc = m[3];
    const alt = m[4] || '';

    // Skip if it's the main/logo image or too large
    if (thumbSrc.includes('logo') || thumbSrc.includes('icon') || thumbSrc.includes('banner')) continue;

    // Check if thumbnail is small (indicates a gallery/color variant)
    const widthMatch = thumbSrc.match(/-(\d+)x(\d+)\./);
    if (widthMatch) {
      const w = parseInt(widthMatch[1], 10);
      if (w > 400) continue; // Not a thumbnail
    }

    if (seenColorUrls.has(fullUrl)) continue;
    seenColorUrls.add(fullUrl);

    colors.push({
      name: alt.trim() || `カラー${colors.length + 1}`,
      imageUrl: fullUrl,
    });
  }

  // Safety: if too many "colors" found, likely false positives
  if (colors.length > 30) {
    colors.length = 0;
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
