// scripts/scrapers/hots.ts
// HOTS scraper — Static HTML site (jQuery+Bootstrap+Isotope), UTF-8, fetch-only
// Index at /lure.html with sidebar sub-menu listing all lure pages
// Product pages: /lure-{name}.html
// Spec format: inline bullet points "● 125g ￥1,950(税抜)" inside tableBlock divs
// Color Chart section with images + numbered text labels "1. ホロ シルバー\nMH.Silver"
// Prices are tax-excluded (x1.1 for tax-inclusive)

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

const MANUFACTURER = 'HOTS';
const MANUFACTURER_SLUG = 'hots';
const SITE_BASE = 'https://hots.co.jp';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// ---------------------------------------------------------------------------
// Product definitions — extracted from sidebar sub-menu on lure.html
// ---------------------------------------------------------------------------

interface ProductDef {
  name: string;
  slug: string;
  page: string;
  type: string;
  targetFish: string[];
}

const PRODUCTS: ProductDef[] = [
  // METAL JIG
  { name: 'NS JIG', slug: 'ns-jig', page: 'lure-ns-jig.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'KALCHI SUPER LONG JIG', slug: 'kalchi-super-long-jig', page: 'lure-Kalchi-jig.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'KEITAN JIG', slug: 'keitan-jig', page: 'lure-keitan.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Drift tune', slug: 'drift-tune', page: 'lure-drift-tune.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'DEBUTAN JIG', slug: 'debutan-jig', page: 'lure-debutan.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'KEITAN JIG STD.', slug: 'keitan-jig-std', page: 'lure-keitan-std.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'KEITAN JIG Aluminum', slug: 'keitan-jig-aluminum', page: 'lure-keitan-jig-alumi.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'KS JIG', slug: 'ks-jig', page: 'lure-ks-jig.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Otoko JIG', slug: 'otoko-jig', page: 'lure-otoko-jig.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'R2 JIG', slug: 'r2-jig', page: 'lure-r2-jig.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Y2 JIG', slug: 'y2-jig', page: 'lure-y2-jig.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Conker', slug: 'conker', page: 'lure-conker.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'CHIBITAN', slug: 'chibitan', page: 'lure-chibitan.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Skill Gamma', slug: 'skill-gamma', page: 'lure-skill-gamma.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'SLASH BLADE', slug: 'slash-blade', page: 'lure-slash-blade.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Bigfin', slug: 'bigfin', page: 'lure-big-fin.html', type: 'メタルジグ', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'] },
  // WIRE RIG is an accessory (tackle rig), skip it
  // PLUG
  { name: 'KEIKO OCEAN BULL', slug: 'keiko-ocean-bull', page: 'lure-keiko-bull.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'KEIKO OCEAN GATARO', slug: 'keiko-ocean-gataro', page: 'lure-keiko-gataro.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'KEIKO OCEAN ATTUMA', slug: 'keiko-ocean-attuma', page: 'lure-keiko-attuma.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'KEIKO OCEAN CHUGAYU', slug: 'keiko-ocean-chugayu', page: 'lure-keiko-chugayu.html', type: 'ポッパー', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'KEIKO OCEAN', slug: 'keiko-ocean', page: 'lure-keiko-ocean.html', type: 'ポッパー', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'KEIKO OCEAN POPPER Rv.', slug: 'keiko-ocean-popper-rv', page: 'lure-keiko-popper.html', type: 'ポッパー', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'IGOSSO', slug: 'igosso', page: 'lure-igosso.html', type: 'ダイビングペンシル', targetFish: ['マグロ', 'ヒラマサ', 'カンパチ', 'GT'] },
  { name: 'Tide Bait.Sardine', slug: 'tide-bait-sardine', page: 'lure-tidebait.html', type: 'シンキングペンシル', targetFish: ['ヒラマサ', 'カンパチ', 'ブリ'] },
  { name: 'Chug & MiniChag', slug: 'chug-and-minichag', page: 'lure-chug-mini.html', type: 'ポッパー', targetFish: ['ヒラマサ', 'カンパチ', 'シイラ'] },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeightSpec {
  weight: number;       // grams
  length: number | null; // mm or null
  price: number;        // tax-excluded yen
}

interface ColorInfo {
  name: string;
  imageUrl: string;
}

interface ScrapedProduct {
  name: string;
  slug: string;
  type: string;
  targetFish: string[];
  description: string;
  weightSpecs: WeightSpec[];
  colors: ColorInfo[];
  mainImageUrl: string | null;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [hots] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [hots] ERROR: ${msg}`); }
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
// Scraping: parse weight/price specs from tableBlock
// ---------------------------------------------------------------------------

/**
 * Parse weight/price specs from HOTS product pages.
 * Handles multiple formats:
 *   Format A: "● 125g ￥1,950(税抜)"
 *   Format B: "● 150g / 170mm ￥2,100（税抜）"
 *   Format C: "● 185mm・75g ￥7,000(税抜)"
 *   Format D: "● 30g Wide & Slim\n￥850(税抜)" (weight and price on separate lines)
 *   Format E: "● 130g\nホロ ￥1,600(税抜)" (weight on one line, price on next)
 *   Format F: "サイズ : 190mm / 60g" + "小売価格 : ￥7,000(税抜)" (in separate cells)
 *   Format G: "● 115mm　約38g\n￥1,400(税別)" (length then approx weight)
 *   Format H: SLASH BLADE oz-based table with LENGTH row + price row
 *   Format I: Tide Bait — no weight in table, just price per series
 */
function parseWeightSpecs(html: string): WeightSpec[] {
  const specs: WeightSpec[] = [];
  const seen = new Set<string>();

  function addSpec(weight: number, length: number | null, price: number) {
    const key = `${weight}-${length}-${price}`;
    if (!seen.has(key)) {
      seen.add(key);
      specs.push({ weight, length, price });
    }
  }

  // Find all tableBlock variants and extract the entire block up to its logical end
  // Match from <div class="tableBlock..."> through all content until we hit the next
  // major section (<div class="row") or a closing structure
  const tableBlockRegions = [...html.matchAll(/<div\s+class="tableBlock[^"]*">([\s\S]*?)(?=<\/div>\s*<\/div>\s*<\/div>\s*<\/div>|<div\s+class="row\s)/gi)];

  // Fall back to simpler match if above didn't work
  const tableBlocks = tableBlockRegions.length > 0 ? tableBlockRegions :
    [...html.matchAll(/<div\s+class="tableBlock[^"]*">([\s\S]*?)<\/table>/gi)];

  if (tableBlocks.length === 0) return specs;

  for (const [fullMatch, blockHtml] of tableBlocks) {
    // --- SLASH BLADE oz-based table format ---
    if (/tableBlock_sb/i.test(fullMatch) || /<th>.*oz/i.test(blockHtml)) {
      parseSlashBladeTable(blockHtml, addSpec);
      continue;
    }

    // --- Standard format: process cells ---
    const cells = [...blockHtml.matchAll(/<td(?:\s+[^>]*)?>([^]*?)<\/td>/gi)];

    // First pass: collect all non-English cell texts as blocks
    // Some products have weight in one cell and price in another
    let pendingWeight: number | null = null;
    let pendingLength: number | null = null;

    for (const [, cellHtml] of cells) {
      // Skip English price cells
      if (/price-eng/i.test(cellHtml)) continue;
      // Skip title cells
      if (/class="title"/i.test(cellHtml)) continue;

      const cellText = stripTags(cellHtml);
      if (!cellText.trim()) continue;

      // --- Format F: "サイズ : 190mm / 60g" in one cell ---
      const sizeMatch = cellText.match(/サイズ\s*[:：]\s*(\d+)\s*mm\s*\/\s*(\d+)\s*g/);
      if (sizeMatch) {
        pendingLength = parseFloat(sizeMatch[1]);
        pendingWeight = parseFloat(sizeMatch[2]);
        continue;
      }

      // --- Format F continued: "小売価格 : ￥7,000(税抜)" ---
      if (pendingWeight && /小売価格|価格/.test(cellText)) {
        const priceMatch = cellText.match(/[￥¥]([\d,]+)/);
        if (priceMatch) {
          const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
          addSpec(pendingWeight, pendingLength, price);
          pendingWeight = null;
          pendingLength = null;
          continue;
        }
      }

      // --- Process multi-line cell content (Formats A-E, G) ---
      const lines = cellText.split('\n').map(l => l.trim()).filter(Boolean);

      // Accumulate weight/length/price across lines within a cell
      let cellWeight: number | null = null;
      let cellLength: number | null = null;
      let cellPrice = 0;

      for (const line of lines) {
        // Skip English lines
        if (/Retail price|Excl\.\s*Tax/i.test(line)) continue;

        // Extract weight from line
        let lineWeight: number | null = null;
        let lineLength: number | null = null;
        let linePrice = 0;

        // Price extraction
        const priceMatch = line.match(/[￥¥]([\d,]+)/);
        if (priceMatch) {
          linePrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }

        // Pattern: Xmm・Yg or Xmm Yg (e.g., "185mm・75g")
        const lenWeightMatch = line.match(/(\d+)\s*mm\s*[・·\s]\s*約?(\d+)\s*g/);
        if (lenWeightMatch) {
          lineLength = parseFloat(lenWeightMatch[1]);
          lineWeight = parseFloat(lenWeightMatch[2]);
        }

        if (!lineWeight) {
          // Pattern: Xg / Ymm
          const weightLenMatch = line.match(/(\d+)\s*g\s*\/\s*(\d+)\s*mm/);
          if (weightLenMatch) {
            lineWeight = parseFloat(weightLenMatch[1]);
            lineLength = parseFloat(weightLenMatch[2]);
          }
        }

        if (!lineWeight) {
          // Pattern: Xmm / Yg (e.g., "190mm / 60g")
          const lenSlashWeightMatch = line.match(/(\d+)\s*mm\s*\/\s*約?(\d+)\s*g/);
          if (lenSlashWeightMatch) {
            lineLength = parseFloat(lenSlashWeightMatch[1]);
            lineWeight = parseFloat(lenSlashWeightMatch[2]);
          }
        }

        if (!lineWeight) {
          // Simple: Xg (but not part of unrelated text)
          const simpleWeight = line.match(/(?:●\s*)?(\d+)\s*g(?:\s|$|[^a-zA-Z])/);
          if (simpleWeight) {
            lineWeight = parseFloat(simpleWeight[1]);
          }
        }

        // Update cell-level accumulator
        if (lineWeight && linePrice > 0) {
          // Weight + price on the same line — emit immediately
          addSpec(lineWeight, lineLength, linePrice);
          cellWeight = null;
          cellLength = null;
          cellPrice = 0;
        } else if (lineWeight) {
          // New weight found without price — flush previous if complete
          if (cellWeight && cellPrice > 0) {
            addSpec(cellWeight, cellLength, cellPrice);
          }
          cellWeight = lineWeight;
          cellLength = lineLength || cellLength;
          cellPrice = 0;
        } else if (linePrice > 0 && cellWeight && cellPrice === 0) {
          // Price line following a weight line (Format D/E) — take first price only
          cellPrice = linePrice;
          addSpec(cellWeight, cellLength, cellPrice);
          // Keep cellWeight set but mark price as consumed so we don't double-count
          // Reset for next potential price variant (abalone etc.)
          cellPrice = -1; // sentinel: already emitted
        }
      }

      // Flush remaining cell-level accumulator (skip sentinel -1)
      if (cellWeight && cellPrice > 0) {
        addSpec(cellWeight, cellLength, cellPrice);
      }
      pendingWeight = null;
      pendingLength = null;
    }
  }

  // --- Fallback: if no specs found, look in immunity paragraphs ---
  // e.g., Tide Bait: "全長：150mm / 重量：約47g" in <p class="immunity">
  // combined with prices from tableBlock (e.g., "● ホロ/アルミ ￥3,600(税抜)")
  if (specs.length === 0) {
    const immunityMatches = [...html.matchAll(/<p\s+class="immunity">([\s\S]*?)<\/p>/gi)];
    let fallbackWeight: number | null = null;
    let fallbackLength: number | null = null;

    for (const [, imm] of immunityMatches) {
      const immText = stripTags(imm);
      // "全長：150mm / 重量：約47g"
      const lenMatch = immText.match(/全長\s*[：:]\s*(\d+)\s*mm/);
      const weightMatch = immText.match(/重量\s*[：:]\s*約?(\d+)\s*g/);
      if (lenMatch) fallbackLength = parseFloat(lenMatch[1]);
      if (weightMatch) fallbackWeight = parseFloat(weightMatch[1]);
      // Also try: "190mm/60g" format
      if (!fallbackWeight) {
        const combinedMatch = immText.match(/(\d+)\s*mm\s*[/／]\s*約?(\d+)\s*g/);
        if (combinedMatch) {
          fallbackLength = parseFloat(combinedMatch[1]);
          fallbackWeight = parseFloat(combinedMatch[2]);
        }
      }
    }

    if (fallbackWeight) {
      // Collect prices from tableBlock that didn't have weights
      const pricesFromTable: number[] = [];
      for (const [, blockHtml] of tableBlocks) {
        const cells = [...blockHtml.matchAll(/<td(?:\s+[^>]*)?>([^]*?)<\/td>/gi)];
        for (const [, cellHtml] of cells) {
          if (/price-eng/i.test(cellHtml)) continue;
          if (/class="title"/i.test(cellHtml)) continue;
          const cellText = stripTags(cellHtml);
          const priceMatch = cellText.match(/[￥¥]([\d,]+)/);
          if (priceMatch) {
            const p = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            if (p > 0 && !pricesFromTable.includes(p)) {
              pricesFromTable.push(p);
            }
          }
        }
      }
      // Use the lowest price (non-abalone/regular variant)
      if (pricesFromTable.length > 0) {
        const lowestPrice = Math.min(...pricesFromTable);
        addSpec(fallbackWeight, fallbackLength, lowestPrice);
      }
    }
  }

  return specs;
}

/**
 * Parse SLASH BLADE style oz-based table.
 * Header row: SIZE | 4oz | 6oz | 8oz | 10oz
 * Length row: Length | 151mm | 180mm | ...
 * Price row: 本体価格 | ￥1,550(税抜) | ...
 * Oz to grams: 1oz = 28.35g
 */
function parseSlashBladeTable(blockHtml: string, addSpec: (w: number, l: number | null, p: number) => void) {
  const OZ_TO_G = 28.35;

  // Find all tables within the block (there may be SLASH LONG BLADE + SLASH SHORT BLADE)
  const tables = [...blockHtml.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];

  for (const [, tableHtml] of tables) {
    // Get header row for oz sizes
    const headerMatch = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i);
    if (!headerMatch) continue;

    const headerCells = [...headerMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map(m => stripTags(m[1]).trim());

    // Parse oz values from header (skip first column "SIZE")
    // Handles fractional: "1oz", "1.5oz", "4oz", "15oz"
    const ozValues: number[] = [];
    for (let i = 1; i < headerCells.length; i++) {
      const ozMatch = headerCells[i].match(/([\d.]+)\s*oz/i);
      ozValues.push(ozMatch ? parseFloat(ozMatch[1]) : 0);
    }

    // Parse rows
    const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    const lengths: (number | null)[] = [];
    const prices: number[] = [];

    for (const [, rowHtml] of rows) {
      const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => stripTags(m[1]).trim());
      if (tds.length < 2) continue;

      const label = tds[0];

      if (/Length/i.test(label)) {
        for (let i = 1; i < tds.length; i++) {
          const mm = tds[i].match(/(\d+)\s*mm/);
          lengths.push(mm ? parseFloat(mm[1]) : null);
        }
      } else if (/本体価格|価格/i.test(label)) {
        for (let i = 1; i < tds.length; i++) {
          const priceMatch = tds[i].match(/[￥¥]([\d,]+)/);
          prices.push(priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0);
        }
      }
    }

    // Emit specs
    for (let i = 0; i < ozValues.length; i++) {
      if (ozValues[i] > 0 && prices[i] > 0) {
        const weight = Math.round(ozValues[i] * OZ_TO_G);
        const length = i < lengths.length ? lengths[i] : null;
        addSpec(weight, length, prices[i]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scraping: parse color chart
// ---------------------------------------------------------------------------

function parseColorChart(html: string): ColorInfo[] {
  const colors: ColorInfo[] = [];
  const seen = new Set<string>();

  // Find Color Chart section(s) — they can use various class names:
  // clm06, clm006, or just contain "Color Chart" heading
  // Match from "Color Chart" heading to the next major section or footer
  const colorSections = [...html.matchAll(/<div\s+class="row\s+clm0+6">([\s\S]*?)(?=<div\s+class="row(?:\s+clm0[^6]|\s+clm04| ")|<footer)/gi)];

  const searchArea = colorSections.map(m => m[1]).join('\n');
  if (!searchArea) return colors;

  // Each color is a col-sm-6 OR col-sm-12 block containing:
  //   <p><img src="..." alt="..."></p>
  //   <p class="txt">N. カラー名\nEnglish Name</p>
  const blocks = [...searchArea.matchAll(/<div\s+class="col-sm-(?:6|12)">\s*<div\s+class="bs-grid-block">\s*<div\s+class="content">\s*([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)];

  for (const [, blockHtml] of blocks) {
    // Extract image URL
    const imgMatch = blockHtml.match(/<img\s+src="([^"]+)"/i);
    if (!imgMatch) continue;

    // Extract color name from <p class="txt">
    const txtMatch = blockHtml.match(/<p\s+class="txt">([\s\S]*?)<\/p>/i);
    if (!txtMatch) continue;

    const txtContent = stripTags(txtMatch[1]);
    // Format: "1. ホロ シルバー\nMH.Silver" — take the Japanese line (first)
    const firstLine = txtContent.split('\n')[0].trim();
    // Remove leading number: "1. ホロ シルバー" → "ホロ シルバー"
    const colorName = firstLine.replace(/^\d+\.\s*/, '').trim();

    if (!colorName || seen.has(colorName)) continue;
    seen.add(colorName);

    let imgUrl = imgMatch[1];
    // Remove query params like ?date=20200928
    imgUrl = imgUrl.split('?')[0];
    if (!imgUrl.startsWith('http')) {
      imgUrl = `${SITE_BASE}/${imgUrl}`;
    }

    colors.push({ name: colorName, imageUrl: imgUrl });
  }

  return colors;
}

// ---------------------------------------------------------------------------
// Scraping: parse description
// ---------------------------------------------------------------------------

function parseDescription(html: string): string {
  // Description is in the clm03 div, inside <p class="txt">...</p>
  const clm03Match = html.match(/<div\s+class="content\s+clm03">([\s\S]*?)<\/div>/i);
  if (!clm03Match) return '';

  // Get the main Japanese description paragraph
  const txtMatch = clm03Match[1].match(/<p\s+class="txt">([\s\S]*?)<\/p>/i);
  if (txtMatch) {
    const desc = stripTags(txtMatch[1]).replace(/\n/g, ' ').trim();
    if (desc.length > 500) return desc.substring(0, 500);
    return desc;
  }

  // Fallback: try intro paragraph from clm01
  const clm01Match = html.match(/<div\s+class="content\s+clm01">([\s\S]*?)<\/div>/i);
  if (clm01Match) {
    // Get Japanese paragraphs (not .m-eng class)
    const jpParagraphs = [...clm01Match[1].matchAll(/<p(?!\s+class="m-eng")[^>]*>([\s\S]*?)<\/p>/gi)];
    const desc = jpParagraphs.map(m => stripTags(m[1])).filter(t => t.length > 10).join(' ').trim();
    if (desc.length > 500) return desc.substring(0, 500);
    return desc;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Scraping: parse main image
// ---------------------------------------------------------------------------

function parseMainImage(html: string): string | null {
  // Main product image in clm03 section: <p class="rodImg"><img src="...">
  const rodImgMatch = html.match(/<p\s+class="rodImg">\s*<img\s+src="([^"]+)"/i);
  if (rodImgMatch) {
    const src = rodImgMatch[1].split('?')[0];
    return src.startsWith('http') ? src : `${SITE_BASE}/${src}`;
  }

  // Fallback: top photo in clm02
  const clm02Match = html.match(/<div\s+class="content\s+clm02">\s*<img\s+src="([^"]+)"/i);
  if (clm02Match) {
    const src = clm02Match[1].split('?')[0];
    return src.startsWith('http') ? src : `${SITE_BASE}/${src}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scrape one product page
// ---------------------------------------------------------------------------

async function scrapeProduct(product: ProductDef): Promise<ScrapedProduct> {
  const url = `${SITE_BASE}/${product.page}`;
  const html = await fetchPage(url);

  const weightSpecs = parseWeightSpecs(html);
  const colors = parseColorChart(html);
  const description = parseDescription(html);
  const mainImageUrl = parseMainImage(html);

  return {
    name: product.name,
    slug: product.slug,
    type: product.type,
    targetFish: product.targetFish,
    description,
    weightSpecs,
    colors,
    mainImageUrl,
    sourceUrl: url,
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

  log('========================================');
  log(`HOTS Pipeline Start — ${PRODUCTS.length} products`);
  log('========================================');

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
      const scraped = await scrapeProduct(product);
      totalProducts++;

      log(`  Weights: ${scraped.weightSpecs.length}, Colors: ${scraped.colors.length}`);
      if (scraped.weightSpecs.length > 0) {
        log(`  Specs: ${scraped.weightSpecs.map(s => `${s.weight}g/${s.length ? s.length + 'mm' : '-'}/${s.price}円`).join(', ')}`);
      }
      if (scraped.colors.length > 0) {
        log(`  Colors: ${scraped.colors.map(c => c.name).join(', ')}`);
      }

      if (scraped.weightSpecs.length === 0) {
        logError(`  No weight specs found — skipping`);
        errorCount++;
        continue;
      }

      if (scraped.colors.length === 0) {
        logError(`  No colors found — skipping`);
        errorCount++;
        continue;
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

      // Upload color images
      const colorImageMap = new Map<string, string>();
      for (const color of scraped.colors) {
        try {
          const safeName = color.name
            .replace(/[^a-zA-Z0-9\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
          const key = `${MANUFACTURER_SLUG}/${scraped.slug}/${safeName || 'color'}.webp`;
          const r2Url = await processAndUploadImage(color.imageUrl, key);
          colorImageMap.set(color.name, r2Url);
          totalImages++;
        } catch (err) {
          logError(`  Color image failed [${color.name}]: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Insert rows: 1 row per color x weight
      let rowsForProduct = 0;
      for (const spec of scraped.weightSpecs) {
        for (const color of scraped.colors) {
          // Check existence
          if (await lureExists(scraped.slug, color.name, spec.weight)) {
            log(`  Skip (exists): ${color.name} ${spec.weight}g`);
            continue;
          }

          // Tax-inclusive price (x1.1, round)
          const taxIncPrice = Math.round(spec.price * 1.1);

          const imageUrl = colorImageMap.get(color.name) || mainR2Url;

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
            length: spec.length,
            weight: spec.weight,
            color_name: color.name,
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

      log(`  Inserted ${rowsForProduct} rows, ${colorImageMap.size}/${scraped.colors.length} color images`);

      // Create Airtable lure record
      if (makerRecordId) {
        try {
          await createAirtableLureRecord(
            scraped.name, scraped.sourceUrl, makerRecordId, '登録完了',
            `${scraped.colors.length}色 x ${scraped.weightSpecs.length}ウェイト = ${rowsForProduct}行`,
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
  log('HOTS Pipeline Summary');
  log('========================================');
  log(`Products: ${totalProducts}/${PRODUCTS.length}`);
  log(`Rows inserted: ${totalRows}`);
  log(`Images uploaded: ${totalImages}`);
  log(`Errors: ${errorCount}`);
  log(`Elapsed: ${elapsed}s`);
  log('========================================');
}

// ---------------------------------------------------------------------------
// Modular ScraperFunction export
// ---------------------------------------------------------------------------

export const scrapeHotsPage: ScraperFunction = async (url: string): Promise<ScrapedLure> => {
  const html = await fetchPage(url);

  // Try to match against known product definitions by page filename
  const pageFile = url.split('/').pop() || '';
  const productDef = PRODUCTS.find(p => p.page === pageFile);

  const weightSpecs = parseWeightSpecs(html);
  const colorChart = parseColorChart(html);
  const description = parseDescription(html);
  const mainImageUrl = parseMainImage(html);

  // Product name: from definition or from HTML
  let name = productDef?.name || '';
  if (!name) {
    // Try extracting from <h2> in the clm03 section
    const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) name = stripTags(h2Match[1]);
    if (!name) {
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) name = stripTags(titleMatch[1]).replace(/\s*[-|]\s*HOTS.*$/i, '').trim();
    }
  }

  const slug = productDef?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const type = productDef?.type || 'メタルジグ';
  const targetFish = productDef?.targetFish || ['マグロ', 'ヒラマサ', 'カンパチ', 'ブリ'];

  const colors = colorChart.map(c => ({ name: c.name, imageUrl: c.imageUrl }));
  const weights = weightSpecs.map(s => s.weight);
  const price = weightSpecs.length > 0 ? Math.round(weightSpecs[0].price * 1.1) : 0;
  const lengths = weightSpecs.map(s => s.length).filter((l): l is number => l !== null);
  const length = lengths.length > 0 ? lengths[0] : null;

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

// Only run main() when this file is executed directly, not when imported
const isDirectRun = process.argv[1]?.includes('/scrapers/hots');
if (isDirectRun) {
  main().catch(err => {
    logError(`Unhandled: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
