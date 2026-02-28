// scripts/scrapers/ja-do.ts
// JADO PRODUCTS (邪道) scraper — WordPress + Elementor, single page, fetch-only
// All products on: https://ja-do.jp/products
// Toggle accordion panels (ha-toggle) contain product info
// Images use lazy loading (data-src), color names in figcaption
// JAN codes in elementor-heading-title, some with weight/size prefix
// Multi-variant products: 冷音 (weight), 冷斬 (weight), Envy (size), YoreYore (regular+mini)
// Prices are tax-inclusive (税込)

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
import type { ScraperFunction, ScrapedLure } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = '邪道';
const MANUFACTURER_SLUG = 'ja-do';
const SITE_BASE = 'https://ja-do.jp';
const PRODUCTS_URL = 'https://ja-do.jp/products';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Product definitions — hardcoded from the toggle tabs on /products
interface ProductDef {
  name: string;
  slug: string;
  type: string;
  targetFish: string[];
  tabId: string;        // ha-toggle__item-content ID suffix (e.g., "4871")
  // Multi-variant config
  variants?: VariantDef[];
}

interface VariantDef {
  name: string;         // Display name for this variant (e.g., "冷音 14g")
  slug: string;         // slug for this variant
  weight: number;
  length: number | null;
  price: number;        // tax-inclusive
  janPrefix: string;    // prefix in JAN line to match (e.g., "14g", "ミニ10g", "Envy95")
}

const PRODUCTS: ProductDef[] = [
  {
    name: '乱牙65',
    slug: 'ranga-65',
    type: 'バイブレーション',
    targetFish: ['シーバス'],
    tabId: '4871',
  },
  {
    name: '乱牙75',
    slug: 'ranga-75',
    type: 'バイブレーション',
    targetFish: ['シーバス'],
    tabId: '4872',
  },
  {
    name: 'ERDA零イノベーター',
    slug: 'erda-zero-innovator',
    type: 'ミノー',
    targetFish: ['シーバス'],
    tabId: '4873',
  },
  {
    name: 'ERDA零999',
    slug: 'erda-zero-999',
    type: 'ミノー',
    targetFish: ['シーバス'],
    tabId: '4874',
  },
  {
    name: 'ERDA GARURU 132F',
    slug: 'erda-garuru-132f',
    type: 'ミノー',
    targetFish: ['シーバス'],
    tabId: '4875',
  },
  {
    name: 'ERDA TEUFEL 125F',
    slug: 'erda-teufel-125f',
    type: 'ミノー',
    targetFish: ['シーバス'],
    tabId: '4876',
  },
  {
    name: 'ERDA86',
    slug: 'erda-86',
    type: 'ミノー',
    targetFish: ['シーバス'],
    tabId: '4877',
  },
  {
    name: '冷音',
    slug: 'rein',
    type: 'バイブレーション',
    targetFish: ['シーバス'],
    tabId: '4878',
    variants: [
      { name: '冷音 14g', slug: 'rein-14g', weight: 14, length: 62, price: 1375, janPrefix: '14g' },
      { name: '冷音 24g', slug: 'rein-24g', weight: 24, length: 77, price: 1375, janPrefix: '24g' },
      { name: '冷音 ミニ10g', slug: 'rein-mini-10g', weight: 10, length: null, price: 1375, janPrefix: 'ミニ' },
    ],
  },
  {
    name: '冷斬',
    slug: 'rezan',
    type: 'メタルジグ',
    targetFish: ['シーバス'],
    tabId: '4879',
    variants: [
      { name: '冷斬 2g', slug: 'rezan-2g', weight: 2, length: 15, price: 715, janPrefix: '2g' },
      { name: '冷斬 5g', slug: 'rezan-5g', weight: 5, length: 40, price: 704, janPrefix: '5g' },
      { name: '冷斬 10g', slug: 'rezan-10g', weight: 10, length: 50, price: 759, janPrefix: '10g' },
      { name: '冷斬 20g', slug: 'rezan-20g', weight: 20, length: 60, price: 869, janPrefix: '20g' },
      { name: '冷斬 30g', slug: 'rezan-30g', weight: 30, length: 70, price: 869, janPrefix: '30g' },
      { name: '冷斬 40g', slug: 'rezan-40g', weight: 40, length: 78, price: 869, janPrefix: '40g' },
    ],
  },
  {
    name: 'Envy',
    slug: 'envy',
    type: 'シンキングペンシル',
    targetFish: ['シーバス'],
    tabId: '48710',
    variants: [
      { name: 'Envy 95', slug: 'envy-95', weight: 9, length: 95, price: 1661, janPrefix: 'Envy95' },
      { name: 'Envy 105', slug: 'envy-105', weight: 11.1, length: 105, price: 1771, janPrefix: 'Envy105' },
      { name: 'Envy 125', slug: 'envy-125', weight: 15.7, length: 125, price: 1925, janPrefix: 'Envy125' },
    ],
  },
  {
    name: 'Yore Yore',
    slug: 'yore-yore',
    type: 'シンキングペンシル',
    targetFish: ['シーバス'],
    tabId: '48711',
    variants: [
      { name: 'Yore Yore', slug: 'yore-yore', weight: 17, length: 80, price: 1958, janPrefix: '' },
      { name: 'Yore Yore ミニ', slug: 'yore-yore-mini', weight: 13, length: 68, price: 1958, janPrefix: 'ミニ' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColorEntry {
  colorName: string;
  imageUrl: string | null;
  jans: { prefix: string; jan: string }[];  // e.g., [{prefix:"14g", jan:"..."}, {prefix:"24g", jan:"..."}]
}

interface ScrapedProduct {
  name: string;
  slug: string;
  type: string;
  targetFish: string[];
  description: string;
  colors: ColorEntry[];
  mainImageUrl: string | null;
  weight: number | null;
  length: number | null;
  price: number;        // tax-inclusive
  variants?: VariantDef[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [ja-do] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [ja-do] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.text();
}

function stripTags(html: string): string {
  return html
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

/**
 * Clean color name: strip "01：" or "H-01：" numbering prefix
 */
function cleanColorName(raw: string): string {
  let name = raw.trim();
  // Remove numbering prefix like "01：", "H-01：", "05：" etc.
  name = name.replace(/^[A-Za-z]*-?\d+[：:]/, '').trim();
  return name;
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
// HTML Parsing: Extract toggle panel HTML for each product
// ---------------------------------------------------------------------------

function extractPanelHtml(fullHtml: string, tabId: string): string {
  // Find the content div for this tab
  const contentId = `ha-toggle__item-content-${tabId}`;
  const startIdx = fullHtml.indexOf(`id="${contentId}"`);
  if (startIdx < 0) return '';

  // Find the next ha-toggle__item (start of next panel) or end of wrapper
  const searchFrom = startIdx;
  const nextPanelIdx = fullHtml.indexOf('class="ha-toggle__item"', searchFrom + 100);
  // Also look for the closing of the toggle wrapper
  const wrapperEndIdx = fullHtml.indexOf('</div><!-- .ha-toggle__wrapper -->', searchFrom);

  let endIdx: number;
  if (nextPanelIdx > 0 && (wrapperEndIdx < 0 || nextPanelIdx < wrapperEndIdx)) {
    endIdx = nextPanelIdx;
  } else if (wrapperEndIdx > 0) {
    endIdx = wrapperEndIdx;
  } else {
    // Fallback: grab a large chunk
    endIdx = Math.min(startIdx + 100000, fullHtml.length);
  }

  return fullHtml.substring(startIdx, endIdx);
}

// ---------------------------------------------------------------------------
// HTML Parsing: Extract specs from inline text
// ---------------------------------------------------------------------------

interface ParsedSpecs {
  weight: number | null;
  length: number | null;
  price: number;         // tax-inclusive
}

function parseSpecs(panelHtml: string): ParsedSpecs[] {
  const specs: ParsedSpecs[] = [];
  // Match patterns like: weight：14g　length：62mm　price：￥1,375 （税込）
  const specRegex = /weight[：:]\s*([\d.]+)\s*g.*?length[：:]\s*([\d.]+)\s*mm.*?price[：:]\s*[￥¥]\s*([\d,]+)/g;
  let m;
  while ((m = specRegex.exec(panelHtml)) !== null) {
    specs.push({
      weight: parseFloat(m[1]),
      length: parseFloat(m[2]),
      price: parseInt(m[3].replace(/,/g, ''), 10),
    });
  }
  return specs;
}

// For simple products (non-variant), also try to parse the separate spec fields
function parseSimpleSpecs(panelHtml: string): ParsedSpecs | null {
  // Try inline spec first
  const inlineSpecs = parseSpecs(panelHtml);
  if (inlineSpecs.length === 1) return inlineSpecs[0];

  // Try separate label/value pairs
  let weight: number | null = null;
  let length: number | null = null;
  let price = 0;

  // Weight: look for "weight" label followed by value in heading
  const weightMatch = panelHtml.match(/icon-list-text">weight<[\s\S]*?heading-title[^>]*>([\d.]+)\s*g/i);
  if (weightMatch) weight = parseFloat(weightMatch[1]);
  // Also check "14gクラス" pattern
  if (!weight) {
    const weightClassMatch = panelHtml.match(/heading-title[^>]*>([\d.]+)\s*g\s*クラス/);
    if (weightClassMatch) weight = parseFloat(weightClassMatch[1]);
  }

  // Length: look for "length" label followed by value
  const lengthMatch = panelHtml.match(/icon-list-text">length[\s　]*<[\s\S]*?heading-title[^>]*>([\d.]+)\s*mm/i);
  if (lengthMatch) length = parseFloat(lengthMatch[1]);

  // Price: look for ¥ in heading
  const priceMatch = panelHtml.match(/heading-title[^>]*>[¥￥]\s*([\d,]+)\s*.*?税込/);
  if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

  if (weight !== null || length !== null || price > 0) {
    return { weight, length, price };
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML Parsing: Extract colors with images and JAN codes
// ---------------------------------------------------------------------------

function parseColors(panelHtml: string): ColorEntry[] {
  const colors: ColorEntry[] = [];

  // Strategy: find each figure.wp-caption with figcaption and nearby JAN codes
  // The structure is: <figure class="wp-caption"> <img data-src="..."> <figcaption>01：JAPAN</figcaption> </figure>
  // followed by one or more JAN codes in elementor-heading-title elements

  // Split by column sections — each color is in an elementor-col-25 or similar column
  // Use a simpler approach: find all figcaption + JAN pairs

  // First, collect all figcaptions with their positions
  const figcaptionRegex = /<figcaption[^>]*class="widget-image-caption[^"]*"[^>]*>(.*?)<\/figcaption>/g;
  const figcaptions: { colorName: string; pos: number; imageUrl: string | null }[] = [];

  let fm;
  while ((fm = figcaptionRegex.exec(panelHtml)) !== null) {
    const rawName = stripTags(fm[1]);
    const colorName = cleanColorName(rawName);
    if (!colorName) continue;

    // Find the closest data-src before this figcaption
    const before = panelHtml.substring(Math.max(0, fm.index - 3000), fm.index);
    let imageUrl: string | null = null;
    // Get data-src from img tag (lazy loaded)
    const imgMatches = [...before.matchAll(/data-src="([^"]+\.(png|jpg|jpeg|webp))"/gi)];
    if (imgMatches.length > 0) {
      const lastImg = imgMatches[imgMatches.length - 1];
      imageUrl = lastImg[1];
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `${SITE_BASE}/${imageUrl}`;
      }
    }

    figcaptions.push({ colorName, pos: fm.index, imageUrl });
  }

  // Now collect all JAN code entries with their positions
  const janRegex = /<p[^>]*class="elementor-heading-title[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
  const janEntries: { text: string; pos: number }[] = [];

  let jm;
  while ((jm = janRegex.exec(panelHtml)) !== null) {
    const text = stripTags(jm[1]);
    if (text.includes('JAN')) {
      janEntries.push({ text, pos: jm.index });
    }
  }

  // Match figcaptions to their JAN codes
  // JAN codes appear after each figcaption, before the next figcaption
  for (let i = 0; i < figcaptions.length; i++) {
    const fc = figcaptions[i];
    const nextFcPos = i + 1 < figcaptions.length ? figcaptions[i + 1].pos : Infinity;

    // Find all JAN entries between this figcaption and the next one
    const relatedJans = janEntries.filter(j => j.pos > fc.pos && j.pos < nextFcPos);

    const jans: { prefix: string; jan: string }[] = [];
    for (const janEntry of relatedJans) {
      // Parse "14g／JAN：4996578669304" or "JAN：4996578676562" or "Envy95／JAN：4996578667157"
      // Also handle "ミニ／JAN：..." and "ミニ10g／JAN：..."
      const janMatch = janEntry.text.match(/^(.*?)[／/]?\s*JAN[：:]\s*(\d+)/);
      if (janMatch) {
        const prefix = janMatch[1].replace(/\s+/g, '').trim();
        const jan = janMatch[2].trim();
        jans.push({ prefix, jan });
      }
    }

    colors.push({
      colorName: fc.colorName,
      imageUrl: fc.imageUrl,
      jans,
    });
  }

  return colors;
}

// ---------------------------------------------------------------------------
// HTML Parsing: Extract description
// ---------------------------------------------------------------------------

function parseDescription(panelHtml: string): string {
  // Description is in text-editor widgets, usually the long paragraph
  const textMatches = [...panelHtml.matchAll(/elementor-widget-text-editor[\s\S]*?<\/span>/g)];
  let best = '';
  for (const tm of textMatches) {
    const text = stripTags(tm[0]);
    // Skip very short text, spec lines, and product names
    if (text.length > 50 && !text.includes('weight') && !text.includes('price') && !text.includes('対応フック')) {
      if (text.length > best.length) {
        best = text;
      }
    }
  }
  if (best.length > 500) best = best.substring(0, 500);
  return best;
}

// ---------------------------------------------------------------------------
// HTML Parsing: Extract main image
// ---------------------------------------------------------------------------

function parseMainImage(panelHtml: string): string | null {
  // Main product image — first large image with data-src (not color swatch)
  // The main image is typically the first/second img with large dimensions, before the color grid
  const imgMatches = [...panelHtml.matchAll(/data-src="([^"]+\.(jpg|jpeg|png|webp))"/gi)];
  for (const im of imgMatches) {
    const url = im[1];
    // Skip base64 placeholders and very small images
    if (url.startsWith('data:')) continue;
    // Return the first non-swatch image (usually the hero shot)
    return url.startsWith('http') ? url : `${SITE_BASE}/${url}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scrape one product from its panel HTML
// ---------------------------------------------------------------------------

function scrapeProduct(product: ProductDef, panelHtml: string): ScrapedProduct {
  const colors = parseColors(panelHtml);
  const description = parseDescription(panelHtml);
  const mainImageUrl = parseMainImage(panelHtml);

  let weight: number | null = null;
  let length: number | null = null;
  let price = 0;

  if (!product.variants) {
    const specs = parseSimpleSpecs(panelHtml);
    if (specs) {
      weight = specs.weight;
      length = specs.length;
      price = specs.price;
    }
  }

  return {
    name: product.name,
    slug: product.slug,
    type: product.type,
    targetFish: product.targetFish,
    description,
    colors,
    mainImageUrl,
    weight,
    length,
    price,
    variants: product.variants,
  };
}

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
  log(`JADO PRODUCTS Pipeline Start — ${PRODUCTS.length} products`);
  log('========================================');

  // --- Fetch the single products page ---
  log('Fetching products page...');
  const fullHtml = await fetchPage(PRODUCTS_URL);
  log(`Page fetched: ${(fullHtml.length / 1024).toFixed(0)} KB`);

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
  for (const product of PRODUCTS) {
    log(`\n--- ${product.name} (${product.slug}) ---`);

    try {
      const panelHtml = extractPanelHtml(fullHtml, product.tabId);
      if (!panelHtml) {
        logError(`  Panel not found for tabId=${product.tabId}`);
        errorCount++;
        continue;
      }
      log(`  Panel HTML: ${(panelHtml.length / 1024).toFixed(0)} KB`);

      const scraped = scrapeProduct(product, panelHtml);
      totalProducts++;

      if (scraped.colors.length === 0) {
        logError(`  No colors found`);
        errorCount++;
        continue;
      }

      log(`  Colors: ${scraped.colors.length}`);
      log(`  Color names: ${scraped.colors.map(c => c.colorName).join(', ')}`);

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
      const colorImageMap = new Map<string, string>(); // colorName -> R2 URL
      for (const color of scraped.colors) {
        if (!color.imageUrl) continue;
        try {
          const safeName = color.colorName
            .replace(/[^a-zA-Z0-9\u3000-\u9fff\u30a0-\u30ff\u3040-\u309fー～〜]/g, '-')
            .replace(/-+/g, '-')
            .toLowerCase();
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/${safeName}.webp`;
          const r2Url = await processAndUploadImage(color.imageUrl, key);
          colorImageMap.set(color.colorName, r2Url);
          totalImages++;
        } catch (err) {
          logError(`  Color image failed [${color.colorName}]: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Insert rows into Supabase
      let rowsForProduct = 0;

      if (scraped.variants && scraped.variants.length > 0) {
        // Multi-variant product: create rows per color x variant
        for (const color of scraped.colors) {
          for (const variant of scraped.variants) {
            // Match JAN code for this variant
            let jan = '';
            if (variant.janPrefix === '') {
              // YoreYore regular: JAN without prefix (just "JAN：...")
              const regularJan = color.jans.find(j => j.prefix === '');
              if (regularJan) jan = regularJan.jan;
            } else {
              // Find JAN matching this variant's prefix
              const matchingJan = color.jans.find(j => j.prefix.includes(variant.janPrefix));
              if (matchingJan) jan = matchingJan.jan;
            }

            // Skip if no matching JAN (variant not available for this color)
            // But for some products, not all variants have all colors
            // Still insert if we at least have the color
            if (!jan && color.jans.length > 0) {
              // This variant might not exist for this color — skip
              continue;
            }

            // Check if already exists
            if (await lureExists(variant.slug, color.colorName, variant.weight)) {
              log(`  Skip (exists): ${variant.name} / ${color.colorName}`);
              continue;
            }

            const imageUrl = colorImageMap.get(color.colorName) || mainR2Url;

            await insertLure({
              name: variant.name,
              slug: variant.slug,
              manufacturer: MANUFACTURER,
              manufacturer_slug: MANUFACTURER_SLUG,
              type: scraped.type,
              price: variant.price,
              description: scraped.description || null,
              images: imageUrl ? [imageUrl] : null,
              official_video_url: null,
              target_fish: scraped.targetFish,
              length: variant.length,
              weight: variant.weight,
              color_name: color.colorName,
              color_description: null,
              release_year: null,
              is_limited: false,
              diving_depth: null,
              action_type: null,
              source_url: PRODUCTS_URL,
              is_discontinued: false,
            });

            rowsForProduct++;
            totalRows++;
          }
        }
      } else {
        // Simple product: one row per color
        for (const color of scraped.colors) {
          if (await lureExists(scraped.slug, color.colorName, scraped.weight)) {
            log(`  Skip (exists): ${color.colorName}`);
            continue;
          }

          const imageUrl = colorImageMap.get(color.colorName) || mainR2Url;

          await insertLure({
            name: scraped.name,
            slug: scraped.slug,
            manufacturer: MANUFACTURER,
            manufacturer_slug: MANUFACTURER_SLUG,
            type: scraped.type,
            price: scraped.price,
            description: scraped.description || null,
            images: imageUrl ? [imageUrl] : null,
            official_video_url: null,
            target_fish: scraped.targetFish,
            length: scraped.length,
            weight: scraped.weight,
            color_name: color.colorName,
            color_description: null,
            release_year: null,
            is_limited: false,
            diving_depth: null,
            action_type: null,
            source_url: PRODUCTS_URL,
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
          const variantCount = scraped.variants ? scraped.variants.length : 1;
          await createAirtableLureRecord(
            scraped.name, PRODUCTS_URL, makerRecordId, '登録完了',
            `${scraped.colors.length}色 × ${variantCount}バリアント = ${rowsForProduct}行`,
          );
        } catch (err) {
          logError(`  Airtable lure record failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      await sleep(300); // Polite delay between image uploads
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
  log('JADO PRODUCTS Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}/${PRODUCTS.length}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// ---------------------------------------------------------------------------
// Modular ScraperFunction export
// ---------------------------------------------------------------------------

export const scrapeJaDoPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  // ja-do has all products on a single page; URL may include a fragment #tabId
  const urlObj = new URL(url);
  const fragment = urlObj.hash ? urlObj.hash.replace('#', '') : '';
  const pageUrl = urlObj.origin + urlObj.pathname;

  const fullHtml = await fetchPage(pageUrl);

  // Find the matching product definition by tabId (from fragment) or URL search param
  let matchedProduct: typeof PRODUCTS[number] | undefined;
  if (fragment) {
    matchedProduct = PRODUCTS.find(p => p.tabId === fragment);
  }
  // If no fragment match, try the first product as fallback
  if (!matchedProduct) {
    matchedProduct = PRODUCTS[0];
  }

  const panelHtml = extractPanelHtml(fullHtml, matchedProduct.tabId);
  if (!panelHtml) {
    throw new Error(`[ja-do] Panel not found for tabId=${matchedProduct.tabId}`);
  }

  const scraped = scrapeProduct(matchedProduct, panelHtml);

  // Build colors in ScrapedLure format
  const colors = scraped.colors.map(c => ({
    name: c.colorName,
    imageUrl: c.imageUrl || '',
  }));

  // Determine weight/length/price
  let weight: number | null = scraped.weight;
  let length: number | null = scraped.length;
  let price = scraped.price;
  const weights: number[] = [];

  if (scraped.variants && scraped.variants.length > 0) {
    for (const v of scraped.variants) {
      if (!weights.includes(v.weight)) weights.push(v.weight);
    }
    weight = scraped.variants[0].weight;
    length = scraped.variants[0].length;
    price = scraped.variants[0].price;
  } else if (weight !== null) {
    weights.push(weight);
  }

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
};

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/ja-do');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
