// scripts/scrapers/nature-boys.ts
// Nature Boys scraper — WP REST API, UTF-8, fetch-only
// Products from categories 6 (IRON JIG) and 35 (LURE)
// Three content patterns:
//   Pattern A: Structured tables (Color in <br>-separated cell, Weight/Price in lineup table)
//   Pattern B: Single-column color table + Weight/Price table
//   Pattern C: Specs in paragraphs (no structured tables)
// Prices are tax-excluded → ×1.1 for tax-inclusive

import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_REGION,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  AIRTABLE_PAT, AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID, AIRTABLE_MAKER_TABLE_ID,
  IMAGE_WIDTH,
} from '../config.js';
import type { ScraperFunction, ScrapedLure, ScrapedColor as ScrapedColorType } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'Nature Boys';
const MANUFACTURER_SLUG = 'nature-boys';
const SITE_BASE = 'https://www.e-natureboys.com';
const API_BASE = `${SITE_BASE}/wp-json/wp/v2`;
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Categories to fetch
const CATEGORIES = [6, 35]; // 6=IRON JIG, 35=LURE

// Type mapping by product name patterns
// Category 6 products default to メタルジグ
// Specific overrides for LURE category products
const TYPE_OVERRIDES: Record<string, string> = {
  'PELICAN': 'ポッパー',
  'SURFISH': 'ミノー',
  '海燕': 'ミノー',
  'Umitsubame': 'ミノー',
  '鉄腕バイブ': 'バイブレーション',
  'TETSUWAN VIB': 'バイブレーション',
};

// Target fish by type
const TARGET_FISH_JIG = ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'];
const TARGET_FISH_PLUG = ['シイラ', 'ヒラマサ'];

// Products to skip (rods, accessories, reuse/used items)
const SKIP_CATEGORIES = new Set([7, 10, 14, 15, 20, 22, 23, 25, 37]);
const SKIP_TITLES = ['REUSE JIG', 'IRONWILL', 'IRONHOOK', 'IRONFLICK', 'IRONRANGE', 'IRONCAT', 'NCO REACTOR', 'SPINNING KNOTTER'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WPPage {
  id: number;
  slug: string;
  title: { rendered: string };
  content: { rendered: string };
  link: string;
  categories: number[];
}

interface WeightPrice {
  weight: number;
  price: number; // tax-excluded
  length: number | null;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  type: string;
  targetFish: string[];
  description: string;
  colors: string[];
  weightPrices: WeightPrice[];
  colorImages: { url: string; colorName?: string }[];
  mainImageUrl: string | null;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [nature-boys] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [nature-boys] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
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

function stripTagsKeepBr(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .trim();
}

/** Decode URL-encoded slug to readable form */
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Create a clean slug for our database */
function makeSlug(wpSlug: string, title: string): string {
  // First try to use WP slug if it's ASCII-friendly
  const decoded = decodeSlug(wpSlug);

  // If slug is mostly ASCII, use it directly
  if (/^[a-z0-9-]+$/.test(decoded)) return decoded;

  // Otherwise, create slug from English part of title
  const englishPart = title
    .replace(/[／/]/g, ' ')
    .split(/\s+/)
    .filter(w => /^[A-Za-z0-9]/.test(w))
    .join(' ');

  if (englishPart) {
    return englishPart
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Fallback: use decoded slug, replacing non-ASCII
  return decoded
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Clean a product name from WP title */
function cleanProductName(title: string): string {
  // Remove HTML entities
  let name = title
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#038;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim();

  // Split on / or ／ and take the English part (first) or full name
  const parts = name.split(/[\/／]/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Use the first part (usually English name)
    name = parts[0];
  }

  // Remove trailing weight ranges like "65g～420g" or "100g～300g"
  // Keep them if they're important for differentiation (like 60g 80g)
  return name.trim();
}

/** Determine lure type from title and categories */
function determineType(title: string, categories: number[]): string {
  // Check overrides first
  for (const [pattern, type] of Object.entries(TYPE_OVERRIDES)) {
    if (title.includes(pattern)) return type;
  }
  // Category 6 = IRON JIG → メタルジグ
  if (categories.includes(6)) return 'メタルジグ';
  // Category 35 LURE without override
  return 'メタルジグ';
}

/** Determine target fish based on type */
function determineTargetFish(type: string): string[] {
  if (type === 'ポッパー' || type === 'ミノー') return TARGET_FISH_PLUG;
  return TARGET_FISH_JIG;
}

/** Check if product should be skipped */
function shouldSkip(page: WPPage): boolean {
  // Skip if all categories are non-lure categories
  const hasLureCategory = page.categories.some(c => c === 6 || c === 35);
  if (!hasLureCategory) return true;

  // Skip if has accessory/rod categories without jig/lure
  const hasSkipCategory = page.categories.some(c => SKIP_CATEGORIES.has(c));
  if (hasSkipCategory && !page.categories.includes(6) && !page.categories.includes(35)) return true;

  // Skip specific product types by title
  const title = page.title.rendered;
  if (SKIP_TITLES.some(skip => title.includes(skip))) return true;

  return false;
}

// ---------------------------------------------------------------------------
// R2 client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function processAndUploadImage(imageUrl: string, r2Key: string): Promise<string> {
  const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${SITE_BASE}${imageUrl}`;
  const res = await fetch(fullUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Image download failed: ${res.status} ${fullUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const webp = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: r2Key, Body: webp, ContentType: 'image/webp',
  }));
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function lureExists(slug: string, colorName: string, weight: number | null): Promise<boolean> {
  let q = `manufacturer_slug=eq.${encodeURIComponent(MANUFACTURER_SLUG)}&slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
  q += weight !== null ? `&weight=eq.${weight}` : '&weight=is.null';
  q += '&select=id&limit=1';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures?${q}`, {
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase query error: ${res.status}`);
  return ((await res.json()) as unknown[]).length > 0;
}

async function insertLure(row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lures`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert error ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch(tableId: string, path: string, init?: RequestInit): Promise<unknown> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findOrCreateMaker(): Promise<string> {
  const formula = encodeURIComponent(`{Slug}='${MANUFACTURER_SLUG}'`);
  const search = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${formula}&maxRecords=1`) as { records: { id: string }[] };
  if (search.records.length > 0) return search.records[0].id;

  const created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'メーカー名': MANUFACTURER,
        'Slug': MANUFACTURER_SLUG,
        'ステータス': '処理中',
        '公式サイト': SITE_BASE,
      },
    }),
  }) as { id: string };
  log(`Created Airtable maker record: ${created.id}`);
  return created.id;
}

async function createAirtableLureRecord(
  name: string, url: string, makerRecordId: string,
  status: string, memo: string,
): Promise<void> {
  await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'ルアー名': name,
        'URL': url,
        'メーカー': [makerRecordId],
        'ステータス': status,
        '備考': memo,
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Parsing: extract colors from content
// ---------------------------------------------------------------------------

function parseColors(html: string): string[] {
  const colors: string[] = [];
  const seen = new Set<string>();

  // Pattern A: Color in table cell with <br> separated values
  // <table><tbody><tr><td>Color</td><td>COLOR1<br>COLOR2<br>...</td></tr>
  const colorTableMatch = html.match(/<table[^>]*><tbody>[\s\S]*?<tr[^>]*>\s*<td[^>]*>\s*Color\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (colorTableMatch) {
    const cellContent = colorTableMatch[1];
    const lines = stripTagsKeepBr(cellContent).split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleaned = cleanColorName(line);
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        colors.push(cleaned);
      }
    }
    if (colors.length > 0) return colors;
  }

  // Pattern A alt: 色 or カラー (Japanese "color") in table
  const colorTableMatchJp = html.match(/<table[^>]*><tbody>[\s\S]*?<tr[^>]*>\s*<td[^>]*>\s*(?:色|カラー)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (colorTableMatchJp) {
    const cellContent = colorTableMatchJp[1];
    const lines = stripTagsKeepBr(cellContent).split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const cleaned = cleanColorName(line);
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        colors.push(cleaned);
      }
    }
    if (colors.length > 0) return colors;
  }

  // Pattern B: Single-column color table (one color per row)
  // e.g., 鉄腕バイブZn has <table><tbody><tr><td>01K CHROME SARDINE</td></tr>...
  const singleColTables = [...html.matchAll(/<figure class="wp-block-table">\s*<table[^>]*><tbody>([\s\S]*?)<\/tbody><\/table>/gi)];
  for (const tableMatch of singleColTables) {
    const tbody = tableMatch[1];
    const rows = [...tbody.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)];
    // Check if this looks like a color table (rows with color-like values)
    if (rows.length >= 3) {
      const isColorTable = rows.every(r => {
        const text = stripTags(r[1]).trim();
        // Color names typically start with digits+K or are uppercase English
        return /^\d{2}K\s/.test(text) || /^[A-Z]/.test(text);
      });
      // But exclude weight/price tables
      const hasWeightOrPrice = rows.some(r => {
        const text = stripTags(r[1]).trim();
        return /^(Weight|Price|WEIGHT|PRICE)/i.test(text) || /¥/.test(text) || /^\d+g$/.test(text);
      });
      if (isColorTable && !hasWeightOrPrice && rows.length >= 3) {
        for (const row of rows) {
          const text = stripTags(row[1]).trim();
          if (text) {
            const cleaned = cleanColorName(text);
            if (cleaned && !seen.has(cleaned)) {
              seen.add(cleaned);
              colors.push(cleaned);
            }
          }
        }
        if (colors.length > 0) return colors;
      }
    }
  }

  // Pattern C: Colors in paragraphs after "COLOR" or "カラー" heading
  // Handles ●COLOR, •COLOR, ◆COLOR, ○カラー, Color (at end of <p>)
  // Strategy: find the COLOR marker, then collect <p> tags until a stop marker
  const colorMarkerIdx = html.search(/[●•◆○]\s*COLOR\s*<\/p>/i);
  const colorMarkerIdx2 = html.search(/(?:○カラーラインアップ|カラー\s*[：:])\s*<\/p>/i);
  const colorStartIdx = colorMarkerIdx >= 0 ? colorMarkerIdx : colorMarkerIdx2;
  if (colorStartIdx >= 0) {
    // Find the end of the marker <p> tag
    const markerEndIdx = html.indexOf('</p>', colorStartIdx) + 4;
    const afterSection = html.substring(markerEndIdx);
    // Collect color names from <p> tags until a stop marker
    const pTags = [...afterSection.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    for (const pTag of pTags) {
      const text = stripTags(pTag[1]).trim();
      if (!text) continue;
      // Stop markers: How to use, TARGET, SPEC, 発売, etc.
      if (/How to use|使用方法|TARGET|発売|SPEC|製品画像|製品写真|フィールド|@nature/i.test(text)) break;
      // Skip non-color content
      if (/^[\[（(【［]/.test(text)) break;
      if (/^(NEW|素材|全長|重量|推奨|対象|SIZE|TARGET|HOOK|RING|PRICE|価格|発売|SPEC|Material)/i.test(text)) break;
      if (/^https?:/.test(text)) continue;
      if (text.length > 80) continue; // Too long for a color name

      // Could be a color line
      const cleaned = cleanColorName(text);
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        colors.push(cleaned);
      }
    }
    if (colors.length > 0) return colors;
  }

  // Pattern D: Color name <p> followed by <figure><img> (PELICAN220F style)
  // <p>TOBI IKA</p> <figure...><img src="..."/></figure> <p>TOBIUO</p> <figure...>
  const colorImgPairs = [...html.matchAll(/<p[^>]*>\s*([A-Z][A-Z\s]{2,30})\s*<\/p>\s*(?:<\/div>\s*)?<figure[^>]*>\s*<img[^>]+src="([^"]+)"/gi)];
  if (colorImgPairs.length >= 2) {
    for (const [, colorText] of colorImgPairs) {
      const cleaned = colorText.trim();
      if (cleaned && !seen.has(cleaned) && cleaned.length < 40) {
        // Skip non-color uppercase text
        if (/^(SPEC|TARGET|HOOK|RING|SIZE|PRICE|WEIGHT|COLOR|NEW|FOR|HOW|MADE)/i.test(cleaned)) continue;
        seen.add(cleaned);
        colors.push(cleaned);
      }
    }
    if (colors.length > 0) return colors;
  }

  // Fallback: look for numbered color lines (01K ..., 02K ...)
  const numberedColors = [...html.matchAll(/<p[^>]*>\s*(\d{2}K[　\s]+[^<]+)<\/p>/gi)];
  for (const match of numberedColors) {
    const text = stripTags(match[1]).trim();
    const cleaned = cleanColorName(text);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      colors.push(cleaned);
    }
  }

  return colors;
}

/** Clean color name: remove number prefix (01K, 02K), halfwidth kana → keep as is */
function cleanColorName(raw: string): string {
  let name = raw.trim();
  // Remove #XX or XXK prefix
  name = name.replace(/^\d{2}K\s*/, '');
  // Remove product code suffixes like SFH220F-05K
  name = name.replace(/\s+\w+\d+[FK]-\d+K$/i, '');
  // Remove leading/trailing whitespace and special chars
  name = name.replace(/^[・•◆○]\s*/, '');

  // If has both English and Japanese separated by / or space
  const parts = name.split(/[\/／]/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    // Prefer Japanese if available
    const jp = parts.find(p => /[\u3040-\u9fff\u30a0-\u30ff]/.test(p));
    if (jp) return jp;
    return parts[0];
  }

  // If has Japanese in parentheses or after space
  const jpInParen = name.match(/[（(]([^)）]+)[)）]/);
  if (jpInParen && /[\u3040-\u9fff\u30a0-\u30ff]/.test(jpInParen[1])) {
    return jpInParen[1].trim();
  }

  // If has both English and Japanese separated by space
  const spaceParts = name.split(/\s+/);
  if (spaceParts.length >= 2) {
    const jpPart = spaceParts.find(p => /^[\u3040-\u9fff\u30a0-\u30ff]+$/.test(p));
    const engPart = spaceParts.find(p => /^[A-Z][A-Z\s]+$/i.test(p));
    // If we have both, prefer Japanese
    if (jpPart && engPart) return jpPart;
  }

  return name.trim();
}

// ---------------------------------------------------------------------------
// Parsing: extract weight/price from content
// ---------------------------------------------------------------------------

function parseWeightPrices(html: string): WeightPrice[] {
  const results: WeightPrice[] = [];

  // Pattern A: Lineup table with Weight/Price rows
  // <figure class="wp-block-table is-style-lineup"><table><tbody>
  //   <tr><td>Weight</td><td>100g</td><td>130g</td>...</tr>
  //   <tr><td>Price</td><td>¥2,400</td><td>¥2,600</td>...</tr>
  // </tbody></table></figure>
  const lineupTableMatch = html.match(/<figure class="wp-block-table[^"]*is-style-lineup[^"]*">\s*<table[^>]*><tbody>([\s\S]*?)<\/tbody><\/table>/i);
  if (lineupTableMatch) {
    const tbody = lineupTableMatch[1];
    const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (rows.length >= 2) {
      const headerCells = [...rows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim());
      const priceCells = [...rows[1][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim());
      let lengthCells: string[] = [];

      // Check if there's a 3rd row for Length
      if (rows.length >= 3) {
        const thirdRow = [...rows[2][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim());
        // Could be Length row
        if (thirdRow[0] && /Length|全長|サイズ/i.test(thirdRow[0])) {
          lengthCells = thirdRow;
        }
      }

      // Weight row header check
      if (headerCells[0] && /Weight|ウエイト|ウェイト/i.test(headerCells[0])) {
        for (let i = 1; i < headerCells.length; i++) {
          const wm = headerCells[i].match(/([\d.]+)/);
          const weight = wm ? parseFloat(wm[1]) : null;
          const priceStr = (priceCells[i] || '').replace(/[,，\s¥\\]/g, '');
          const pm = priceStr.match(/(\d+)/);
          const price = pm ? parseInt(pm[1], 10) : 0;
          const lm = lengthCells[i] ? lengthCells[i].match(/([\d.]+)/) : null;
          const length = lm ? parseFloat(lm[1]) : null;

          if (weight !== null) {
            results.push({ weight, price, length });
          }
        }
        if (results.length > 0) return results;
      }
    }
  }

  // Pattern A alt: Table with Weight column header + rows (transposed)
  // Some pages have: Weight | Price in rows instead of columns
  // <table><tbody><tr><td>WEIGHT</td><td>PRICE TAXOUT</td></tr><tr><td>65g</td><td>¥2100</td></tr>...
  const wpTables = [...html.matchAll(/<figure class="wp-block-table[^"]*">\s*<table[^>]*><tbody>([\s\S]*?)<\/tbody><\/table>/gi)];
  for (const tableMatch of wpTables) {
    const tbody = tableMatch[1];
    const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (rows.length < 2) continue;

    const firstRowCells = [...rows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim());
    // Check if first row is header with Weight/Price columns
    const weightColIdx = firstRowCells.findIndex(c => /Weight|ウエイト|ウェイト|WEIGHT/i.test(c));
    const priceColIdx = firstRowCells.findIndex(c => /Price|価格|PRICE/i.test(c));

    if (weightColIdx >= 0 && priceColIdx >= 0) {
      for (let i = 1; i < rows.length; i++) {
        const cells = [...rows[i][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim());
        const wm = (cells[weightColIdx] || '').match(/([\d.]+)/);
        const weight = wm ? parseFloat(wm[1]) : null;
        const priceStr = (cells[priceColIdx] || '').replace(/[,，\s¥\\]/g, '');
        const pm = priceStr.match(/(\d+)/);
        const price = pm ? parseInt(pm[1], 10) : 0;
        if (weight !== null) {
          results.push({ weight, price, length: null });
        }
      }
      if (results.length > 0) return results;
    }

    // Pattern A (horizontal): Weight row + Price row in same table (non-lineup)
    if (firstRowCells.length >= 3 && /Weight|ウエイト|ウェイト|WEIGHT/i.test(firstRowCells[0])) {
      const priceRow = rows.length >= 2 ? [...rows[1][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim()) : [];
      if (priceRow.length >= 2 && /Price|価格|PRICE/i.test(priceRow[0])) {
        const lengthRow = rows.length >= 3 ? [...rows[2][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]).trim()) : [];
        for (let i = 1; i < firstRowCells.length; i++) {
          const wm = firstRowCells[i].match(/([\d.]+)/);
          const weight = wm ? parseFloat(wm[1]) : null;
          const priceStr = (priceRow[i] || '').replace(/[,，\s¥\\]/g, '');
          const pm = priceStr.match(/(\d+)/);
          const price = pm ? parseInt(pm[1], 10) : 0;
          const lm = lengthRow[i] ? lengthRow[i].match(/([\d.]+)/) : null;
          const length = lm ? parseFloat(lm[1]) : null;
          if (weight !== null) {
            results.push({ weight, price, length });
          }
        }
        if (results.length > 0) return results;
      }
    }
  }

  // Pattern C: Specs in paragraphs
  // Look for weight+price pairs like "60ｇ￥2,600" or "125ｇ ¥2,700"
  // Or separate lines like "60ｇ\2,600"
  const weightPriceLines = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const pMatch of weightPriceLines) {
    const text = stripTags(pMatch[1]).trim();
    // Match patterns like: 60ｇ￥2,600 or 60ｇ\2,600 or 60g ¥2600
    const wpMatch = text.match(/(\d+)[gｇ]\s*[￥¥\\]\s*([\d,，]+)/);
    if (wpMatch) {
      const weight = parseFloat(wpMatch[1]);
      const price = parseInt(wpMatch[2].replace(/[,，]/g, ''), 10);
      if (weight > 0 && price > 0) {
        results.push({ weight, price, length: null });
      }
    }
  }
  if (results.length > 0) return results;

  // Pattern C alt: SPEC section with weight info + separate price section
  // e.g., "◆SPEC：65g、80g、100g、120g、145g"
  const specMatch = html.match(/SPEC[：:]?\s*([\d,、gｇ\s～~]+)/i);
  const priceRangeMatch = html.match(/(?:PRICE|価格)[^¥￥\\]*[¥￥\\]([\d,，]+)[～~][\s]*[¥￥\\]?([\d,，]+)/i);

  if (specMatch) {
    const weights = [...specMatch[1].matchAll(/(\d+)/g)].map(m => parseFloat(m[1]));

    if (priceRangeMatch) {
      const priceMin = parseInt(priceRangeMatch[1].replace(/[,，]/g, ''), 10);
      const priceMax = parseInt(priceRangeMatch[2].replace(/[,，]/g, ''), 10);
      const priceStep = weights.length > 1 ? Math.round((priceMax - priceMin) / (weights.length - 1)) : 0;

      for (let i = 0; i < weights.length; i++) {
        const price = priceMin + priceStep * i;
        results.push({ weight: weights[i], price, length: null });
      }
    } else {
      // Try to find individual price lines
      for (const w of weights) {
        const priceMatch = html.match(new RegExp(`${w}[gｇ][^\\d]*[¥￥\\\\]\\s*([\\d,，]+)`, 'i'));
        const price = priceMatch ? parseInt(priceMatch[1].replace(/[,，]/g, ''), 10) : 0;
        results.push({ weight: w, price, length: null });
      }
    }
  }

  // Also try to find spec lines like "DB1125 125ｇ 全長（Length）200mm"
  const specLines = [...html.matchAll(/<p[^>]*>\s*\w+\d+\s+(\d+)[gｇ]\s*全長[（(]Length[)）]\s*(\d+)mm/gi)];
  if (specLines.length > 0) {
    // Clear and rebuild with length info
    const withLength: WeightPrice[] = [];
    for (const m of specLines) {
      const weight = parseFloat(m[1]);
      const length = parseFloat(m[2]);
      // Find matching price from results
      const existing = results.find(r => r.weight === weight);
      withLength.push({ weight, price: existing?.price || 0, length });
    }
    if (withLength.length > 0 && withLength.some(w => w.length !== null)) {
      return withLength;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Parsing: extract images
// ---------------------------------------------------------------------------

function parseMainImage(html: string): string | null {
  // First image in content (usually the main product image)
  const firstImg = html.match(/<img[^>]+src="([^"]+)"/i);
  if (firstImg) {
    const src = firstImg[1];
    return src.startsWith('http') ? src : `${SITE_BASE}${src}`;
  }
  return null;
}

function parseColorImages(html: string): { url: string; colorName?: string }[] {
  const images: { url: string; colorName?: string }[] = [];
  const seen = new Set<string>();

  // Look for gallery section (製品画像 or 製品写真)
  const gallerySectionMatch = html.match(/(?:製品画像|製品写真)([\s\S]*?)(?:<div class="is-layout-flex wp-block-buttons|<figure class="wp-block-embed|<a [^>]*>フィールド|$)/i);
  if (gallerySectionMatch) {
    const section = gallerySectionMatch[1];
    // Find all images in gallery
    const galleryImgs = [...section.matchAll(/<a[^>]+href="([^"]+\.(jpg|jpeg|png|webp))"/gi)];
    if (galleryImgs.length === 0) {
      // Fallback: img src
      const imgSrcs = [...section.matchAll(/<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp))"/gi)];
      for (const [, src] of imgSrcs) {
        const url = src.startsWith('http') ? src : `${SITE_BASE}${src}`;
        if (!seen.has(url)) {
          seen.add(url);
          images.push({ url });
        }
      }
    } else {
      for (const [, href] of galleryImgs) {
        const url = href.startsWith('http') ? href : `${SITE_BASE}${href}`;
        if (!seen.has(url)) {
          seen.add(url);
          images.push({ url });
        }
      }
    }
    return images;
  }

  // No gallery section - look for color-specific images
  // Pattern: Color name in <p> followed by <figure><img>
  const colorImgPattern = [...html.matchAll(/<p[^>]*>\s*([A-Z][A-Z\s]+(?:\/[^\n<]+)?)\s*<\/p>\s*(?:<\/div>\s*)?<figure[^>]*>\s*<img[^>]+src="([^"]+)"/gi)];
  for (const [, colorName, src] of colorImgPattern) {
    const url = src.startsWith('http') ? src : `${SITE_BASE}${src}`;
    if (!seen.has(url)) {
      seen.add(url);
      images.push({ url, colorName: colorName.trim() });
    }
  }

  // Fallback: look for the color composite image (image right after COLOR section)
  const colorCompositeMatch = html.match(/(?:•\s*COLOR|カラーラインアップ|Color\s*[：:]?)[\s\S]*?<figure[^>]*>\s*<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp))"/i);
  if (colorCompositeMatch && images.length === 0) {
    const url = colorCompositeMatch[1].startsWith('http') ? colorCompositeMatch[1] : `${SITE_BASE}${colorCompositeMatch[1]}`;
    if (!seen.has(url)) {
      images.push({ url });
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// Parsing: extract description
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Get text from first substantial paragraphs
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const texts: string[] = [];

  for (const [, content] of paragraphs) {
    const text = stripTags(content).trim();
    if (!text) continue;
    // Skip metadata, specs, how-to, etc
    if (/^[\[【]/.test(text)) continue;
    if (/^(•|◆|○|＊|※|#|@|http)/.test(text)) continue;
    if (/^(NEW|SPEC|COLOR|TARGET|HOOK|RING|SIZE|PRICE|How to use|使用方法|発売|価格|小売|品番|カラー|素材|全長|重量|推奨|対象)/i.test(text)) continue;
    if (/^(NatureBoys|Nature Boys)\s*[(（]/.test(text)) continue;
    if (/^[A-Z]{2}\d+\s+\d+/.test(text)) continue; // Spec code lines
    if (/^(\d{2}K\s)/.test(text)) continue; // Color lines
    if (/^(BKK|Gamakatu|SINGLE|Ring|Treble|推奨HOOK)/i.test(text)) continue;
    if (/^\d+[gｇ]\s*[¥￥\\]/.test(text)) continue; // Price lines
    if (text.length < 10) continue;
    // Skip English-only paragraphs (duplicates of Japanese content)
    if (/^[A-Za-z\s.,!?'"()\-:;0-9/]+$/.test(text) && text.length > 30) continue;
    if (/^(We started|This diving|This lure|A swimming|Due to|TARGET：|SIZE:|HOOK:|RING:)/i.test(text)) continue;

    texts.push(text);
    if (texts.join(' ').length > 300) break;
  }

  let desc = texts.join(' ');
  if (desc.length > 500) desc = desc.substring(0, 500);
  return desc;
}

// ---------------------------------------------------------------------------
// Scrape products via WP REST API
// ---------------------------------------------------------------------------

async function fetchAllProducts(): Promise<WPPage[]> {
  const allPages = new Map<number, WPPage>();

  for (const catId of CATEGORIES) {
    log(`Fetching category ${catId}...`);
    const pages = await fetchJSON<WPPage[]>(
      `${API_BASE}/pages?categories=${catId}&per_page=100&_fields=id,slug,title,content,link,categories`
    );
    log(`  Category ${catId}: ${pages.length} pages`);
    for (const page of pages) {
      if (!allPages.has(page.id)) {
        allPages.set(page.id, page);
      }
    }
    await sleep(500);
  }

  log(`Total unique pages: ${allPages.size}`);
  return [...allPages.values()];
}

function scrapeProduct(page: WPPage): ScrapedProduct {
  const html = page.content.rendered;
  const title = page.title.rendered;

  const name = cleanProductName(title);
  const slug = makeSlug(page.slug, title);
  const type = determineType(title, page.categories);
  const targetFish = determineTargetFish(type);
  const description = parseDescription(html);
  const colors = parseColors(html);
  const weightPrices = parseWeightPrices(html);
  const mainImageUrl = parseMainImage(html);
  const colorImages = parseColorImages(html);

  return {
    name,
    slug,
    type,
    targetFish,
    description,
    colors,
    weightPrices,
    colorImages,
    mainImageUrl,
    sourceUrl: page.link,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction — fetches a single product page by URL
// ---------------------------------------------------------------------------

export const scrapeNatureBoysPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Try to get page data from WP REST API
  // URL patterns: https://www.e-natureboys.com/XXX/ or /?page_id=123 or /?p=123
  const pageIdMatch = url.match(/[?&](?:page_id|p)=(\d+)/);
  let wpPage: WPPage | null = null;

  if (pageIdMatch) {
    // Fetch by page ID
    const apiUrl = `${API_BASE}/pages/${pageIdMatch[1]}?_fields=id,slug,title,content,link,categories`;
    try {
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (res.ok) {
        wpPage = await res.json() as WPPage;
      }
    } catch { /* fall through */ }
  }

  if (!wpPage) {
    // Try to extract slug from URL path: /slug/ or /parent/slug/
    const pathMatch = url.replace(/\/$/, '').match(/\/([^/?#]+)$/);
    if (pathMatch) {
      const slug = pathMatch[1];
      const apiUrl = `${API_BASE}/pages?slug=${encodeURIComponent(slug)}&_fields=id,slug,title,content,link,categories`;
      try {
        const res = await fetch(apiUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        });
        if (res.ok) {
          const pages = await res.json() as WPPage[];
          if (pages.length > 0) wpPage = pages[0];
        }
      } catch { /* fall through */ }
    }
  }

  if (wpPage) {
    // Use existing parsing logic
    const scraped = scrapeProduct(wpPage);

    const colors: ScrapedColorType[] = scraped.colors.map(c => ({
      name: c,
      imageUrl: '',
    }));

    // Map color images if available
    for (const ci of scraped.colorImages) {
      if (ci.colorName) {
        const existing = colors.find(c => c.name === ci.colorName);
        if (existing) {
          existing.imageUrl = ci.url.startsWith('http') ? ci.url : `${SITE_BASE}${ci.url}`;
        }
      }
    }

    const weights = scraped.weightPrices.map(wp => wp.weight);
    const price = scraped.weightPrices.length > 0 && scraped.weightPrices[0].price > 0
      ? Math.round(scraped.weightPrices[0].price * 1.1) // tax-inclusive
      : 0;
    const length = scraped.weightPrices.find(wp => wp.length !== null)?.length ?? null;

    return {
      name: scraped.name,
      name_kana: '',
      slug: scraped.slug,
      manufacturer: MANUFACTURER,
      manufacturer_slug: MANUFACTURER_SLUG,
      type: scraped.type,
      target_fish: scraped.targetFish,
      description: scraped.description,
      price,
      colors,
      weights,
      length,
      mainImage: scraped.mainImageUrl || '',
      sourceUrl: url,
    };
  }

  // Fallback: fetch HTML page directly and parse
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const fullHtml = await res.text();

  // Extract title from <h1> or <title>
  const titleMatch = fullHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || fullHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch ? stripTags(titleMatch[1]).replace(/\s*[|–—].*$/, '').trim() : 'Unknown';
  const name = cleanProductName(rawTitle);

  // Extract content area
  const contentMatch = fullHtml.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<nav|<div[^>]*class="[^"]*(?:post-share|entry-footer))/i)
    || fullHtml.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*)/i);
  const contentHtml = contentMatch ? contentMatch[1] : fullHtml;

  // Extract slug from URL
  const urlSlugMatch = url.replace(/\/$/, '').match(/\/([^/?#]+)$/);
  const wpSlug = urlSlugMatch ? urlSlugMatch[1] : '';
  const slug = makeSlug(wpSlug, rawTitle);

  // Determine type from page content (check for category clues)
  const type = determineType(rawTitle, []);
  const targetFish = determineTargetFish(type);
  const description = parseDescription(contentHtml);
  const parsedColors = parseColors(contentHtml);
  const weightPrices = parseWeightPrices(contentHtml);
  const mainImageUrl = parseMainImage(contentHtml);

  const colors: ScrapedColorType[] = parsedColors.map(c => ({
    name: c,
    imageUrl: '',
  }));

  const weights = weightPrices.map(wp => wp.weight);
  const price = weightPrices.length > 0 && weightPrices[0].price > 0
    ? Math.round(weightPrices[0].price * 1.1)
    : 0;
  const length = weightPrices.find(wp => wp.length !== null)?.length ?? null;

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
    mainImage: mainImageUrl || '',
    sourceUrl: url,
  };
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  let totalProducts = 0;
  let totalRows = 0;
  let totalColors = 0;
  let totalImages = 0;
  let errorCount = 0;

  log('========================================');
  log('Nature Boys Pipeline Start');
  log('========================================');

  // --- Fetch all product pages ---
  const pages = await fetchAllProducts();

  // --- Filter out non-lure products ---
  const lurePages = pages.filter(p => !shouldSkip(p));
  log(`Lure products after filtering: ${lurePages.length}`);

  // --- Airtable: find or create maker ---
  let makerRecordId: string;
  try {
    makerRecordId = await findOrCreateMaker();
    log(`Airtable maker record: ${makerRecordId}`);
  } catch (err) {
    logError(`Airtable maker setup failed: ${err instanceof Error ? err.message : err}`);
    logError('Continuing without Airtable...');
    makerRecordId = '';
  }

  // --- Process each product ---
  for (const page of lurePages) {
    const title = page.title.rendered;
    log(`\n--- ${title} (id=${page.id}) ---`);

    try {
      const scraped = scrapeProduct(page);
      totalProducts++;

      log(`  Name: ${scraped.name}, Slug: ${scraped.slug}, Type: ${scraped.type}`);
      log(`  Colors: ${scraped.colors.length}, Weight/Prices: ${scraped.weightPrices.length}`);
      if (scraped.colors.length > 0) {
        log(`  Color list: ${scraped.colors.join(', ')}`);
      }
      if (scraped.weightPrices.length > 0) {
        log(`  Weights: ${scraped.weightPrices.map(wp => `${wp.weight}g/¥${wp.price}`).join(', ')}`);
      }

      if (scraped.colors.length === 0) {
        logError(`  No colors found`);
        errorCount++;
        continue;
      }

      if (scraped.weightPrices.length === 0) {
        logError(`  No weight/price data found`);
        // Continue with null weight (some products may have approximate weights)
      }

      // Upload main image
      let mainR2Url: string | null = null;
      if (scraped.mainImageUrl) {
        try {
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/main.webp`;
          mainR2Url = await processAndUploadImage(scraped.mainImageUrl, key);
          log(`  Main image uploaded`);
        } catch (err) {
          logError(`  Main image failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Upload color images and build mapping
      const colorImageMap = new Map<string, string>();
      // If we have named color images, map them directly
      const namedColorImages = scraped.colorImages.filter(ci => ci.colorName);
      if (namedColorImages.length > 0) {
        for (const ci of namedColorImages) {
          try {
            const safeName = (ci.colorName || 'color')
              .replace(/[^a-zA-Z0-9\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '-')
              .toLowerCase();
            const key = `${MANUFACTURER_SLUG}/${scraped.slug}/${safeName}.webp`;
            const r2Url = await processAndUploadImage(ci.url, key);
            if (ci.colorName) colorImageMap.set(ci.colorName, r2Url);
            totalImages++;
          } catch (err) {
            logError(`  Color image failed [${ci.colorName}]: ${err instanceof Error ? err.message : err}`);
          }
        }
      } else {
        // Map images to colors by index
        for (let ci = 0; ci < scraped.colorImages.length && ci < scraped.colors.length; ci++) {
          const colorName = scraped.colors[ci];
          try {
            const safeName = colorName
              .replace(/[^a-zA-Z0-9\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '-')
              .toLowerCase();
            const key = `${MANUFACTURER_SLUG}/${scraped.slug}/${safeName}.webp`;
            const r2Url = await processAndUploadImage(scraped.colorImages[ci].url, key);
            colorImageMap.set(colorName, r2Url);
            totalImages++;
          } catch (err) {
            logError(`  Color image failed [${colorName}]: ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      // Insert rows into Supabase: 1 row per color x weight
      let rowsForProduct = 0;
      const weights = scraped.weightPrices.length > 0
        ? scraped.weightPrices
        : [{ weight: null as number | null, price: 0, length: null as number | null }];

      for (const wp of weights) {
        for (const colorName of scraped.colors) {
          // Check if already exists
          if (await lureExists(scraped.slug, colorName, wp.weight)) {
            log(`  Skip (exists): ${colorName} ${wp.weight ? wp.weight + 'g' : ''}`);
            continue;
          }

          // Tax-inclusive price (x1.1, round)
          const taxIncPrice = wp.price > 0 ? Math.round(wp.price * 1.1) : 0;

          const imageUrl = colorImageMap.get(colorName) || mainR2Url;

          await insertLure({
            name: scraped.name,
            slug: scraped.slug,
            manufacturer: MANUFACTURER,
            manufacturer_slug: MANUFACTURER_SLUG,
            type: scraped.type,
            price: taxIncPrice,
            description: scraped.description || null,
            images: imageUrl ? [imageUrl] : null,
            official_video_url: null,
            target_fish: scraped.targetFish,
            length: wp.length,
            weight: wp.weight,
            color_name: colorName,
            color_description: null,
            release_year: null,
            is_limited: false,
            diving_depth: null,
            action_type: null,
            source_url: scraped.sourceUrl,
            is_discontinued: false,
          });

          rowsForProduct++;
          totalRows++;
        }
      }
      totalColors += scraped.colors.length;
      log(`  Inserted ${rowsForProduct} rows, ${colorImageMap.size}/${scraped.colors.length} color images`);

      // Create Airtable lure record
      if (makerRecordId) {
        try {
          await createAirtableLureRecord(
            scraped.name, scraped.sourceUrl, makerRecordId, '登録完了',
            `${scraped.colors.length}色 × ${weights.length}ウェイト = ${rowsForProduct}行`,
          );
        } catch (err) {
          logError(`  Airtable lure record failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      await sleep(500); // Polite delay
    } catch (err) {
      logError(`  Product failed: ${err instanceof Error ? err.message : err}`);
      errorCount++;
    }
  }

  // Update maker status
  if (makerRecordId) {
    try {
      await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `/${makerRecordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { 'ステータス': '登録済み' } }),
      });
      log('\nMaker status updated to 登録済み');
    } catch (err) {
      logError(`Maker status update failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('\n========================================');
  log('Nature Boys Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}/${lurePages.length}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/nature-boys');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
