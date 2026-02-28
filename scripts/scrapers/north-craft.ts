// scripts/scrapers/north-craft.ts
// North Craft scraper — rapala.co.jp static HTML (BiND CMS)
// fetch-only, no Playwright needed
// Auto-discovers products from top page → new products picked up on re-run

import type { ScraperFunction, ScrapedLure } from './types.js';
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUFACTURER = 'North Craft';
const MANUFACTURER_SLUG = 'north-craft';
const SITE_BASE = 'https://rapala.co.jp';
const TOP_PAGE = `${SITE_BASE}/cn10/nrothcraft_top.html`; // note: typo in real URL
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelSpec {
  model: string;      // e.g. "AOG70SLM"
  length: number;     // mm
  weight: number;     // grams
  shopUrl: string;    // e-shop URL
  price: number;      // yen (tax-included)
}

interface ColorVariant {
  code: string;       // e.g. "CHCD"
  imageUrl: string;   // full-size image URL
  models: string[];   // e.g. ["70SLM", "85SLM"]
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  description: string;
  specs: ModelSpec[];
  colors: ColorVariant[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [north-craft] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [north-craft] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Simple HTML parser helpers (no DOM library needed for this simple structure)
function extractAll(html: string, regex: RegExp): RegExpMatchArray[] {
  const results: RegExpMatchArray[] = [];
  let m: RegExpMatchArray | null;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LureDB/1.0)' },
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
  let q = `slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
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

async function airtableFetch<T>(tableId: string, path: string = '', options: RequestInit = {}): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function findMakerRecordId(): Promise<string> {
  const filter = encodeURIComponent(`{Slug}='${MANUFACTURER_SLUG}'`);
  const data = await airtableFetch<{ records: { id: string }[] }>(
    AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&maxRecords=1`,
  );
  if (data.records.length === 0) throw new Error(`Maker not found: ${MANUFACTURER_SLUG}`);
  return data.records[0].id;
}

async function airtableLureExists(url: string): Promise<boolean> {
  const filter = encodeURIComponent(`{URL}='${url}'`);
  const data = await airtableFetch<{ records: unknown[] }>(
    AIRTABLE_LURE_URL_TABLE_ID, `?filterByFormula=${filter}&maxRecords=1`,
  );
  return data.records.length > 0;
}

async function createAirtableLureRecord(
  lureName: string, url: string, makerRecordId: string, status: string, note: string,
): Promise<void> {
  await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, '', {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: {
      'ルアー名': lureName, 'URL': url, 'メーカー': [makerRecordId], 'ステータス': status, '備考': note,
    }}] }),
  });
}

// ---------------------------------------------------------------------------
// Step 1: Discover product links from top page
// ---------------------------------------------------------------------------

async function discoverProductLinks(): Promise<{ name: string; url: string }[]> {
  log(`Fetching top page: ${TOP_PAGE}`);
  const html = await fetchPage(TOP_PAGE);

  // Find the LURE section: links within album blocks before the CAP section
  // Pattern: <a ... href="xxx.html" ...> within the lure section
  // The lure section is between id="northcraft_lure" and id="northcraft_cap"
  const lureSection = html.split(/id\s*=\s*["']northcraft_cap["']/i)[0]
    .split(/id\s*=\s*["']northcraft_lure["']/i)[1] || '';

  const products: { name: string; url: string }[] = [];
  // Match album links: href="xxx.html" where xxx is not nrothcraft_top or nc_
  const linkMatches = extractAll(lureSection, /href\s*=\s*["']([^"']+\.html)["']/i);

  const seen = new Set<string>();
  for (const m of linkMatches) {
    const href = m[1];
    if (href.includes('nrothcraft_top') || href.includes('nc_') || href.includes('javascript') || href.includes('index.html')) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    // Resolve relative URL: handle "../cn10/aog.html" or "aog.html"
    let fullUrl: string;
    if (href.startsWith('http')) fullUrl = href;
    else {
      const clean = href.replace(/^\.\.\/cn10\//, '').replace(/^\.\.\//, '').replace(/^cn10\//, '');
      fullUrl = `${SITE_BASE}/cn10/${clean}`;
    }
    // Extract name from surrounding context (look for text after the link in same block)
    const nameMatch = lureSection.match(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*<[^>]*>[^<]*<img[^>]*>[\\s\\S]*?<h\\d[^>]*>([^<]+)`, 'i'));
    const name = nameMatch ? stripTags(nameMatch[1]) : href.replace('.html', '').toUpperCase();

    products.push({ name, url: fullUrl });
  }

  log(`Discovered ${products.length} product link(s)`);
  return products;
}

// ---------------------------------------------------------------------------
// Step 2: Scrape a product page
// ---------------------------------------------------------------------------

async function scrapeProductPage(url: string): Promise<ScrapedProduct> {
  log(`Fetching product page: ${url}`);
  const html = await fetchPage(url);

  // Extract product name from <title> or h2.c-title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const h2Match = html.match(/<h2[^>]*class="[^"]*c-title[^"]*"[^>]*>([^<]+)<\/h2>/i);
  const rawName = h2Match ? stripTags(h2Match[1]) : (titleMatch ? stripTags(titleMatch[1]).split('|')[0].trim() : 'Unknown');
  const name = rawName;

  // Slug from URL
  const slug = url.split('/').pop()?.replace('.html', '') || 'unknown';

  // Description: first c-body c-left paragraph (PC version = not in is-pc-hide)
  const descMatch = html.match(/<div[^>]*class="[^"]*c-body[^"]*c-left[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const description = descMatch ? stripTags(descMatch[1]).substring(0, 1000) : '';

  // Spec table: find rows with model, length, weight
  // Pattern: <td>AOGxxSLM</td><td>xxmm</td><td>xxg</td><td><a href="shop_url">...</a></td>
  const specs: ModelSpec[] = [];
  const tableRows = extractAll(html, /<tr[^>]*>([\s\S]*?)<\/tr>/i);
  for (const row of tableRows) {
    const cells = extractAll(row[1], /<td[^>]*>([\s\S]*?)<\/td>/i);
    if (cells.length < 3) continue;

    const cell0 = stripTags(cells[0][1]);
    const cell1 = stripTags(cells[1][1]);
    const cell2 = stripTags(cells[2][1]);

    // Check if this looks like a spec row (Model, Length in mm, Weight in g)
    const lengthMatch = cell1.match(/(\d+)\s*mm/i);
    const weightMatch = cell2.match(/(\d+(?:\.\d+)?)\s*g/i);
    if (!lengthMatch || !weightMatch) continue;
    if (cell0.toLowerCase().includes('model')) continue; // header row

    // Shop URL from 4th cell if present
    let shopUrl = '';
    let price = 0;
    if (cells.length >= 4) {
      const linkMatch = cells[3][1].match(/href\s*=\s*["']([^"']+)["']/i);
      if (linkMatch) shopUrl = linkMatch[1];
    }

    specs.push({
      model: cell0.trim(),
      length: parseInt(lengthMatch[1]),
      weight: parseFloat(weightMatch[1]),
      shopUrl,
      price,
    });
  }

  // Deduplicate specs (PC and mobile duplicate)
  const uniqueSpecs: ModelSpec[] = [];
  const seenModels = new Set<string>();
  for (const spec of specs) {
    if (seenModels.has(spec.model)) continue;
    seenModels.add(spec.model);
    uniqueSpecs.push(spec);
  }

  log(`  Found ${uniqueSpecs.length} model specs: ${uniqueSpecs.map(s => `${s.model}(${s.length}mm/${s.weight}g)`).join(', ')}`);

  // Color variants: BiND CMS structure
  // Pattern: <a href="fullsize.jpg"><picture><img src="thumb.jpg"></picture></a>
  //   ... <h4 class="c-small_headline">CODE</h4> <div class="c-body">models</div>
  // Also: <p class="js-photo_mouseover">CODE<br>Japanese Name</p> for full names
  const colors: ColorVariant[] = [];
  const seenColors = new Set<string>();

  // Strategy: find all <h4> with c-small_headline that contain short color codes,
  // then look backwards for the nearest <a href="...jpg"> (full-size image link),
  // and forwards for model applicability in <div class="c-body">

  // First, collect mouseover texts for Japanese color names
  const jpNames = new Map<string, string>(); // code -> Japanese name
  const mouseoverMatches = extractAll(html, /<p[^>]*js-photo_mouseover[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of mouseoverMatches) {
    const parts = m[1].replace(/<br\s*\/?>/gi, '\n').split('\n').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      jpNames.set(parts[0], parts.slice(1).join(''));
    }
  }

  // Find all color image links: <a href="../_src/NNNN/aog_xxx.jpg...">
  const imgLinks = extractAll(html, /<a[^>]*href="([^"]*\/_src\/\d+\/aog[^"]*\.jpg[^"]*)"[^>]*>/gi);

  // Find all small_headline entries (color codes)
  const headlineMatches = extractAll(html, /<h4[^>]*c-small_headline[^>]*>([^<]+)<\/h4>/gi);

  // Find all c-body entries after color codes (model applicability)
  const bodyMatches = extractAll(html, /<h4[^>]*c-small_headline[^>]*>[^<]+<\/h4>\s*<div[^>]*c-body[^>]*>([^<]*)<\/div>/gi);

  // BiND album blocks pair images and headlines sequentially within each column
  // Parse color blocks by finding column containers
  const columnPattern = /<div[^>]*class="[^"]*column\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*column\b|<\/div>\s*<\/div>\s*<\/div>)/gi;
  const columns = extractAll(html, columnPattern);

  for (const col of columns) {
    const block = col[1];
    // Extract image link (full-size from <a href>)
    const imgMatch = block.match(/<a[^>]*href="([^"]*\/_src\/\d+\/aog[^"]*\.jpg[^"]*)"[^>]*>/i);
    // Extract color code from h4
    const codeMatch = block.match(/<h4[^>]*c-small_headline[^>]*>\s*([^<]+?)\s*<\/h4>/i);
    // Extract model applicability from c-body after headline
    const modelMatch = block.match(/<h4[^>]*c-small_headline[^>]*>[^<]*<\/h4>\s*<div[^>]*c-body[^>]*>\s*([^<]*?)\s*<\/div>/i);

    if (!codeMatch) continue;
    const code = codeMatch[1].trim();
    // Skip non-color entries (titles, descriptions, etc.)
    if (code.length > 15 || code.includes('AIR') || code.includes('ランカー') || code.includes('エアー')) continue;

    const modelText = modelMatch ? modelMatch[1].trim() : '';
    const key = `${code}|${modelText}`;
    if (seenColors.has(key)) continue;
    seenColors.add(key);

    let imageUrl = '';
    if (imgMatch) {
      const href = imgMatch[1];
      imageUrl = href.startsWith('http') ? href : `${SITE_BASE}/${href.replace(/^\.\.\//, '')}`;
    }

    const models = modelText ? modelText.split('/').map(s => s.trim()).filter(Boolean) : [];

    colors.push({ code, imageUrl, models });
  }

  log(`  Found ${colors.length} color variants`);

  return { name, slug, url, description, specs: uniqueSpecs, colors };
}

// ---------------------------------------------------------------------------
// Step 3: Try to fetch prices from e-shop
// ---------------------------------------------------------------------------

async function fetchEshopPrice(shopUrl: string): Promise<number> {
  if (!shopUrl) return 0;
  try {
    const res = await fetch(shopUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return 0;
    const html = await res.text();
    // STORES.jp price pattern: ¥X,XXX or data-price or price in JSON-LD
    const priceMatch = html.match(/["']price["']\s*:\s*["']?(\d[\d,]+)/i)
      || html.match(/¥([\d,]+)/);
    if (priceMatch) {
      return parseInt(priceMatch[1].replace(/,/g, ''));
    }
  } catch {
    // E-shop may block, that's OK
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Exported ScraperFunction for pipeline integration
// ---------------------------------------------------------------------------

export const scrapeNorthCraftPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const scraped = await scrapeProductPage(url);

  // Collect unique weights from specs
  const weights = [...new Set(scraped.specs.map(s => s.weight))];

  // Use first spec's length, or null
  const length = scraped.specs.length > 0 ? scraped.specs[0].length : null;

  // Use max price from specs
  const price = scraped.specs.length > 0
    ? Math.max(...scraped.specs.map(s => s.price).filter(p => p > 0), 0)
    : 0;

  // Convert colors: use code as name, imageUrl as-is
  const colors = scraped.colors.map(c => ({
    name: c.code,
    imageUrl: c.imageUrl,
  }));

  // Main image: first color image or empty
  const mainImage = colors.length > 0 ? colors[0].imageUrl : '';

  return {
    name: scraped.name,
    name_kana: '',
    slug: scraped.slug,
    manufacturer: MANUFACTURER,
    manufacturer_slug: MANUFACTURER_SLUG,
    type: 'ミノー',
    target_fish: ['シーバス'],
    description: scraped.description,
    price,
    colors,
    weights,
    length,
    mainImage,
    sourceUrl: url,
  };
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('North Craft Scraper Pipeline - Starting');
  log('========================================');

  const startTime = Date.now();
  let totalRows = 0;
  let totalColors = 0;
  let totalImages = 0;
  let errorCount = 0;
  let newProducts = 0;

  try {
    const makerRecordId = await findMakerRecordId();
    log(`Maker record ID: ${makerRecordId}`);

    // 1. Discover product links
    const productLinks = await discoverProductLinks();
    if (productLinks.length === 0) {
      log('No products found. Exiting.');
      return;
    }

    // 2. Process each product
    for (const link of productLinks) {
      const scraped = await scrapeProductPage(link.url);
      log(`\n--- ${scraped.name} (${scraped.specs.length} models, ${scraped.colors.length} colors) ---`);

      // Check if already in Airtable
      const alreadyInAirtable = await airtableLureExists(link.url);

      // Try to fetch prices
      for (const spec of scraped.specs) {
        if (spec.shopUrl && spec.price === 0) {
          spec.price = await fetchEshopPrice(spec.shopUrl);
          if (spec.price > 0) log(`  Price for ${spec.model}: ¥${spec.price}`);
          await sleep(300);
        }
      }

      // Upload color images to R2
      const colorImageMap = new Map<string, string>();
      for (let ci = 0; ci < scraped.colors.length; ci++) {
        const color = scraped.colors[ci];
        try {
          const padded = String(ci + 1).padStart(2, '0');
          const r2Key = `${MANUFACTURER_SLUG}/${scraped.slug}/${padded}.webp`;
          const pubUrl = await processAndUploadImage(color.imageUrl, r2Key);
          colorImageMap.set(color.code, pubUrl);
          totalImages++;
        } catch (err) {
          logError(`  Image failed for ${color.code}: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Insert into Supabase: for each color × matching model combination
      let rowsForProduct = 0;

      for (const color of scraped.colors) {
        // Find which specs this color applies to
        const matchingSpecs = scraped.specs.filter(spec => {
          if (color.models.length === 0) return true; // applies to all
          return color.models.some(m => spec.model.includes(m));
        });

        if (matchingSpecs.length === 0 && scraped.specs.length > 0) {
          // Fallback: apply to all specs
          matchingSpecs.push(...scraped.specs);
        }

        for (const spec of matchingSpecs) {
          try {
            // Use model-specific slug for uniqueness
            const modelSlug = `${scraped.slug}-${spec.model.toLowerCase()}`;
            const exists = await lureExists(modelSlug, color.code, spec.weight);
            if (exists) {
              log(`  Skip existing: ${spec.model} / ${color.code}`);
              continue;
            }

            const imgUrl = colorImageMap.get(color.code) || null;
            await insertLure({
              name: `${scraped.name} ${spec.model}`,
              slug: modelSlug,
              manufacturer: MANUFACTURER,
              manufacturer_slug: MANUFACTURER_SLUG,
              type: 'ミノー',
              price: spec.price,
              description: scraped.description || null,
              images: imgUrl ? [imgUrl] : null,
              color_name: color.code,
              weight: spec.weight,
              length: spec.length,
              is_limited: false,
              is_discontinued: false,
              target_fish: ['シーバス'],
            });
            rowsForProduct++;
          } catch (err) {
            logError(`  Insert failed: ${spec.model}/${color.code}: ${err instanceof Error ? err.message : err}`);
            errorCount++;
          }
        }
      }

      totalRows += rowsForProduct;
      totalColors += scraped.colors.length;
      log(`  Inserted ${rowsForProduct} rows, ${colorImageMap.size}/${scraped.colors.length} images`);

      // Create Airtable record if new
      if (!alreadyInAirtable) {
        newProducts++;
        try {
          await createAirtableLureRecord(
            scraped.name, link.url, makerRecordId, '登録完了',
            `${scraped.colors.length}色 x ${scraped.specs.length}モデル = ${rowsForProduct}行挿入`,
          );
        } catch (err) {
          logError(`  Airtable record failed: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        log(`  Already in Airtable, skipping record creation`);
      }

      await sleep(500);
    }

    // Update maker status
    log('\nUpdating maker status to 登録済み...');
    await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `/${makerRecordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { 'ステータス': '登録済み' } }),
    });

  } catch (err) {
    logError(`Pipeline failed: ${err instanceof Error ? err.message : err}`);
    errorCount++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('\n========================================');
  log('North Craft Pipeline Summary');
  log('========================================');
  log(`Products discovered: ${newProducts} new`);
  log(`Rows inserted: ${totalRows}`);
  log(`Colors: ${totalColors}, Images: ${totalImages} (${totalColors > 0 ? Math.round(totalImages / totalColors * 100) : 0}%)`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/north-craft');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
