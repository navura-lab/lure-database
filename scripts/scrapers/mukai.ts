// scripts/scrapers/mukai.ts
// MUKAI (ムカイフィッシング) scraper — WordPress REST API
// Products fetched via /wp-json/wp/v2/posts?categories=4
// Content is server-rendered HTML with color/spec tables

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

const MANUFACTURER = 'MUKAI';
const MANUFACTURER_SLUG = 'mukai';
const SITE_BASE = 'https://www.mukai-fishing.jp';
const API_BASE = `${SITE_BASE}/wp-json/wp/v2`;
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Category ID → lure type mapping
const CATEGORY_TYPE_MAP: Record<number, string> = {
  64: 'エリアクランク',
  67: 'エリアスプーン',
  68: 'エリアミノー',
  65: 'エリアトップウォーター',
  66: 'エリアバイブレーション',
  69: 'フェザージグ',
  70: 'ワイヤーベイト',
  71: 'ネイティブミノー',
};

// Posts to skip (announcements, duplicates, sets without individual product data)
const SKIP_POST_IDS = new Set([
  2750, // スパイラル塗装 (painting technique announcement)
  2651, // STEP STICK & ZANMU IDO F 広告 (ad)
  2443, // 限定企画 POGO/Smash（F）ブランク (blank body set)
  2240, // MUKAI 渓流セレクション (set)
  2061, // クランクスターター3個セット (3-piece set)
  1849, // Smash&LISM Competition model (listing, no colors)
  318,  // 2021釣り人応援企画 限定ルアーセット
  264,  // ウマイ!! ブランド鱒シリーズ
  203,  // 最強ムカイFSクリアーシリーズ (listing overview)
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WPPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  link: string;
  slug: string;
  categories: number[];
}

interface ColorVariant {
  name: string;
  imageUrl: string;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  type: string;
  description: string;
  weight: number | null;
  length: number | null;
  price: number;
  colors: ColorVariant[];
  mainImageUrl: string | null;
  weights: number[];  // for multi-weight products (e.g., LOOPER)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [mukai] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [mukai] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#038;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#8221;/g, '"').replace(/&#8220;/g, '"').replace(/&nbsp;/g, ' ')
    .trim();
}

function fullWidthToHalf(s: string): string {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/ｍ/g, 'm').replace(/ｇ/g, 'g').replace(/ｓ/g, 's')
    .replace(/（/g, '(').replace(/）/g, ')').replace(/　/g, ' ')
    .replace(/￥/g, '¥');
}

function generateSlug(title: string, postId: number): string {
  // Convert full-width to half-width
  let s = fullWidthToHalf(title);
  // Keep only ASCII letters, digits, spaces, hyphens
  s = s.replace(/[^\x20-\x7E]/g, '');
  // Replace non-alphanum with hyphens
  s = s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  // If slug is too short (all Japanese), use post ID
  if (s.length < 3) return `mukai-${postId}`;
  return s;
}

function getLureType(categories: number[]): string {
  for (const catId of categories) {
    if (CATEGORY_TYPE_MAP[catId]) return CATEGORY_TYPE_MAP[catId];
  }
  return 'トラウトルアー';
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
  if (!res.ok) logError(`Airtable record failed: ${await res.text().catch(() => res.statusText)}`);
}

// ---------------------------------------------------------------------------
// WP REST API fetch
// ---------------------------------------------------------------------------

async function fetchAllPosts(): Promise<WPPost[]> {
  const all: WPPost[] = [];
  for (let page = 1; page <= 5; page++) {
    const url = `${API_BASE}/posts?categories=4&per_page=100&page=${page}&_fields=id,title,content,link,slug,categories`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!res.ok) {
      if (res.status === 400) break; // No more pages
      throw new Error(`WP API error: ${res.status}`);
    }
    const posts = await res.json() as WPPost[];
    all.push(...posts);
    log(`  Fetched page ${page}: ${posts.length} posts`);
    if (posts.length < 100) break;
    await sleep(500);
  }
  return all;
}

// ---------------------------------------------------------------------------
// HTML parsing: spec extraction
// ---------------------------------------------------------------------------

function extractSpecs(html: string): { weight: number | null; length: number | null; price: number; weights: number[] } {
  const norm = fullWidthToHalf(html);
  let weight: number | null = null;
  let length: number | null = null;
  let price = 0;
  const weights: number[] = [];

  // Pattern 1: SPEC section — "Weight：2.3g" / "Length：30mm"
  const weightMatch = norm.match(/Weight[：:]\s*([\d.]+)\s*g/i);
  if (weightMatch) weight = parseFloat(weightMatch[1]);

  const lengthMatch = norm.match(/Length[：:]\s*(\d+)\s*mm/i);
  if (lengthMatch) length = parseInt(lengthMatch[1], 10);

  // Pattern 2: Inline — "全長55mm ウェイト3.5g"
  if (!weight) {
    const inlineW = fullWidthToHalf(html).match(/(?:ウェイト|Weight|weight)\s*([\d.]+)\s*g/);
    if (inlineW) weight = parseFloat(inlineW[1]);
  }
  if (!length) {
    const inlineL = fullWidthToHalf(html).match(/(?:全長|Length|length)\s*(\d+)\s*mm/);
    if (inlineL) length = parseInt(inlineL[1], 10);
  }

  // Pattern 3: Title-embedded weight — "2.3g" or "2.3ｇ"
  if (!weight) {
    const titleW = norm.match(/(\d+\.?\d*)\s*g(?:\s|$|<)/i);
    if (titleW) weight = parseFloat(titleW[1]);
  }

  // Price: "定価XXX円" or "￥XXX-"
  const priceMatch = norm.match(/(?:定価|￥|¥)\s*([\d,]+)\s*(?:円|-)/);
  if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

  // Multi-weight: detect weight columns in table header row
  // e.g., <td><strong>1.7g</strong></td><td><strong>2.1g</strong></td>
  const tableHeaderWeights = [...norm.matchAll(/<td[^>]*>\s*<strong>\s*([\d.]+)\s*g\s*<\/strong>\s*<\/td>/gi)];
  if (tableHeaderWeights.length >= 2) {
    for (const m of tableHeaderWeights) {
      const w = parseFloat(m[1]);
      if (w > 0 && !weights.includes(w)) weights.push(w);
    }
    // For multi-weight products, don't set single weight
    weight = null;
  }

  return { weight, length, price, weights };
}

// ---------------------------------------------------------------------------
// HTML parsing: table → colors
// ---------------------------------------------------------------------------

function extractColorsFromTable(html: string): ColorVariant[] {
  const colors: ColorVariant[] = [];

  // Find all tables
  const tableMatches = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];
  if (tableMatches.length === 0) return colors;

  // Use the last table (sometimes first table is a spec table)
  const tableHtml = tableMatches[tableMatches.length - 1][0];

  // Extract all rows
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length < 2) return colors;

  // Detect table type from first row (header)
  const firstRow = rows[0][1];
  const firstCells = [...firstRow.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => stripTags(m[1]));

  // Detect column layout
  const hasImageCol = firstCells.length >= 4 && (firstCells[0] === '' || firstCells[0] === '　');
  const colorColHeader = firstCells.findIndex(c =>
    /カラー|color/i.test(c) || c === 'カラー名称'
  );

  // Detect multi-weight header (e.g., header row with weight columns)
  const isMultiWeight = firstCells.some(c => /^\d+\.?\d*\s*g$/i.test(fullWidthToHalf(c)));

  // For multi-weight tables, skip the first 2 header rows
  const dataStartIdx = isMultiWeight ? 2 : 1;

  // Determine which column has color names
  let colorCol = -1;
  if (colorColHeader >= 0) {
    colorCol = colorColHeader;
  } else if (hasImageCol) {
    colorCol = 2; // [img, no, color, price, JAN]
  } else if (firstCells.length >= 3) {
    colorCol = 1; // [no, color, JAN]
  } else if (firstCells.length === 2) {
    colorCol = 0; // [color, JAN]
  }

  if (colorCol < 0) return colors;

  for (let i = dataStartIdx; i < rows.length; i++) {
    const rowHtml = rows[i][1];
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length <= colorCol) continue;

    // Check for colspan (skip price/info rows)
    if (/colspan/i.test(rowHtml) && cells.length < 3) continue;

    // Extract color name
    const colorName = fullWidthToHalf(stripTags(cells[colorCol][1]))
      .replace(/\s+/g, ' ').trim();
    if (!colorName || colorName.length < 1) continue;
    // Skip header-like rows
    if (/^(カラー|No|規格|定番|定価|JAN|color)/i.test(colorName)) continue;
    // Skip rows that look like price info
    if (/^[¥￥\d,]+$/.test(colorName)) continue;

    // Extract image URL (if present in first column when hasImageCol)
    let imageUrl = '';
    if (hasImageCol && cells.length > 0) {
      const imgMatch = cells[0][1].match(/src="([^"]+)"/);
      if (imgMatch) {
        imageUrl = imgMatch[1];
        // Fix domain typo: mukai-finshing → mukai-fishing
        imageUrl = imageUrl.replace('mukai-finshing.jp', 'mukai-fishing.jp');
      }
    }

    // Extract price from price column (if available)
    // (price already extracted globally, but per-color price could differ)

    colors.push({ name: colorName, imageUrl });
  }

  return colors;
}

// ---------------------------------------------------------------------------
// HTML parsing: main image
// ---------------------------------------------------------------------------

function extractMainImage(html: string): string | null {
  // First <img> in content (before table)
  const tableIdx = html.indexOf('<table');
  const searchArea = tableIdx > 0 ? html.substring(0, tableIdx) : html;
  const imgMatch = searchArea.match(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*(?:aligncenter|wp-post-image)[^"]*"/);
  if (imgMatch) {
    return imgMatch[1].replace('mukai-finshing.jp', 'mukai-fishing.jp');
  }
  // Fallback: first img in content
  const firstImg = searchArea.match(/<img[^>]+src="([^"]+)"/);
  if (firstImg) {
    return firstImg[1].replace('mukai-finshing.jp', 'mukai-fishing.jp');
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML parsing: description
// ---------------------------------------------------------------------------

function extractDescription(html: string): string {
  // Get text from <p> elements before SPEC or table
  const specIdx = html.search(/<h3[^>]*>.*?SPEC/i);
  const tableIdx = html.indexOf('<table');
  const endIdx = Math.min(
    specIdx > 0 ? specIdx : Infinity,
    tableIdx > 0 ? tableIdx : Infinity,
  );
  const area = html.substring(0, endIdx === Infinity ? 500 : endIdx);
  const paragraphs = [...area.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripTags(m[1]).trim())
    .filter(t => t.length > 10 && !/<img/.test(t));

  return paragraphs.join(' ').substring(0, 300);
}

// ---------------------------------------------------------------------------
// Scrape a single WP post
// ---------------------------------------------------------------------------

function scrapePost(post: WPPost): ScrapedProduct | null {
  const html = post.content.rendered;
  if (!html || html.length < 100) return null;

  // Must have a table
  if (!/<table/i.test(html)) return null;

  const name = stripTags(post.title.rendered).trim();
  if (!name) return null;

  const slug = generateSlug(name, post.id);
  const type = getLureType(post.categories);
  const description = extractDescription(html);
  const { weight, length, price, weights } = extractSpecs(html);
  const colors = extractColorsFromTable(html);
  const mainImageUrl = extractMainImage(html);

  if (colors.length === 0) {
    return null; // No colors = not a real product page
  }

  return {
    name,
    slug,
    url: post.link,
    type,
    description,
    weight,
    length,
    price,
    colors,
    mainImageUrl,
    weights,
  };
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction — fetches a single product page by URL
// ---------------------------------------------------------------------------

export const scrapeMukaiPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // Try to extract post slug or ID from the URL
  // URLs like: https://www.mukai-fishing.jp/xxxx/ or https://www.mukai-fishing.jp/?p=1234
  const postIdMatch = url.match(/[?&]p=(\d+)/);
  let apiPost: WPPost | null = null;

  if (postIdMatch) {
    // Fetch via WP REST API using post ID
    const apiUrl = `${API_BASE}/posts/${postIdMatch[1]}?_fields=id,title,content,link,slug,categories`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (res.ok) {
      apiPost = await res.json() as WPPost;
    }
  }

  if (!apiPost) {
    // Try slug-based API lookup
    // Extract slug from URL: https://www.mukai-fishing.jp/SLUG/ or /archives/1234
    const pathMatch = url.match(/mukai-fishing\.jp\/([^/?#]+)\/?$/);
    if (pathMatch && pathMatch[1] !== 'archives') {
      const apiUrl = `${API_BASE}/posts?slug=${encodeURIComponent(pathMatch[1])}&_fields=id,title,content,link,slug,categories`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (res.ok) {
        const posts = await res.json() as WPPost[];
        if (posts.length > 0) apiPost = posts[0];
      }
    }
  }

  if (!apiPost) {
    // Fallback: fetch HTML page directly and parse
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const fullHtml = await res.text();

    // Extract title
    const titleMatch = fullHtml.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
      || fullHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const name = titleMatch ? stripTags(titleMatch[1]).replace(/\s*[|–—].*$/, '').trim() : 'Unknown';

    // Extract content area
    const contentMatch = fullHtml.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<nav|<div[^>]*class="[^"]*(?:post-share|entry-footer))/i)
      || fullHtml.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*)/i);
    const contentHtml = contentMatch ? contentMatch[1] : fullHtml;

    // Try to extract post ID from page for slug generation
    const pageIdMatch = fullHtml.match(/class="[^"]*post-(\d+)[^"]*"/);
    const postId = pageIdMatch ? parseInt(pageIdMatch[1]) : 0;

    const slug = generateSlug(name, postId);
    const description = extractDescription(contentHtml);
    const { weight, length, price, weights } = extractSpecs(contentHtml);
    const colors = extractColorsFromTable(contentHtml);
    const mainImageUrl = extractMainImage(contentHtml);

    const typedColors: ScrapedColorType[] = colors.map(c => ({
      name: c.name,
      imageUrl: c.imageUrl || '',
    }));

    return {
      name,
      name_kana: '',
      slug,
      manufacturer: MANUFACTURER,
      manufacturer_slug: MANUFACTURER_SLUG,
      type: 'トラウトルアー',
      target_fish: ['トラウト'],
      description,
      price: price || 0,
      colors: typedColors,
      weights: weights.length > 0 ? weights : (weight ? [weight] : []),
      length,
      mainImage: mainImageUrl || '',
      sourceUrl: url,
    };
  }

  // We have API data — use existing scrapePost logic
  const product = scrapePost(apiPost);
  if (!product) {
    throw new Error(`Could not parse product from API data for ${url}`);
  }

  const typedColors: ScrapedColorType[] = product.colors.map(c => ({
    name: c.name,
    imageUrl: c.imageUrl || '',
  }));

  const weights = product.weights.length > 0
    ? product.weights
    : (product.weight ? [product.weight] : []);

  return {
    name: product.name,
    name_kana: '',
    slug: product.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: product.type,
    target_fish: ['トラウト'],
    description: product.description,
    price: product.price || 0,
    colors: typedColors,
    weights,
    length: product.length,
    mainImage: product.mainImageUrl || '',
    sourceUrl: url,
  };
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  let totalPosts = 0;
  let totalScraped = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  let totalImages = 0;
  let totalErrors = 0;

  log(`Starting MUKAI scraper`);

  // 1) Register maker in Airtable
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

  // 2) Fetch all posts via WP REST API
  log('\nFetching posts from WP REST API...');
  const allPosts = await fetchAllPosts();
  totalPosts = allPosts.length;
  log(`Total posts fetched: ${totalPosts}`);

  // 3) Process each post
  for (let i = 0; i < allPosts.length; i++) {
    const post = allPosts[i];
    const titleClean = stripTags(post.title.rendered).substring(0, 40);
    log(`\n--- [${i + 1}/${allPosts.length}] #${post.id} ${titleClean} ---`);

    if (SKIP_POST_IDS.has(post.id)) {
      log('  Skipped (in skip list)');
      totalSkipped++;
      continue;
    }

    let product: ScrapedProduct | null = null;
    try {
      product = scrapePost(post);
    } catch (e) {
      logError(`Parse failed: ${e}`);
      totalErrors++;
      continue;
    }

    if (!product) {
      log('  Skipped (no table or no colors)');
      totalSkipped++;
      continue;
    }

    log(`  Name: ${product.name}`);
    log(`  Slug: ${product.slug}`);
    log(`  Type: ${product.type}`);
    log(`  Weight: ${product.weight}g, Length: ${product.length}mm, Price: ${product.price}`);
    if (product.weights.length > 0) {
      log(`  Multi-weight: ${product.weights.join(', ')}g`);
    }
    log(`  Colors: ${product.colors.length}`);
    if (product.colors.length > 0) {
      log(`    Names: ${product.colors.slice(0, 5).map(c => c.name).join(', ')}${product.colors.length > 5 ? '...' : ''}`);
    }
    log(`  Main image: ${product.mainImageUrl ? 'yes' : 'no'}`);

    // Build weight list
    const effectiveWeights: (number | null)[] = product.weights.length > 0
      ? product.weights
      : [product.weight];

    // Upload color images
    const imageUrls: Map<string, string> = new Map();
    for (let c = 0; c < product.colors.length; c++) {
      const color = product.colors[c];
      if (!color.imageUrl) continue;
      try {
        const r2Key = `${MANUFACTURER_SLUG}/${product.slug}/${c}.webp`;
        const publicUrl = await processAndUploadImage(color.imageUrl, r2Key);
        imageUrls.set(color.name, publicUrl);
        totalImages++;
      } catch (e) {
        logError(`  Image failed (${color.name}): ${e}`);
        totalErrors++;
      }
    }

    // If no color images but have main image, upload it
    if (imageUrls.size === 0 && product.mainImageUrl) {
      try {
        const r2Key = `${MANUFACTURER_SLUG}/${product.slug}/main.webp`;
        const publicUrl = await processAndUploadImage(product.mainImageUrl, r2Key);
        imageUrls.set('__main__', publicUrl);
        totalImages++;
      } catch (e) {
        logError(`  Main image failed: ${e}`);
        totalErrors++;
      }
    }

    // Insert rows: color × weight
    let insertedForProduct = 0;
    for (const color of product.colors) {
      const r2Url = imageUrls.get(color.name) || imageUrls.get('__main__') || '';

      for (const w of effectiveWeights) {
        try {
          const exists = await lureExists(product.slug, color.name, w);
          if (exists) continue;

          await insertLure({
            manufacturer: MANUFACTURER,
            manufacturer_slug: MANUFACTURER_SLUG,
            name: product.name,
            slug: product.slug,
            type: product.type,
            color_name: color.name,
            weight: w,
            length: product.length,
            price: product.price || null,
            images: r2Url ? [r2Url] : null,
            description: product.description || null,
            target_fish: ['トラウト'],
            is_limited: false,
            is_discontinued: false,
          });
          insertedForProduct++;
        } catch (e) {
          logError(`  Insert failed (${color.name}/${w}g): ${e}`);
          totalErrors++;
        }
      }
    }

    totalInserted += insertedForProduct;
    totalScraped++;
    log(`  Inserted ${insertedForProduct} rows (${product.colors.length}色 x ${effectiveWeights.length}ウェイト)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.url,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `${product.colors.length}色 x ${effectiveWeights.length}ウェイト = ${insertedForProduct}行`,
        });
      } catch (e) {
        logError(`  Airtable record failed: ${(e as Error).message}`);
      }
    }

    await sleep(300); // Light delay — API already fetched, just inserting
  }

  // 4) Update maker status
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

  // 5) Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`
========================================`);
  log(`${MANUFACTURER} Pipeline Summary`);
  log(`========================================`);
  log(`Posts fetched: ${totalPosts}`);
  log(`Products scraped: ${totalScraped}`);
  log(`Products skipped: ${totalSkipped}`);
  log(`Rows inserted: ${totalInserted}`);
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${totalErrors}`);
  log(`Elapsed: ${elapsed}s`);
  log(`========================================`);
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/mukai');
if (isDirectRun) {
  main().catch(e => {
    logError(`Fatal: ${e}`);
    process.exit(1);
  });
}
