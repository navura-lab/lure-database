// scripts/scrapers/seafloor-control.ts
// Seafloor Control product page scraper
// Site: seafloor-control.com — WordPress (sfc2022 theme), UTF-8, fetch-only
// Product page pattern: https://seafloor-control.com/ja/items/{slug}/
// Primarily metal jigs for deep-sea/slow-pitch jigging
//
// DOM structure:
//   Product name: <title> "name | シーフロアコントロール公式サイト"
//   Description: <p> text blocks in content
//   Weight: Image-based (title_weight.png) + sometimes text in body
//   Color swatches: <img src="colorN.png" alt="01.シルバー"> inside <a href="colorpopN.png">
//   Main image: /wp-content/uploads/ or og:image
//   Price: NOT on website (external shop only)
//   Breadcrumb: Schema.org BreadcrumbList

import type { ScraperFunction, ScrapedLure, ScrapedColor } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'SEAFLOOR CONTROL';
const MANUFACTURER_SLUG = 'seafloor-control';
const SITE_BASE = 'https://seafloor-control.com';
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
  const match = url.match(/\/items\/([^/]+)\/?$/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/タイラバ|鯛ラバ|TAIRABA/i, 'タイラバ'],
  [/インチク|INCHIKU/i, 'インチク'],
  [/テンヤ|TENYA/i, 'テンヤ'],
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

  if (/マダイ|真鯛|タイラバ/.test(combined)) return ['マダイ'];
  if (/アカムツ|赤むつ|中深海/.test(combined)) return ['アカムツ'];
  if (/ヒラメ|フラット/.test(combined)) return ['ヒラメ'];
  if (/タチウオ|太刀魚/.test(combined)) return ['タチウオ'];
  if (/青物|ブリ|カンパチ|ヒラマサ/.test(combined)) return ['青物'];
  if (/全魚種/.test(combined)) return ['青物', 'マダイ', 'ヒラメ'];

  return ['青物', 'マダイ', 'ヒラメ'];
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction
// ---------------------------------------------------------------------------

export const scrapeSeafloorControlPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`[seafloor-control] Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();

  const productSlug = extractSlugFromUrl(url);

  // --- Product name from <title> ---
  let name = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    name = stripTags(titleMatch[1]).split('|')[0].trim();
  }
  if (!name || name.length < 2) {
    const ogTitleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (ogTitleMatch) {
      name = ogTitleMatch[1].split('|')[0].trim();
    }
  }
  if (!name || name.length < 2) {
    const nameImgMatch = html.match(/src="[^"]*text-[^"]*"[^>]*alt="([^"]+)"/i)
      || html.match(/alt="([^"]+)"[^>]*src="[^"]*text-/i);
    if (nameImgMatch) {
      name = nameImgMatch[1].trim();
    }
  }
  if (!name || name.length < 2) {
    const hMatch = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
    if (hMatch) name = stripTags(hMatch[1]);
  }
  if (!name || name.length < 2) {
    name = productSlug.charAt(0).toUpperCase() + productSlug.slice(1);
  }

  const slug = productSlug;

  // --- Description ---
  const descParts: string[] = [];
  const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = stripTags(m[1]);
    if (text.length > 20
        && !text.includes('ご購入')
        && !text.includes('ONLINE SHOP')
        && !text.includes('Cookie')
        && !text.includes('copyright')
        && !text.includes('©')
        && descParts.length < 3) {
      descParts.push(text);
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
    const schemaImgMatch = html.match(/"image"\s*:\s*\{\s*[^}]*"url"\s*:\s*"([^"]+)"/i);
    if (schemaImgMatch) {
      mainImage = absoluteUrl(schemaImgMatch[1]);
    }
  }
  if (!mainImage) {
    const imgMatches = [...html.matchAll(/src="([^"]+\/wp-content\/uploads\/[^"]+)"/gi)];
    for (const m of imgMatches) {
      const src = m[1];
      if (!src.includes('logo') && !src.includes('icon') && !src.includes('color')
          && !src.includes('title_')) {
        mainImage = absoluteUrl(src);
        break;
      }
    }
  }

  // --- Color swatches ---
  // Pattern: <img src="...colorN.png" alt="01.シルバー"> linked via <a href="...colorpopN.png">
  const colors: ScrapedColor[] = [];
  const seenColors = new Set<string>();

  // Match color images with alt text (both attribute orders)
  const colorImgMatches = [...html.matchAll(/<img[^>]+src="([^"]*color\d+\.[^"]+)"[^>]*alt="([^"]*)"/gi)];
  for (const m of colorImgMatches) {
    const src = m[1];
    const alt = m[2].trim();
    if (src.includes('colorpop')) continue;

    const colorName = alt || `カラー${colors.length + 1}`;
    if (seenColors.has(colorName)) continue;
    seenColors.add(colorName);

    // Try to find colorpop (full-size) image
    const numMatch = src.match(/color(\d+)/);
    const popupMatch = numMatch
      ? html.match(new RegExp(`href="([^"]*colorpop${numMatch[1]}[^"]*)"`, 'i'))
      : null;
    const imageUrl = popupMatch ? absoluteUrl(popupMatch[1]) : absoluteUrl(src);

    colors.push({ name: colorName, imageUrl });
  }

  // Also try reversed attribute order
  if (colors.length === 0) {
    const revMatches = [...html.matchAll(/alt="([^"]*)"[^>]*src="([^"]*color\d+\.[^"]+)"/gi)];
    for (const m of revMatches) {
      const alt = m[1].trim();
      const src = m[2];
      if (src.includes('colorpop')) continue;

      const colorName = alt || `カラー${colors.length + 1}`;
      if (seenColors.has(colorName)) continue;
      seenColors.add(colorName);
      colors.push({ name: colorName, imageUrl: absoluteUrl(src) });
    }
  }

  // --- Weight extraction ---
  const weights: number[] = [];
  const seenWeights = new Set<number>();
  const bodyText = stripTags(html);

  const weightMatches = [...bodyText.matchAll(/([\d.]+)\s*g/g)];
  for (const m of weightMatches) {
    const w = parseFloat(m[1]);
    if (w >= 30 && w <= 1500 && !seenWeights.has(w)) {
      seenWeights.add(w);
      weights.push(w);
    }
    if (weights.length >= 20) break;
  }

  if (weights.length === 0) {
    const cellMatches = [...html.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
    for (const m of cellMatches) {
      const text = stripTags(m[1]);
      const wm = text.match(/([\d.]+)\s*g/);
      if (wm) {
        const w = parseFloat(wm[1]);
        if (w >= 30 && w <= 1500 && !seenWeights.has(w)) {
          seenWeights.add(w);
          weights.push(w);
        }
      }
    }
  }

  weights.sort((a, b) => a - b);

  // --- Length ---
  let length: number | null = null;
  const lenMatch = bodyText.match(/全長\s*([\d.]+)\s*(mm|cm)/);
  if (lenMatch) {
    const val = parseFloat(lenMatch[1]);
    length = lenMatch[2] === 'cm' ? val * 10 : val;
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
    price: 0, // SFC does not show prices on product pages
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };
};
