// scripts/scrapers/crazy-ocean.ts
// Crazy Ocean scraper — WordPress 5.2.21, WP REST API
// API: /wp-json/wp/v2/itemlist?per_page=100&_embed&itemlist_category=XXX
// Lure subcategories under 284:
//   364 = ジギング, 368 = ショアルアー, 367 = ティップラン,
//   402 = タイラバ, 366 = ボートアジング, 369 = トラウト
// Spec table formats:
//   Metal jig: 商品名(+weight rowspan) | カラー | JAN | 本体価格
//   Egi:       サイズ(rowspan) | 自重(rowspan) | カラー名 | JAN | 本体価格(rowspan)
//   Soft bait: 品番(rowspan) | サイズ(rowspan) | カラー名 | JAN | 入数 | 本体価格(rowspan)
//   Tairaba:   品名(rowspan) | カラー名 | JAN | 入り数 | 本体価格(rowspan)
// Prices are tax-excluded → multiply by 1.1 and round

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

const MANUFACTURER = 'CRAZY OCEAN';
const MANUFACTURER_SLUG = 'crazy-ocean';
const SITE_BASE = 'https://crazy-ocean.com';
const API_BASE = `${SITE_BASE}/wp-json/wp/v2/itemlist`;
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Lure subcategory IDs under parent 284
const LURE_CATEGORY_IDS = [364, 368, 367, 402, 366, 369];

// Product IDs to skip (accessories, hooks, spare parts, etc.)
// These will be detected by name patterns
const SKIP_NAME_PATTERNS = [
  /スペアネクタイ/,    // spare necktie parts
  /絡め手フック/,      // hooks
  /替えフック/,        // replacement hooks
  /シンカー(?!.*エギ)/, // sinkers (but not if egi-related)
  /アシスト/,          // assist hooks
];

// Product type classification based on product name and categories
function classifyProduct(name: string, categoryIds: number[]): { type: string; targetFish: string[] } {
  const n = name;
  // Egi / Tip-run egi
  if (/ティップランナー/.test(n) || /キャストランナー/.test(n)) {
    return { type: 'エギ', targetFish: ['アオリイカ'] };
  }
  // Tairaba
  if (/タイラバ/.test(n) || /カチッと/.test(n)) {
    return { type: 'タイラバ', targetFish: ['マダイ'] };
  }
  // Soft bait / worm (海毛虫 series)
  if (/海毛虫/.test(n)) {
    // 海毛虫 Curly → tairaba trailer; regular 海毛虫 → multi-use
    if (/Curly/.test(n)) {
      return { type: 'ワーム', targetFish: ['マダイ', 'アジ', 'メバル'] };
    }
    return { type: 'ワーム', targetFish: ['アジ', 'メバル', 'カサゴ'] };
  }
  // Metal jig (オーシャンフラッシュ, メタボ, トンボジグ, S-GLIDE)
  if (/フラッシュ|メタボ|トンボジグ|S-GLIDE/.test(n)) {
    if (/SJ/.test(n)) {
      // Shore jigging
      return { type: 'メタルジグ', targetFish: ['ブリ', 'サワラ', 'ヒラマサ'] };
    }
    return { type: 'メタルジグ', targetFish: ['ブリ', 'ヒラマサ', 'カンパチ', 'マダイ'] };
  }
  // Default fallback: try to use category info
  if (categoryIds.includes(367)) return { type: 'エギ', targetFish: ['アオリイカ'] };
  if (categoryIds.includes(402)) return { type: 'タイラバ', targetFish: ['マダイ'] };
  if (categoryIds.includes(364)) return { type: 'メタルジグ', targetFish: ['ブリ', 'ヒラマサ', 'カンパチ'] };
  return { type: 'ルアー', targetFish: [] };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WPProduct {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  itemlist_category: number[];
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url: string }>;
  };
}

interface SpecRow {
  productLabel: string;  // e.g., "オーシャンフラッシュ30g" or "UKM ノーマル"
  weight: number | null; // grams
  length: number | null; // mm
  colorName: string;
  jan: string;
  price: number;         // tax-excluded yen
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  description: string;
  categoryIds: number[];
  specRows: SpecRow[];
  featuredImageUrl: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [crazy-ocean] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [crazy-ocean] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '–')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[^\w\u3000-\u9fff\uff00-\uffef-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Image download failed: ${res.status} ${imageUrl}`);
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

async function airtableCreateRecord(tableId: string, fields: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable create error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

async function airtableUpdateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) logError(`Airtable update failed: ${await res.text().catch(() => res.statusText)}`);
}

// ---------------------------------------------------------------------------
// Product discovery via WP REST API
// ---------------------------------------------------------------------------

async function fetchProductsByCategory(categoryId: number): Promise<WPProduct[]> {
  const url = `${API_BASE}?per_page=100&_embed&itemlist_category=${categoryId}`;
  log(`Fetching category ${categoryId}: ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`REST API failed: ${res.status} for category ${categoryId}`);
  return await res.json() as WPProduct[];
}

async function fetchAllLureProducts(): Promise<WPProduct[]> {
  const seen = new Map<number, WPProduct>();
  for (const catId of LURE_CATEGORY_IDS) {
    const products = await fetchProductsByCategory(catId);
    for (const p of products) {
      if (!seen.has(p.id)) {
        seen.set(p.id, p);
      }
    }
    await sleep(300);
  }
  return [...seen.values()];
}

function shouldSkipProduct(name: string): boolean {
  return SKIP_NAME_PATTERNS.some(p => p.test(name));
}

// ---------------------------------------------------------------------------
// HTML content parsing
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Extract text from first <p> block(s)
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const texts: string[] = [];
  for (const p of paragraphs) {
    const text = stripTags(p[1]).trim();
    // Skip empty, English-only, or very short paragraphs
    if (!text || text.length < 10) continue;
    // Stop at DETAIL, COLOR, SPEC sections or 画像をクリック
    if (/^(DETAIL|COLOR|SPEC|MADE IN|画像をクリック|This |The |Furthermore|Also|A jig|Will you)/i.test(text)) break;
    // Skip English paragraphs
    if (/^[A-Za-z\s.,!?'"()]+$/.test(text)) continue;
    texts.push(text);
    if (texts.join(' ').length > 300) break;
  }
  const combined = texts.join(' ').replace(/\n+/g, ' ').trim();
  return combined.length > 500 ? combined.substring(0, 500) : combined;
}

/**
 * Resolve a table with rowspans into a 2D grid of text values.
 * Each cell in the grid is the plain-text content of the corresponding <td>.
 * Rowspan cells are replicated down into subsequent rows.
 */
function resolveTableGrid(tableHtml: string): string[][] {
  const trs = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  // grid[row][col] = text
  const grid: string[][] = [];
  // Track which cells are still "occupied" by a rowspan from a previous row
  // occupied[col] = { text, remaining }
  const occupied: Map<number, { text: string; remaining: number }> = new Map();

  for (const tr of trs) {
    // Match both <td> and <th> tags
    const cells = [...tr[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
    const row: string[] = [];
    let cellIdx = 0;

    for (let col = 0; col < 20; col++) { // max 20 columns
      // Check if this column is occupied by a previous rowspan
      const occ = occupied.get(col);
      if (occ && occ.remaining > 0) {
        row.push(occ.text);
        occ.remaining--;
        if (occ.remaining <= 0) occupied.delete(col);
        continue;
      }

      if (cellIdx >= cells.length) break;

      const cellHtml = cells[cellIdx][0];
      const text = stripTags(cells[cellIdx][1]).trim();
      cellIdx++;

      row.push(text);

      // Handle rowspan
      const rsMatch = cellHtml.match(/rowspan="(\d+)"/);
      if (rsMatch) {
        const rs = parseInt(rsMatch[1], 10);
        if (rs > 1) {
          occupied.set(col, { text, remaining: rs - 1 });
        }
      }
    }

    grid.push(row);
  }

  return grid;
}

function parseSpecTables(html: string): SpecRow[] {
  const rows: SpecRow[] = [];

  // Find all tables in the content
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];

  for (const tableMatch of tables) {
    const tableHtml = tableMatch[1];

    // Check if this is a spec table (has JAN column and price column)
    if (!/JAN/i.test(tableHtml) || !/価格/.test(tableHtml)) continue;

    // Resolve the entire table into a 2D grid with rowspans expanded
    const grid = resolveTableGrid(tableHtml);
    if (grid.length < 2) continue; // need at least header + 1 data row

    // Header row
    const headerCells = grid[0];
    if (headerCells.length < 3) continue;

    // Find column indices
    const productIdx = headerCells.findIndex(h => /商品名|品番|品名/.test(h));
    const sizeIdx = headerCells.findIndex(h => /^サイズ$/.test(h.trim()));
    const weightIdx = headerCells.findIndex(h => /^自重$/.test(h.trim()));
    const colorNumIdx = headerCells.findIndex(h => /^色番$/.test(h.trim()));
    const colorIdx = headerCells.findIndex(h => /カラー/.test(h));
    const janIdx = headerCells.findIndex(h => /JAN/i.test(h));
    const priceIdx = headerCells.findIndex(h => /価格/.test(h));

    if (colorIdx < 0 || janIdx < 0 || priceIdx < 0) continue;

    // Parse data rows
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];

      const productText = productIdx >= 0 && row[productIdx] ? row[productIdx] : '';
      const sizeText = sizeIdx >= 0 && row[sizeIdx] ? row[sizeIdx] : '';
      const weightText = weightIdx >= 0 && row[weightIdx] ? row[weightIdx] : '';
      const colorNumText = colorNumIdx >= 0 && row[colorNumIdx] ? row[colorNumIdx] : '';
      const colorNameText = colorIdx >= 0 && row[colorIdx] ? row[colorIdx] : '';
      // Combine color number and name when they are separate columns
      const colorText = colorNumText && colorNameText
        ? `${colorNumText} ${colorNameText}`
        : colorNameText || colorNumText;
      const janText = (row[janIdx] || '').replace(/\s/g, '');
      const priceText = row[priceIdx] || '';

      // Skip if no color or invalid JAN
      if (!colorText || !/^\d{13}$/.test(janText)) continue;

      // Clean color name (remove 新色 / NEW tags)
      const cleanColor = colorText
        .replace(/新色/g, '')
        .replace(/NEW/gi, '')
        .trim();
      if (!cleanColor) continue;

      // Extract weight
      let weight: number | null = null;
      let length: number | null = null;

      // From product label (e.g., "オーシャンフラッシュ30g")
      const wFromLabel = productText.match(/([\d.]+)\s*g/i);
      if (wFromLabel) weight = parseFloat(wFromLabel[1]);

      // From 自重 column (e.g., "25g")
      if (weight === null && weightText) {
        const wm = weightText.match(/([\d.]+)/);
        if (wm) weight = parseFloat(wm[1]);
      }

      // From サイズ column (e.g., "40g" for jigs, or "3号 (21g)" for egi)
      if (weight === null && sizeText) {
        const wm = sizeText.match(/([\d.]+)\s*g/i);
        if (wm) weight = parseFloat(wm[1]);
        // If size is just a number (e.g., "40g"), it IS the weight
        if (!wm) {
          const plainNum = sizeText.match(/^([\d.]+)$/);
          if (plainNum) weight = parseFloat(plainNum[1]);
        }
      }

      // Extract length
      if (sizeText) {
        const lm = sizeText.match(/\((\d+)\s*mm\)/);
        if (lm) length = parseFloat(lm[1]);
        if (!length) {
          const inMatch = sizeText.match(/([\d.]+)\s*in/i);
          if (inMatch) length = Math.round(parseFloat(inMatch[1]) * 25.4);
        }
      }
      if (!length && productText) {
        const lm = productText.match(/\((\d+)\s*mm\)/);
        if (lm) length = parseFloat(lm[1]);
      }

      // Extract price
      let price = 0;
      const pm = priceText.replace(/[,，\s円]/g, '').match(/(\d+)/);
      if (pm) price = parseInt(pm[1], 10);

      if (weight !== null && (isNaN(weight) || weight <= 0)) weight = null;
      if (length !== null && (isNaN(length) || length <= 0)) length = null;

      rows.push({
        productLabel: productText,
        weight,
        length,
        colorName: cleanColor,
        jan: janText,
        price,
      });
    }
  }

  return rows;
}

function parseFeaturedImage(product: WPProduct): string | null {
  if (product._embedded?.['wp:featuredmedia']?.[0]?.source_url) {
    return product._embedded['wp:featuredmedia'][0].source_url;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scrape a single product
// ---------------------------------------------------------------------------

function scrapeProduct(product: WPProduct): ScrapedProduct {
  const html = product.content.rendered;
  const name = stripTags(product.title.rendered);
  const rawSlug = decodeURIComponent(product.slug);
  const slug = slugify(name);
  const url = product.link;
  const categoryIds = product.itemlist_category || [];

  const description = parseDescription(html);
  const specRows = parseSpecTables(html);
  const featuredImageUrl = parseFeaturedImage(product);

  return {
    name,
    slug,
    url,
    description,
    categoryIds,
    specRows,
    featuredImageUrl,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction — fetches a single product page by URL
// ---------------------------------------------------------------------------

export const scrapeCrazyOceanPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Try to extract post ID from URL query param: ?post_type=itemlist&p=12345
  const postIdMatch = url.match(/[?&]p=(\d+)/);
  let apiData: WPProduct | null = null;

  if (postIdMatch) {
    // Fetch via WP REST API using post ID
    const apiUrl = `${API_BASE}/${postIdMatch[1]}?_embed`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (res.ok) {
      apiData = await res.json() as WPProduct;
    }
  }

  if (!apiData) {
    // Try to extract slug from pretty URL: /itemlist/xxx/
    const slugMatch = url.match(/\/itemlist\/([^/]+)/);
    if (slugMatch) {
      const apiUrl = `${API_BASE}?slug=${encodeURIComponent(slugMatch[1])}&_embed`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (res.ok) {
        const items = await res.json() as WPProduct[];
        if (items.length > 0) apiData = items[0];
      }
    }
  }

  if (!apiData) {
    // Fallback: fetch the HTML page directly and parse it
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
      || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const name = titleMatch ? stripTags(titleMatch[1]).replace(/\s*[|–—].*$/, '').trim() : 'Unknown';
    const slug = slugify(name);

    // Extract content area
    const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<nav|<div[^>]*class="[^"]*(?:post-share|entry-footer))/i)
      || html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*)/i);
    const contentHtml = contentMatch ? contentMatch[1] : html;

    const description = parseDescription(contentHtml);
    const specRows = parseSpecTables(contentHtml);
    const { type, targetFish } = classifyProduct(name, []);

    // Extract featured image from og:image
    const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    const mainImage = ogMatch ? ogMatch[1] : '';

    // Collect unique colors and weights
    const colorSet = new Map<string, ScrapedColorType>();
    const weightSet = new Set<number>();
    let price = 0;
    let length: number | null = null;
    for (const row of specRows) {
      if (row.colorName && !colorSet.has(row.colorName)) {
        colorSet.set(row.colorName, { name: row.colorName, imageUrl: '' });
      }
      if (row.weight !== null) weightSet.add(row.weight);
      if (row.price > 0 && price === 0) price = Math.round(row.price * 1.1);
      if (row.length !== null && length === null) length = row.length;
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
      colors: [...colorSet.values()],
      weights: [...weightSet],
      length,
      mainImage,
      sourceUrl: url,
    };
  }

  // We have API data — use existing parsing functions
  const product = scrapeProduct(apiData);
  const { type, targetFish } = classifyProduct(product.name, product.categoryIds);

  // Collect unique colors and weights from specRows
  const colorSet = new Map<string, ScrapedColorType>();
  const weightSet = new Set<number>();
  let price = 0;
  let length: number | null = null;
  for (const row of product.specRows) {
    if (row.colorName && !colorSet.has(row.colorName)) {
      colorSet.set(row.colorName, { name: row.colorName, imageUrl: '' });
    }
    if (row.weight !== null) weightSet.add(row.weight);
    if (row.price > 0 && price === 0) price = Math.round(row.price * 1.1);
    if (row.length !== null && length === null) length = row.length;
  }

  return {
    name: product.name,
    name_kana: '',
    slug: product.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type,
    target_fish: targetFish,
    description: product.description,
    price,
    colors: [...colorSet.values()],
    weights: [...weightSet],
    length,
    mainImage: product.featuredImageUrl || '',
    sourceUrl: url,
  };
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  let totalProducts = 0;
  let totalScraped = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  let totalImages = 0;
  let totalErrors = 0;

  // 1) Fetch all lure products from REST API across all subcategories
  log('Fetching all lure products from WP REST API...');
  const allProducts = await fetchAllLureProducts();
  log(`Found ${allProducts.length} unique lure products across ${LURE_CATEGORY_IDS.length} subcategories`);

  // 2) Filter products
  const lureProducts = allProducts.filter(p => {
    const name = stripTags(p.title.rendered);
    if (shouldSkipProduct(name)) {
      log(`  SKIP (pattern): ${name}`);
      return false;
    }
    return true;
  });
  totalProducts = lureProducts.length;
  log(`After filtering: ${totalProducts} lure products`);
  for (const p of lureProducts) {
    log(`  ${p.id} — ${stripTags(p.title.rendered)}`);
  }

  // 3) Register maker in Airtable
  let makerRecordId = '';
  try {
    const searchUrl = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_MAKER_TABLE_ID}?filterByFormula={Slug}="${MANUFACTURER_SLUG}"&maxRecords=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` },
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json() as { records: { id: string }[] };
      if (searchData.records.length > 0) {
        makerRecordId = searchData.records[0].id;
        log(`Found existing Airtable maker record: ${makerRecordId}`);
      }
    }
    if (!makerRecordId) {
      makerRecordId = await airtableCreateRecord(AIRTABLE_MAKER_TABLE_ID, {
        'メーカー名': MANUFACTURER,
        'Slug': MANUFACTURER_SLUG,
        'URL': SITE_BASE,
        'ステータス': 'スクレイピング中',
      });
      log(`Created Airtable maker record: ${makerRecordId}`);
    }
  } catch (e) {
    logError(`Airtable maker registration: ${e}`);
  }

  // 4) Process each product
  for (let i = 0; i < lureProducts.length; i++) {
    const wp = lureProducts[i];
    const title = stripTags(wp.title.rendered);
    log(`\n--- [${i + 1}/${lureProducts.length}] ${title} (id=${wp.id}) ---`);

    let product: ScrapedProduct;
    try {
      product = scrapeProduct(wp);
    } catch (e) {
      logError(`Product parse failed: ${e}`);
      totalErrors++;
      continue;
    }

    if (product.specRows.length === 0) {
      log(`  No spec rows found — skipping`);
      totalSkipped++;
      continue;
    }

    totalScraped++;

    const { type, targetFish } = classifyProduct(product.name, product.categoryIds);
    log(`  Type: ${type} | Target: ${targetFish.join(', ')}`);
    log(`  Description: ${product.description.substring(0, 80)}${product.description.length > 80 ? '...' : ''}`);
    log(`  Spec rows: ${product.specRows.length} (color × weight combinations)`);
    log(`  Featured image: ${product.featuredImageUrl ? 'yes' : 'no'}`);

    // Upload featured image
    let mainR2Url: string | null = null;
    if (product.featuredImageUrl) {
      try {
        const key = `${MANUFACTURER_SLUG}/${product.slug}/main.webp`;
        mainR2Url = await processAndUploadImage(product.featuredImageUrl, key);
        log(`  Main image uploaded: ${key}`);
        totalImages++;
      } catch (e) {
        logError(`  Main image failed: ${e instanceof Error ? e.message : e}`);
        totalErrors++;
      }
    }

    // Insert rows into Supabase — 1 row per color × weight
    let insertedForProduct = 0;
    for (const spec of product.specRows) {
      try {
        const exists = await lureExists(product.slug, spec.colorName, spec.weight);
        if (exists) {
          log(`  Skip existing: ${spec.colorName} / ${spec.weight ?? 'null'}g`);
          continue;
        }

        // Tax-inclusive price (x1.1, round)
        const taxIncPrice = spec.price > 0 ? Math.round(spec.price * 1.1) : null;

        await insertLure({
          manufacturer: MANUFACTURER,
          manufacturer_slug: MANUFACTURER_SLUG,
          name: product.name,
          slug: product.slug,
          type,
          color_name: spec.colorName,
          weight: spec.weight,
          length: spec.length,
          price: taxIncPrice,
          // jan_code not in schema; store JAN in color_description for reference
          color_description: spec.jan || null,
          images: mainR2Url ? [mainR2Url] : null,
          description: product.description || null,
          target_fish: targetFish.length > 0 ? targetFish : null,
          source_url: product.url,
          is_limited: false,
          is_discontinued: false,
        });
        insertedForProduct++;
      } catch (e) {
        logError(`  Insert failed (${spec.colorName} / ${spec.weight}g): ${e instanceof Error ? e.message : e}`);
        totalErrors++;
      }
    }

    totalInserted += insertedForProduct;
    log(`  Inserted ${insertedForProduct} rows (${product.specRows.length} color × weight)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.url,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `${product.specRows.length}行 = ${insertedForProduct}挿入`,
        });
      } catch (e) {
        logError(`  Airtable record failed: ${(e as Error).message}`);
      }
    }

    await sleep(300);
  }

  // 5) Update maker status
  log('\nUpdating maker status...');
  if (makerRecordId) {
    try {
      await airtableUpdateRecord(AIRTABLE_MAKER_TABLE_ID, makerRecordId, {
        'ステータス': '登録済み',
      });
    } catch (e) {
      logError(`Airtable maker update: ${e}`);
    }
  }

  // 6) Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`
========================================`);
  log(`${MANUFACTURER} Pipeline Summary`);
  log(`========================================`);
  log(`Products discovered: ${totalProducts}`);
  log(`Products scraped: ${totalScraped}`);
  log(`Products skipped (no data): ${totalSkipped}`);
  log(`Rows inserted: ${totalInserted}`);
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${totalErrors}`);
  log(`Elapsed: ${elapsed}s`);
  log(`========================================`);
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/crazy-ocean');
if (isDirectRun) {
  main().catch(e => {
    logError(`Fatal: ${e}`);
    process.exit(1);
  });
}
