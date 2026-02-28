// scripts/scrapers/mc-works.ts
// MC Works scraper — WordPress site, fetch + regex parsing
// Product listing: https://mcworks.jp/products/prodyct_category/lure (note typo in URL)
// Product pages use <dl class="product-price"> for weight/price
// Colors listed in description text as "COLOR: ..." line
// Prices shown as both tax-excluded and tax-included
// All products are メタルジグ targeting large pelagic species

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

const MANUFACTURER = 'MC Works';
const MANUFACTURER_SLUG = 'mc-works';
const SITE_BASE = 'https://www.mcworks.jp';
const LISTING_URL = 'https://mcworks.jp/products/prodyct_category/lure';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// ---------------------------------------------------------------------------
// Product type / target fish mapping
// ---------------------------------------------------------------------------

// All MC Works lures are メタルジグ (metal jigs) targeting large pelagic species
// except CATUP (casting jig) and TARMAC/GRAVEL (shore jig)
function getProductType(name: string): string {
  return 'メタルジグ';
}

function getTargetFish(name: string): string[] {
  const n = name.toUpperCase();
  if (n.includes('CATUP') || n.includes('TARMAC') || n.includes('GRAVEL')) {
    return ['ヒラマサ', 'ブリ', 'カンパチ'];
  }
  if (n.includes('BUNCHIN')) {
    return ['ヒラマサ', 'ブリ', 'カンパチ'];
  }
  if (n.includes('GUTUP')) {
    return ['カンパチ', 'ブリ', 'ヒラマサ'];
  }
  // KILLER JIG series & GUTTER JIG series — offshore jigging
  return ['ヒラマサ', 'ブリ', 'カンパチ', 'マグロ'];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeightPrice {
  weight: number;
  priceTaxIncl: number;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  type: string;
  targetFish: string[];
  description: string;
  colors: string[];
  weights: WeightPrice[];
  mainImageUrl: string | null;
  productImages: string[];
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [mc-works] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [mc-works] ERROR: ${msg}`); }
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

function slugify(name: string): string {
  return name
    // Convert Unicode Roman numerals to ASCII
    .replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III')
    .replace(/Ⅳ/g, 'IV').replace(/Ⅴ/g, 'V').replace(/Ⅵ/g, 'VI')
    .replace(/ⅰ/g, 'i').replace(/ⅱ/g, 'ii').replace(/ⅲ/g, 'iii')
    .replace(/ⅳ/g, 'iv').replace(/ⅴ/g, 'v').replace(/ⅵ/g, 'vi')
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[^a-z0-9\-]/g, '')
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
// Scraping: listing page -> category pages -> product pages
// ---------------------------------------------------------------------------

interface ProductLink {
  name: string;
  url: string;
}

// Lure-related category slugs (from the listing page)
const LURE_CATEGORY_SLUGS = [
  'killer-jig',
  'gutter-jig',
  'bunchin',
  'guttup',
  'catup',
  'gravel',
  'tarmac',
];

async function scrapeListingPage(): Promise<ProductLink[]> {
  const products: ProductLink[] = [];
  const seen = new Set<string>();

  // Step 1: Fetch each category page and extract individual product URLs
  for (const catSlug of LURE_CATEGORY_SLUGS) {
    const catUrl = `${SITE_BASE}/products/prodyct_category/${catSlug}`;
    log(`  Fetching category: ${catSlug}`);
    try {
      const html = await fetchPage(catUrl);

      // Product links on category pages:
      // <a class="frame" href="https://www.mcworks.jp/products/{id}">
      // <h3 class="content-title"><span>{name}</h3>
      // OR on individual product pages (related):
      // <a href="https://www.mcworks.jp/products/{id}">
      // <h3 class="content-title">{name}</h3>
      const linkRegex = /<a[^>]+href="(https?:\/\/www\.mcworks\.jp\/products\/(\d+))"[^>]*>\s*<h3\s+class="content-title">(?:<span>)?([^<]+)/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1];
        const name = match[3].trim();
        if (!seen.has(url)) {
          seen.add(url);
          products.push({ name, url });
        }
      }

      await sleep(300);
    } catch (err) {
      logError(`  Category fetch failed (${catSlug}): ${err instanceof Error ? err.message : err}`);
    }
  }

  return products;
}

// ---------------------------------------------------------------------------
// Scraping: individual product page
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Extract from <p class="product-introduction text-center">
  const introMatch = html.match(/<p\s+class="product-introduction[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (!introMatch) return '';

  let text = introMatch[1];

  // Remove COLOR line and everything after it
  const colorIdx = text.indexOf('COLOR:');
  if (colorIdx >= 0) {
    text = text.substring(0, colorIdx);
  }
  // Also remove "COLOR:" with full-width colon
  const colorIdx2 = text.indexOf('COLOR：');
  if (colorIdx2 >= 0) {
    text = text.substring(0, colorIdx2);
  }

  // Strip HTML tags, convert <br> to space
  text = text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to 500 chars
  if (text.length > 500) text = text.substring(0, 500);
  return text;
}

function parseColors(html: string): string[] {
  // Extract COLOR: line from ALL product-introduction paragraphs
  // (GUTUP has COLOR in a second product-introduction inside product-spec)
  const introMatches = [...html.matchAll(/<p\s+class="product-introduction[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)];
  if (introMatches.length === 0) return [];

  // Combine all intro text
  const intro = introMatches.map(m => stripTags(m[1])).join('\n');
  const colors: string[] = [];

  // Find COLOR: line(s)
  const lines = intro.split('\n').map(l => l.trim()).filter(Boolean);
  let inColorSection = false;

  for (const line of lines) {
    if (line.match(/^COLOR\s*[:：]/i)) {
      inColorSection = true;
      // Extract colors from same line after COLOR:
      const afterColon = line.replace(/^COLOR\s*[:：]\s*/i, '').trim();
      if (afterColon) {
        // Colors can be comma-separated (、or ,) on one line
        const parts = afterColon.split(/[、,，]/).map(c => c.trim()).filter(Boolean);
        for (const p of parts) {
          // Skip footnotes, "etc", and other non-color entries
          if (p.startsWith('※') || p.startsWith('Made')) continue;
          if (/^etc\.?$/i.test(p)) continue;
          // Clean: "SYB-1" or "FH ファイアーホロ" or "SYB-Ⅴ (NEW)"
          const cleaned = p.replace(/\s*\(NEW\)\s*/gi, '').replace(/\s*\(新色\)\s*/gi, '').trim();
          if (cleaned) colors.push(cleaned);
        }
      }
      continue;
    }

    if (inColorSection) {
      // Check if this line is a color entry (e.g., "SYB-LOW 低輝度ミックスシルバーホロ")
      // Stop at lines starting with ※ or empty lines after content
      if (line.startsWith('※') || line.startsWith('Made') || line.match(/^[\s]*$/)) {
        inColorSection = false;
        continue;
      }

      // Multi-line color entries like "SYB-LOW 低輝度ミックスシルバーホロ"
      // Use abbreviation part only (before the Japanese description)
      const abbrMatch = line.match(/^([A-Z0-9][\w\-.\s]*?)(?:\s+[\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]|$)/);
      if (abbrMatch) {
        const cleaned = abbrMatch[1].trim();
        if (cleaned) colors.push(cleaned);
      } else {
        // Line might be all Japanese color name
        const cleaned = line.trim();
        if (cleaned && !cleaned.startsWith('※')) colors.push(cleaned);
      }
    }
  }

  // Deduplicate
  return [...new Set(colors)];
}

function parseWeightPrices(html: string): WeightPrice[] {
  const weights: WeightPrice[] = [];

  // Parse <dl class="product-price"> blocks
  // <dt class="product-header">120g</dt>
  // <dd class="product-cell">¥2,400-(税抜)</dd>
  // <dd class="product-cell">¥2,640-(税込)</dd>
  const dlRegex = /<dl\s+class="product-price">\s*<dt\s+class="product-header">([^<]+)<\/dt>([\s\S]*?)<\/dl>/gi;
  let match;

  while ((match = dlRegex.exec(html)) !== null) {
    const headerText = match[1].trim();
    const ddContent = match[2];

    // Extract weight from header (e.g., "120g", "150ｇ", "250g (NEW)")
    const weightMatch = headerText.match(/([\d.]+)\s*[gｇ]/i);
    if (!weightMatch) continue;
    const weight = parseFloat(weightMatch[1]);

    // Extract tax-inclusive price (税込)
    const taxInclMatch = ddContent.match(/[¥￥]([\d,，]+)\s*-?\s*[（(]?\s*税込/i);
    if (taxInclMatch) {
      const price = parseInt(taxInclMatch[1].replace(/[,，]/g, ''), 10);
      weights.push({ weight, priceTaxIncl: price });
    } else {
      // Fallback: get tax-excluded price and multiply by 1.1
      const taxExclMatch = ddContent.match(/[¥￥]([\d,，]+)\s*-?\s*[（(]?\s*税抜/i);
      if (taxExclMatch) {
        const priceExcl = parseInt(taxExclMatch[1].replace(/[,，]/g, ''), 10);
        weights.push({ weight, priceTaxIncl: Math.round(priceExcl * 1.1) });
      }
    }
  }

  return weights;
}

function parseMainImage(html: string): string | null {
  // <img class="content-mainvisual" src="{URL}">
  const match = html.match(/<img\s+class="content-mainvisual"\s+src="([^"]+)"/i);
  if (match) {
    const src = match[1];
    return src.startsWith('http') ? src : `${SITE_BASE}${src}`;
  }
  return null;
}

function parseProductImages(html: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();

  // Find images in the product-spec section
  const specMatch = html.match(/<div\s+class="product-spec">([\s\S]*?)(?:<\/div>\s*<\/div>|<\/div>\s*<dl)/i);
  if (!specMatch) return images;

  const specHtml = specMatch[1];
  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(specHtml)) !== null) {
    let src = match[1];
    // Fix dev URL to production
    src = src.replace('http://mcworks-dev.miat.co.jp', 'https://www.mcworks.jp');
    if (!src.startsWith('http')) src = `${SITE_BASE}${src}`;

    // Get the highest resolution version - strip size suffix from URL
    // e.g., image-300x200.jpg -> image.jpg
    const fullRes = src.replace(/-\d+x\d+(\.\w+)$/, '$1');

    if (!seen.has(fullRes)) {
      seen.add(fullRes);
      images.push(fullRes);
    }
  }

  return images;
}

async function scrapeProductPage(productLink: ProductLink): Promise<ScrapedProduct> {
  const html = await fetchPage(productLink.url);

  // Parse product name from page (more accurate than listing)
  const nameMatch = html.match(/<h2\s+class="page-title"><span>([^<]+)<\/span><\/h2>/i);
  const name = nameMatch ? nameMatch[1].trim() : productLink.name;

  const description = parseDescription(html);
  const colors = parseColors(html);
  const weights = parseWeightPrices(html);
  const mainImageUrl = parseMainImage(html);
  const productImages = parseProductImages(html);
  const slug = slugify(name);

  return {
    name,
    slug,
    type: getProductType(name),
    targetFish: getTargetFish(name),
    description,
    colors,
    weights,
    mainImageUrl,
    productImages,
    sourceUrl: productLink.url,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  let totalProducts = 0;
  let totalRows = 0;
  let totalImages = 0;
  let errorCount = 0;
  let skippedRows = 0;

  log('========================================');
  log('MC Works Pipeline Start');
  log('========================================');

  // --- Fetch product listing ---
  log('Fetching product listing page...');
  const productLinks = await scrapeListingPage();
  log(`Found ${productLinks.length} products on listing page`);

  if (productLinks.length === 0) {
    logError('No products found on listing page');
    process.exit(1);
  }

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
  for (const productLink of productLinks) {
    log(`\n--- ${productLink.name} ---`);

    try {
      const scraped = await scrapeProductPage(productLink);
      totalProducts++;

      log(`  Description: ${scraped.description.substring(0, 80)}...`);
      log(`  Colors (${scraped.colors.length}): ${scraped.colors.join(', ')}`);
      log(`  Weights (${scraped.weights.length}): ${scraped.weights.map(w => `${w.weight}g/¥${w.priceTaxIncl}`).join(', ')}`);
      log(`  Product images: ${scraped.productImages.length}`);

      if (scraped.weights.length === 0) {
        logError('  No weight/price data found');
        errorCount++;
        continue;
      }

      if (scraped.colors.length === 0) {
        logError('  No colors found, using "default" as color');
        scraped.colors.push('default');
      }

      // Upload main image
      let mainR2Url: string | null = null;
      if (scraped.mainImageUrl) {
        try {
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/main.webp`;
          mainR2Url = await processAndUploadImage(scraped.mainImageUrl, key);
          totalImages++;
          log('  Main image uploaded');
        } catch (err) {
          logError(`  Main image failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Upload product images (color reference images)
      const uploadedProductImages: string[] = [];
      for (let i = 0; i < scraped.productImages.length; i++) {
        try {
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/img-${i + 1}.webp`;
          const r2Url = await processAndUploadImage(scraped.productImages[i], key);
          uploadedProductImages.push(r2Url);
          totalImages++;
        } catch (err) {
          logError(`  Product image ${i + 1} failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Insert rows into Supabase — 1 row per color x weight
      let rowsForProduct = 0;
      for (const wp of scraped.weights) {
        for (const color of scraped.colors) {
          // Check if already exists
          if (await lureExists(scraped.slug, color, wp.weight)) {
            skippedRows++;
            continue;
          }

          // Use first uploaded product image as color image, or main image
          const imageUrl = uploadedProductImages.length > 0 ? uploadedProductImages[0] : mainR2Url;

          await insertLure({
            name: scraped.name,
            slug: scraped.slug,
            manufacturer: MANUFACTURER,
            manufacturer_slug: MANUFACTURER_SLUG,
            type: scraped.type,
            price: wp.priceTaxIncl,
            description: scraped.description || null,
            images: imageUrl ? [imageUrl] : null,
            official_video_url: null,
            target_fish: scraped.targetFish,
            length: null,
            weight: wp.weight,
            color_name: color,
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

      log(`  Inserted ${rowsForProduct} rows (skipped ${skippedRows} existing)`);

      // Create Airtable lure record
      if (makerRecordId) {
        try {
          await createAirtableLureRecord(
            scraped.name, scraped.sourceUrl, makerRecordId, '登録完了',
            `${scraped.colors.length}色 × ${scraped.weights.length}ウェイト = ${rowsForProduct}行`,
          );
        } catch (err) {
          logError(`  Airtable lure record failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      await sleep(800); // Polite delay
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
  log('MC Works Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}/${productLinks.length}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Rows skipped (existing): ${skippedRows}`);
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

main().catch(err => {
  logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
