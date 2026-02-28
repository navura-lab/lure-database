// scripts/scrapers/bozles.ts
// BOZLES (ボーズレス) scraper — Square Online SPA, Vue.js client-rendered
// Product data embedded in window.__BOOTSTRAP_STATE__ JSON on each page
// Product info pages at /page-{N}, color data in cell[2] repeatables
// Image URLs from JSON (DOM images lazy-loaded, not available in raw HTML)

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

const MANUFACTURER = 'BOZLES';
const MANUFACTURER_SLUG = 'bozles';
const SITE_BASE = 'https://www.bozles.com';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// Product pages to scrape (route → slug + type mapping)
const LURE_PAGES: { route: string; slug: string; type: string }[] = [
  { route: 'page-1', slug: 'tg-taiko-hideyoshi', type: 'メタルジグ' },
  { route: 'page-2', slug: 'tg-keiji', type: 'メタルジグ' },
  { route: 'page-3', slug: 'tg-ieyasu', type: 'メタルジグ' },
  { route: 'page-4', slug: 'tg-ranmaru', type: 'メタルジグ' },
  { route: 'page-5', slug: 'tg-nobunaga', type: 'メタルジグ' },
  { route: 'page-6', slug: 'tg-nobunaga-neo', type: 'メタルジグ' },
  { route: 'page-7', slug: 'tg-drop-k', type: 'タイラバ' },
  { route: 'page-8', slug: 'tg-hattori', type: 'メタルジグ' },
  { route: 'page-9', slug: 'gou', type: 'メタルジグ' },
  { route: 'page-10', slug: 'nobunaga-light', type: 'メタルジグ' },
  { route: 'page-11', slug: 'yukimura', type: 'メタルジグ' },
  { route: 'page-13', slug: 'toukichirou-lead', type: 'メタルジグ' },
  { route: 'page-18', slug: 'kurama-tengu', type: 'キャスティングプラグ' },
  { route: 'page-19', slug: 'yukimura-slim', type: 'メタルジグ' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuillOp {
  insert: string;
  attributes?: Record<string, unknown>;
}

interface BootstrapRepeatable {
  id: number;
  title?: { content?: { quill?: { ops: QuillOp[] } } };
  text?: { content?: { quill?: { ops: QuillOp[] } } };
  description?: { content?: { quill?: { ops: QuillOp[] } } };
  image?: { figure?: { source?: string; sourceSet?: Record<string, string> } };
}

interface BootstrapCell {
  content?: {
    layout?: string;
    properties?: {
      repeatables?: BootstrapRepeatable[];
      settings?: Record<string, unknown>;
    };
  };
}

interface WeightSpec {
  weight: number | null;
  length: number | null;
  price: number;
  rawText: string;
}

interface ColorVariant {
  name: string;
  imageUrl: string;
  weights: number[];  // available weights for this color (may be empty = all weights)
}

interface ScrapedProduct {
  name: string;
  slug: string;
  url: string;
  type: string;
  description: string;
  specs: WeightSpec[];
  colors: ColorVariant[];
  mainImageUrl: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [bozles] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [bozles] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  return res.text();
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
// Bootstrap State extraction
// ---------------------------------------------------------------------------

function extractBootstrapState(html: string): Record<string, unknown> {
  const marker = 'window.__BOOTSTRAP_STATE__ = ';
  const startIdx = html.indexOf(marker);
  if (startIdx < 0) throw new Error('No __BOOTSTRAP_STATE__ found in HTML');

  const jsonStart = startIdx + marker.length;
  // Find the end: try ;</script> first, then </script> (no semicolon)
  let endIdx = html.indexOf(';</script>', jsonStart);
  if (endIdx < 0) {
    endIdx = html.indexOf('</script>', jsonStart);
  }
  if (endIdx < 0) throw new Error('Could not find end of __BOOTSTRAP_STATE__');

  const jsonStr = html.substring(jsonStart, endIdx).replace(/;\s*$/, '');
  return JSON.parse(jsonStr) as Record<string, unknown>;
}

function getCells(bootstrap: Record<string, unknown>): BootstrapCell[] {
  try {
    const siteData = bootstrap.siteData as Record<string, unknown>;
    const page = siteData.page as Record<string, unknown>;
    const properties = page.properties as Record<string, unknown>;
    const contentAreas = properties.contentAreas as Record<string, unknown>;
    const userContent = contentAreas.userContent as Record<string, unknown>;
    const content = userContent.content as Record<string, unknown>;
    return (content.cells || []) as BootstrapCell[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Quill delta parsing
// ---------------------------------------------------------------------------

function quillToText(ops: QuillOp[]): string {
  return ops.map(op => op.insert).join('').trim();
}

function quillToBulletLines(ops: QuillOp[]): string[] {
  // Quill delta: text is accumulated until a \n with attributes.list === "bullet"
  const lines: string[] = [];
  let current = '';
  for (const op of ops) {
    if (op.insert === '\n' && op.attributes?.list === 'bullet') {
      if (current.trim()) lines.push(current.trim());
      current = '';
    } else if (op.insert === '\n') {
      // Regular newline — flush if content exists but start fresh
      if (current.trim()) {
        // Not a bullet; could be heading or plain text. Skip.
      }
      current = '';
    } else {
      current += op.insert;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Parse product name from cell 0
// ---------------------------------------------------------------------------

function parseProductName(cells: BootstrapCell[], bootstrap: Record<string, unknown>): string {
  // Cell 0 (or first cell with text-and-image-text-below layout) has the product name
  for (const cell of cells) {
    const layout = cell.content?.layout || '';
    if (layout.includes('text-and-image') || layout.includes('text-below')) {
      const reps = cell.content?.properties?.repeatables || [];
      for (const rep of reps) {
        if (rep.title?.content?.quill?.ops) {
          const name = quillToText(rep.title.content.quill.ops);
          if (name && name.length > 1) return name;
        }
      }
    }
  }
  // Fallback: for gallery-first pages (page-13, page-19), use the color grid title
  // which actually contains the product name
  for (const cell of cells) {
    const layout = cell.content?.layout || '';
    if (layout.includes('2-column')) {
      const reps = cell.content?.properties?.repeatables || [];
      if (reps.length > 0 && reps[0].title?.content?.quill?.ops) {
        const name = quillToText(reps[0].title.content.quill.ops);
        if (name && name.length > 1) return name;
      }
    }
  }
  // Last fallback: page title from siteData
  try {
    const siteData = bootstrap.siteData as Record<string, unknown>;
    const page = siteData.page as Record<string, unknown>;
    const title = (page as { title?: string }).title;
    if (title) return title;
  } catch { /* ignore */ }
  return '';
}

// ---------------------------------------------------------------------------
// Parse description from cell 0
// ---------------------------------------------------------------------------

function parseDescription(cells: BootstrapCell[]): string {
  for (const cell of cells) {
    const layout = cell.content?.layout || '';
    if (layout.includes('text-and-image') || layout.includes('text-below')) {
      const reps = cell.content?.properties?.repeatables || [];
      for (const rep of reps) {
        if (rep.text?.content?.quill?.ops) {
          const desc = quillToText(rep.text.content.quill.ops);
          if (desc && desc.length > 10) return desc.substring(0, 300);
        }
      }
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Parse main image from cell 0
// ---------------------------------------------------------------------------

function parseMainImage(cells: BootstrapCell[]): string | null {
  for (const cell of cells) {
    const layout = cell.content?.layout || '';
    if (layout.includes('text-and-image') || layout.includes('text-below')) {
      const reps = cell.content?.properties?.repeatables || [];
      for (const rep of reps) {
        if (rep.image?.figure?.source) {
          return resolveImageUrl(rep.image.figure.source);
        }
      }
    }
  }
  return null;
}

function resolveImageUrl(source: string): string {
  if (source.startsWith('http')) return source;
  return `${SITE_BASE}${source.startsWith('/') ? '' : '/'}${source}`;
}

function getImageUrl(figure: { source?: string; sourceSet?: Record<string, string> } | undefined, preferredWidth = '800w'): string {
  if (!figure) return '';
  // Prefer sourceSet at preferred width
  if (figure.sourceSet?.[preferredWidth]) {
    return resolveImageUrl(figure.sourceSet[preferredWidth]);
  }
  // Fallback to source with width param
  if (figure.source) {
    const base = resolveImageUrl(figure.source);
    return `${base}?width=800`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Parse weight/price specs from cell 1
// ---------------------------------------------------------------------------

function parseSpecsFromCell(cell: BootstrapCell): WeightSpec[] {
  const specs: WeightSpec[] = [];
  const reps = cell.content?.properties?.repeatables || [];

  for (const rep of reps) {
    const ops = rep.text?.content?.quill?.ops || rep.description?.content?.quill?.ops || [];
    if (ops.length === 0) continue;

    // Try bullet list format first
    const bulletLines = quillToBulletLines(ops);
    if (bulletLines.length > 0) {
      for (const line of bulletLines) {
        const spec = parseWeightLine(line);
        if (spec) specs.push(spec);
      }
    } else {
      // Fallback: parse newline-separated lines (text-4 layout uses ・prefix)
      const fullText = quillToText(ops);
      const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        // Remove leading ・ (katakana middle dot)
        const cleaned = line.replace(/^[・•]\s*/, '');
        const spec = parseWeightLine(cleaned);
        if (spec) specs.push(spec);
      }
    }
  }
  return specs;
}

function parseWeightLine(line: string): WeightSpec | null {
  // Pattern 1: XXXmm(XXXg)...price (e.g., "250mm(120g)...8,900円 (税込9,790円)")
  const mmMatch = line.match(/(\d+)\s*mm\s*\((\d+)\s*g\)/);
  if (mmMatch) {
    const length = parseInt(mmMatch[1], 10);
    const weight = parseInt(mmMatch[2], 10);
    const price = extractPrice(line);
    return { weight, length, price, rawText: line };
  }

  // Pattern 2: XXg...price (standard, e.g., "15g.................1,100円")
  const gMatch = line.match(/^(\d+)\s*g/);
  if (gMatch) {
    const weight = parseInt(gMatch[1], 10);
    const price = extractPrice(line);
    return { weight, length: null, price, rawText: line };
  }

  // Pattern 3: XX号...price (e.g., "12号.........1,500円")
  const gouMatch = line.match(/^(\d+)\s*号/);
  if (gouMatch) {
    // 号 sizes for squid sinkers — store raw weight as null
    const price = extractPrice(line);
    return { weight: null, length: null, price, rawText: line };
  }

  return null;
}

function extractPrice(line: string): number {
  // Look for first price (before 税込): "1,100円"
  const priceMatch = line.match(/([\d,]+)\s*円/);
  if (priceMatch) return parseInt(priceMatch[1].replace(/,/g, ''), 10);
  return 0;
}

// ---------------------------------------------------------------------------
// Parse color grid from cell 2
// ---------------------------------------------------------------------------

function parseColorsFromCell(cell: BootstrapCell): ColorVariant[] {
  const colors: ColorVariant[] = [];
  const reps = cell.content?.properties?.repeatables || [];

  // Detect if all titles are the same (= product name, not color name)
  // In that case, actual color names are in the `text` field
  const allTitles: string[] = [];
  for (const rep of reps) {
    const ops = rep.title?.content?.quill?.ops;
    if (ops) allTitles.push(quillToText(ops).trim());
  }
  const uniqueTitles = new Set(allTitles.filter(t => t.length > 0));
  const titleIsProductName = uniqueTitles.size === 1 && allTitles.length >= 2;

  for (const rep of reps) {
    // Color name: prefer title, but if all titles are the same product name,
    // use text field instead (page-13, page-19 pattern)
    let name = '';
    if (titleIsProductName) {
      // Color name is in text field
      const textOps = rep.text?.content?.quill?.ops;
      if (textOps) {
        name = quillToText(textOps).replace(/\n/g, '').trim();
      }
    } else {
      const nameOps = rep.title?.content?.quill?.ops;
      if (nameOps) {
        name = quillToText(nameOps).replace(/\n/g, '').trim();
      }
    }
    if (!name || name === 'ショッピングカート') continue; // Skip nav items

    // Image URL
    const imageUrl = getImageUrl(rep.image?.figure);

    // Per-color weight lineup (if available in description or text)
    const weights: number[] = [];
    const descOps = titleIsProductName
      ? rep.description?.content?.quill?.ops   // text already used for name
      : (rep.description?.content?.quill?.ops || rep.text?.content?.quill?.ops);
    if (descOps) {
      const descText = quillToText(descOps);
      // Extract weights like "15g,20g,30g,40g..." or "15g、20g、30g..."
      const wMatches = [...descText.matchAll(/(\d+)\s*g/g)];
      for (const wm of wMatches) {
        const w = parseInt(wm[1], 10);
        if (w > 0 && !weights.includes(w)) weights.push(w);
      }
    }

    colors.push({ name, imageUrl, weights });
  }

  return colors;
}

// ---------------------------------------------------------------------------
// Find spec and color cells by layout type
// ---------------------------------------------------------------------------

function findCellByType(cells: BootstrapCell[], type: 'spec' | 'color'): BootstrapCell | null {
  for (const cell of cells) {
    const layout = cell.content?.layout || '';
    if (type === 'spec') {
      // Spec cell uses split-image-left, basic-text, or text-4, and contains weight/price
      if (layout.includes('split-image') || layout === 'basic-text' || layout.startsWith('text-')) {
        const reps = cell.content?.properties?.repeatables || [];
        for (const rep of reps) {
          const ops = rep.text?.content?.quill?.ops || [];
          const text = ops.map((o: QuillOp) => o.insert).join('');
          if (/ウエイト|価格|円/.test(text)) return cell;
        }
      }
    }
    if (type === 'color') {
      // Color grid uses 2-column or 3-column layout with multiple repeatables
      if (layout.includes('2-column') || layout.includes('3-column') || layout.includes('4-column')) {
        const reps = cell.content?.properties?.repeatables || [];
        if (reps.length >= 2) return cell;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scrape a single product page
// ---------------------------------------------------------------------------

async function scrapeProduct(page: typeof LURE_PAGES[0]): Promise<ScrapedProduct | null> {
  const url = `${SITE_BASE}/${page.route}`;
  const html = await fetchPage(url);

  let bootstrap: Record<string, unknown>;
  try {
    bootstrap = extractBootstrapState(html);
  } catch (e) {
    logError(`Failed to extract bootstrap state: ${e}`);
    return null;
  }

  const cells = getCells(bootstrap);
  if (cells.length < 2) {
    log(`  Only ${cells.length} cells found — skipping`);
    return null;
  }

  // Product name
  const name = parseProductName(cells, bootstrap);
  if (!name) {
    log(`  Could not extract product name from ${url}`);
    return null;
  }

  // Description
  const description = parseDescription(cells);

  // Main image
  const mainImageUrl = parseMainImage(cells);

  // Specs (weight/price)
  const specCell = findCellByType(cells, 'spec');
  const specs = specCell ? parseSpecsFromCell(specCell) : [];

  // Colors
  const colorCell = findCellByType(cells, 'color');
  const colors = colorCell ? parseColorsFromCell(colorCell) : [];

  log(`  Name: ${name}`);
  log(`  Description: ${description.substring(0, 60)}...`);
  log(`  Specs: ${specs.length} weight variants`);
  if (specs.length > 0) {
    log(`    First: ${specs[0].rawText.substring(0, 50)}`);
    log(`    Last: ${specs[specs.length - 1].rawText.substring(0, 50)}`);
  }
  log(`  Colors: ${colors.length}`);
  if (colors.length > 0) {
    log(`    Names: ${colors.map(c => c.name).join(', ')}`);
  }
  log(`  Main image: ${mainImageUrl ? 'yes' : 'no'}`);

  return {
    name,
    slug: page.slug,
    url,
    type: page.type,
    description,
    specs,
    colors,
    mainImageUrl,
  };
}

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

  totalProducts = LURE_PAGES.length;
  log(`Starting BOZLES scraper — ${totalProducts} product pages to process`);

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

  // 2) Scrape each product page
  for (let i = 0; i < LURE_PAGES.length; i++) {
    const page = LURE_PAGES[i];
    log(`\n--- [${i + 1}/${LURE_PAGES.length}] ${page.route} (${page.slug}) ---`);

    let product: ScrapedProduct | null = null;
    try {
      product = await scrapeProduct(page);
    } catch (e) {
      logError(`Product fetch failed: ${e}`);
      totalErrors++;
      await sleep(1000);
      continue;
    }

    if (!product) {
      totalSkipped++;
      await sleep(500);
      continue;
    }

    // If no specs, create a single entry with null weight
    const effectiveSpecs = product.specs.length > 0
      ? product.specs
      : [{ weight: null, length: null, price: 0, rawText: '' }];

    // If no colors found, use main image as "スタンダード"
    const effectiveColors: ColorVariant[] = product.colors.length > 0
      ? product.colors
      : product.mainImageUrl
        ? [{ name: 'スタンダード', imageUrl: product.mainImageUrl, weights: [] }]
        : [{ name: 'スタンダード', imageUrl: '', weights: [] }];

    // Upload color images
    const imageUrls: Map<string, string> = new Map();
    for (let c = 0; c < effectiveColors.length; c++) {
      const color = effectiveColors[c];
      if (!color.imageUrl) continue;
      try {
        const r2Key = `${MANUFACTURER_SLUG}/${product.slug}/${c}.webp`;
        const publicUrl = await processAndUploadImage(color.imageUrl, r2Key);
        imageUrls.set(color.name, publicUrl);
        log(`  Image uploaded: ${r2Key}`);
        totalImages++;
      } catch (e) {
        logError(`  Image failed (${color.name}): ${e}`);
        totalErrors++;
      }
    }

    // Insert rows: color × spec
    let insertedForProduct = 0;
    for (let c = 0; c < effectiveColors.length; c++) {
      const color = effectiveColors[c];
      const r2Url = imageUrls.get(color.name) || '';

      // Determine which weights apply to this color
      let applicableSpecs = effectiveSpecs;
      if (color.weights.length > 0) {
        // This color has specific weight availability — filter specs
        applicableSpecs = effectiveSpecs.filter(s =>
          s.weight === null || color.weights.includes(s.weight)
        );
        // If filtering results in empty, fall back to all specs
        if (applicableSpecs.length === 0) applicableSpecs = effectiveSpecs;
      }

      for (const spec of applicableSpecs) {
        try {
          const exists = await lureExists(product.slug, color.name, spec.weight);
          if (exists) {
            log(`  Skip existing: ${color.name} / ${spec.weight}g`);
            continue;
          }

          await insertLure({
            manufacturer: MANUFACTURER,
            manufacturer_slug: MANUFACTURER_SLUG,
            name: product.name,
            slug: product.slug,
            type: product.type,
            color_name: color.name,
            weight: spec.weight,
            length: spec.length,
            price: spec.price || null,
            images: r2Url ? [r2Url] : null,
            description: product.description || null,
            target_fish: ['オフショア'],
            is_limited: false,
            is_discontinued: false,
          });
          insertedForProduct++;
        } catch (e) {
          logError(`  Insert failed (${color.name}/${spec.weight}g): ${e}`);
          totalErrors++;
        }
      }
    }

    totalInserted += insertedForProduct;
    totalScraped++;
    log(`  Inserted ${insertedForProduct} rows (${effectiveColors.length}色 x ${effectiveSpecs.length}ウェイト)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.url,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `${effectiveColors.length}色 x ${effectiveSpecs.length}ウェイト = ${insertedForProduct}行`,
        });
      } catch (e) {
        logError(`  Airtable record failed: ${(e as Error).message}`);
      }
    }

    await sleep(1500);  // Be polite to Square Online CDN
  }

  // 3) Update maker status
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

  // 4) Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`
========================================`);
  log(`${MANUFACTURER} Pipeline Summary`);
  log(`========================================`);
  log(`Products discovered: ${totalProducts}`);
  log(`Products scraped: ${totalScraped}`);
  log(`Products skipped: ${totalSkipped}`);
  log(`Rows inserted: ${totalInserted}`);
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${totalErrors}`);
  log(`Elapsed: ${elapsed}s`);
  log(`========================================`);
}

main().catch(e => {
  logError(`Fatal: ${e}`);
  process.exit(1);
});
