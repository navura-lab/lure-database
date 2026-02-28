// scripts/scrapers/carpenter.ts
// Carpenter (carpenter.ne.jp) — 100% static HTML, dual encoding (Shift_JIS / UTF-8)
// Products: casting lures (pencils, poppers, sinking pencils) + metal jigs
// No individual colour data → "スタンダード" with main product image
// No price data on product pages → price = null

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

// ===========================================================================
// Constants
// ===========================================================================

const MANUFACTURER = 'Carpenter';
const MANUFACTURER_SLUG = 'carpenter';
const SITE_BASE = 'http://www.carpenter.ne.jp';
const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

// ===========================================================================
// Types
// ===========================================================================

interface SizeVariant {
  model: string;   // e.g. "BF45-150", "γ60-180", "ノーマル"
  weight: number;  // grams
  length: number;  // mm
}

interface ProductDef {
  name: string;
  nameKana: string;
  slug: string;
  type: string;
  targetFish: string[];
  pageUrl: string;
  specMode: 'table' | 'inline' | 'jig-group';
  sizeListUrl?: string;
  jigPages?: { url: string }[];
}

// ===========================================================================
// Product definitions (25 pages → 21 products)
// ===========================================================================

const PRODUCTS: ProductDef[] = [
  // ──── ペンシル ────
  {
    name: 'Blue Fish',
    nameKana: 'ブルーフィッシュ',
    slug: 'blue-fish',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'ブリ'],
    pageUrl: `${SITE_BASE}/product.index-lure-blue.fish/product.index-lure-blue.fish.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-blue.fish-size.ichiran/product.index-lure-blue.fish-size.ichiran.html`,
  },
  {
    name: 'Gamma',
    nameKana: 'ガンマ',
    slug: 'gamma',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/product.index-lure-gamma-n/product.index-lure-gamma-n.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-gamma-n-size.ichiran/product.index-lure-gamma-n-size.ichiran.html`,
  },
  {
    name: 'Gamma Super-L',
    nameKana: 'ガンマスーパーエル',
    slug: 'gamma-super-l',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/product.index-lure-gamma-super-l/product.index-lure-gamma-super-l.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-gamma-super-l-size.ichiran/product.index-lure-gamma-l-size.ichiran.html`,
  },
  {
    name: 'Gamma-L',
    nameKana: 'ガンマエル',
    slug: 'gamma-l',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/product.index-lure-gamma-l/product.index-lure-gamma-l.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-gamma-l-size.ichiran/product.index-lure-gamma-l-size.ichiran.html`,
  },
  {
    name: 'Gamma-H',
    nameKana: 'ガンマエイチ',
    slug: 'gamma-h',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/product.index-lure-gamma-h/product.index-lure-gamma-h.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-gamma-h-size.ichiran/product.index-lure-gamma-h-size.ichiran.html`,
  },
  {
    name: 'Maihime',
    nameKana: '舞姫',
    slug: 'maihime',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'ブリ'],
    pageUrl: `${SITE_BASE}/p-l-maihime/p-l-maihime.html`,
    specMode: 'inline',
  },
  {
    name: 'Gen-ei',
    nameKana: '幻影',
    slug: 'genei',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/p-l-genei/p-l-genei.html`,
    specMode: 'inline',
  },
  {
    name: 'Strike Eagle',
    nameKana: 'ストライクイーグル',
    slug: 'strike-eagle',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `https://www.carpenter.ne.jp/p-l-strike.eagle/p-l-strike.eagle.html`,
    specMode: 'inline',
  },
  {
    name: 'Carpenter Hayabusa',
    nameKana: 'カーペンターハヤブサ',
    slug: 'hayabusa',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/p-l-hayabusa/p-l-hayabusa.html`,
    specMode: 'inline',
  },
  // ──── 小型ペンシル ────
  {
    name: 'Mini Eel',
    nameKana: 'ミニイール',
    slug: 'mini-eel',
    type: 'ペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'ブリ'],
    pageUrl: `${SITE_BASE}/p-l-mini.eel/p-l-mini.eel.html`,
    specMode: 'inline',
  },
  // ──── ポッパー ────
  {
    name: 'Utahime',
    nameKana: '歌姫',
    slug: 'utahime',
    type: 'ポッパー',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/p-l-utahime/p-l-utahime.html`,
    specMode: 'inline',
  },
  {
    name: 'BC Popper',
    nameKana: 'ビーシーポッパー',
    slug: 'bc-popper',
    type: 'ポッパー',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/p-l-bcp/p-l-bcp.html`,
    specMode: 'inline',
  },
  {
    name: 'Damsel Original',
    nameKana: 'ダムセルオリジナル',
    slug: 'damsel-original',
    type: 'ポッパー',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/p-l-ds90g-o/p-l-ds90g-o.html`,
    specMode: 'inline',
  },
  {
    name: 'Damsel',
    nameKana: 'ダムセル',
    slug: 'damsel',
    type: 'ポッパー',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/p-l-damsel/p-l-damsel.html`,
    specMode: 'inline',
  },
  // ──── シンキングペンシル ────
  {
    name: 'Pandora',
    nameKana: 'パンドラ',
    slug: 'pandora',
    type: 'シンキングペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/product.index-lure-pandora/product.index-lure-pandora.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-pandora-size.ichiran/product.index-lure-pandora-size.ichiran.html`,
  },
  {
    name: 'Zeus',
    nameKana: 'ゼウス',
    slug: 'zeus',
    type: 'シンキングペンシル',
    targetFish: ['GT', 'マグロ', 'ヒラマサ'],
    pageUrl: `${SITE_BASE}/product.index-lure-zeus/product.index-lure-zeus.html`,
    specMode: 'table',
    sizeListUrl: `${SITE_BASE}/product.index-lure-zeus-size.ichiran/product.index-lure-zeus-size.ichiran.html`,
  },
  // ──── メタルジグ ────
  {
    name: 'Metal Jig 1501',
    nameKana: 'メタルジグ1501',
    slug: 'jig-1501',
    type: 'メタルジグ',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'カンパチ'],
    pageUrl: `${SITE_BASE}/product.index-jig-1501a-150g/product.index-jig-1501a-150g.html`,
    specMode: 'jig-group',
    jigPages: [
      { url: `${SITE_BASE}/product.index-jig-1501a-150g/product.index-jig-1501a-150g.html` },
    ],
  },
  {
    name: 'Metal Jig 1505',
    nameKana: 'メタルジグ1505',
    slug: 'jig-1505',
    type: 'メタルジグ',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'カンパチ'],
    pageUrl: `${SITE_BASE}/product.index-jig-1505a-150g/product.index-jig-1505a-150g.html`,
    specMode: 'jig-group',
    jigPages: [
      { url: `${SITE_BASE}/product.index-jig-1505a-150g/product.index-jig-1505a-150g.html` },
    ],
  },
  {
    name: 'Metal Jig 1506',
    nameKana: 'メタルジグ1506',
    slug: 'jig-1506',
    type: 'メタルジグ',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'カンパチ'],
    pageUrl: `${SITE_BASE}/p-j-1506a-150/p-j-1506a-150.html`,
    specMode: 'jig-group',
    jigPages: [
      { url: `${SITE_BASE}/p-j-1506a-150/p-j-1506a-150.html` },
      { url: `${SITE_BASE}/p-j-1506-200/p-j-1506-200.html` },
    ],
  },
  {
    name: 'Metal Jig 1510',
    nameKana: 'メタルジグ1510',
    slug: 'jig-1510',
    type: 'メタルジグ',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'カンパチ'],
    pageUrl: `${SITE_BASE}/product.index-jig-1510a-150g/product.index-jig-1510a-150g.html`,
    specMode: 'jig-group',
    jigPages: [
      { url: `${SITE_BASE}/product.index-jig-1510a-150g/product.index-jig-1510a-150g.html` },
      { url: `${SITE_BASE}/product.index-jig-1510a-200g/product.index-jig-1510a-200g.html` },
    ],
  },
  {
    name: 'Metal Jig 1514',
    nameKana: 'メタルジグ1514',
    slug: 'jig-1514',
    type: 'メタルジグ',
    targetFish: ['GT', 'マグロ', 'ヒラマサ', 'カンパチ'],
    pageUrl: `${SITE_BASE}/p-j-1514a-150/p-j-1514a-150.html`,
    specMode: 'jig-group',
    jigPages: [
      { url: `${SITE_BASE}/p-j-1514a-150/p-j-1514a-150.html` },
      { url: `${SITE_BASE}/p-j-1514a-225/p-j-1514a-225.html` },
      { url: `${SITE_BASE}/p-j-1514-300/p-j-1514-300.html` },
    ],
  },
];

// ===========================================================================
// Helpers
// ===========================================================================

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] [carpenter] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] [carpenter] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Full-width → half-width conversion (Ａ-Ｚ ０-９ ａ-ｚ and common symbols)
// ---------------------------------------------------------------------------

function fullWidthToHalf(s: string): string {
  return s
    // Ａ-Ｚ (0xFF21–0xFF3A) → A-Z, ａ-ｚ (0xFF41–0xFF5A) → a-z, ０-９ (0xFF10–0xFF19) → 0-9
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    // Common full-width symbols
    .replace(/ｍ/g, 'm').replace(/ｇ/g, 'g')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/／/g, '/').replace(/，/g, ',').replace(/：/g, ':')
    .replace(/　/g, ' ')      // full-width space → half-width space
    .replace(/ー/g, '-')      // katakana long vowel (sometimes used for dash)
    .replace(/～/g, '~');
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>',
  gamma: 'γ', beta: 'β', alpha: 'α', delta: 'δ',
  yen: '¥', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (_m, name) => HTML_ENTITIES[name.toLowerCase()] ?? _m);
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

// ---------------------------------------------------------------------------
// Fetch with encoding detection
// ---------------------------------------------------------------------------

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // Many old Carpenter pages declare charset=Shift_JIS in the meta tag
  // but are actually encoded as UTF-8.  Try UTF-8 first (strict mode);
  // fall back to Shift_JIS only when byte sequences are invalid UTF-8.
  try {
    const td = new TextDecoder('utf-8', { fatal: true });
    return td.decode(buf);
  } catch {
    const td = new TextDecoder('shift_jis', { fatal: false });
    return td.decode(buf);
  }
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

// ===========================================================================
// Spec Extraction — Method 1: size.ichiran TABLE
// ===========================================================================

async function extractSpecsFromTable(sizeListUrl: string): Promise<SizeVariant[]> {
  const html = await fetchPage(sizeListUrl);
  const variants: SizeVariant[] = [];

  // Parse <TR> rows inside <TABLE>
  const rows = [...html.matchAll(/<TR[^>]*>([\s\S]*?)<\/TR>/gi)];
  for (const rowMatch of rows) {
    const cells = [...rowMatch[1].matchAll(/<TD[^>]*>([\s\S]*?)<\/TD>/gi)].map(m => stripTags(m[1]).trim());
    // Expect 4+ columns: [model, length, weight, type] — skip header rows
    if (cells.length < 4) continue;

    const model = fullWidthToHalf(cells[0]).trim();
    const lengthText = fullWidthToHalf(cells[1]);
    const weightText = fullWidthToHalf(cells[2]);
    const type = cells[3];

    // Skip header row
    if (model.includes('モデル') || model.includes('仕様')) continue;
    if (!model) continue;

    // Extract numeric values
    const lengthMatch = lengthText.match(/(\d+)\s*mm/i);
    const weightMatch = weightText.match(/約?\s*(\d+)\s*g/i);

    if (lengthMatch && weightMatch) {
      variants.push({
        model,
        length: parseInt(lengthMatch[1], 10),
        weight: parseInt(weightMatch[1], 10),
      });
    }
  }

  return variants;
}

// ===========================================================================
// Spec Extraction — Method 2: inline text (new-style pages)
// ===========================================================================

function extractSpecsFromInline(html: string): SizeVariant[] {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(b|B|strong|STRONG)>/g, '')
    .replace(/<[^>]+>/g, '');
  const half = fullWidthToHalf(decodeHtmlEntities(text));
  const lines = half.split('\n').map(l => l.trim());

  const variants: SizeVariant[] = [];
  const seen = new Set<string>();

  // ── Pattern A: "name / {len}mm / 約{wt}g / F|S" ──
  // Covers: Maihime, Genei, Damsel, DS90g-O, Utahime, BCP, Hayabusa, Mini Eel
  for (const line of lines) {
    const m = line.match(/^[●]?\s*(.+?)\s*\/\s*(\d+)\s*mm\s*\/\s*約?\s*(\d+)\s*g/);
    if (m) {
      const model = m[1].replace(/^\s*/, '').trim();
      const length = parseInt(m[2], 10);
      const weight = parseInt(m[3], 10);
      const key = `${weight}-${length}`;
      if (!seen.has(key) && weight > 0 && length > 0) {
        seen.add(key);
        variants.push({ model, length, weight });
      }
    }
  }

  // ── Pattern B: Strike Eagle style — sequential "全長" + "重量" pairs ──
  // Always try, regardless of Pattern A results (Strike Eagle has BOTH formats)
  {
    let currentLength = 0;
    let currentModel = '';
    for (const line of lines) {
      // Model header: "■SE75 仕様" or "■SE150"
      const modelHeader = line.match(/^■(.+?)(?:\s+仕様)?$/);
      if (modelHeader) {
        currentModel = modelHeader[1].trim();
        continue;
      }
      // Sub-type: "●ノーマル", "●L-Quiet" etc.
      const subType = line.match(/^●(.+)/);
      if (subType && !subType[1].match(/\d+\s*mm/)) {
        // Just a type name, not a spec line → use as model suffix
        currentModel = currentModel.replace(/\s+.+$/, '') + ' ' + subType[1].trim();
        continue;
      }
      // Length line: "全長 約195mm (196mm)"
      const lenMatch = line.match(/全長\s*約?\s*(\d+)\s*mm/);
      if (lenMatch) {
        currentLength = parseInt(lenMatch[1], 10);
        continue;
      }
      // Weight line: "重量 約75g"
      const wtMatch = line.match(/重量\s*約?\s*(\d+)\s*g/);
      if (wtMatch && currentLength > 0) {
        const weight = parseInt(wtMatch[1], 10);
        const key = `${weight}-${currentLength}`;
        if (!seen.has(key) && weight > 0) {
          seen.add(key);
          variants.push({ model: currentModel, length: currentLength, weight });
        }
      }
    }
  }

  // ── Pattern C: "●name/ {len}mm/ 約{wt}g" (compact, no spaces around /) ──
  {
    for (const line of lines) {
      const m = line.match(/●\s*(.+?)\s*\/\s*(\d+)\s*mm\s*\/\s*約?\s*(\d+)\s*g/);
      if (m) {
        const model = m[1].trim();
        const length = parseInt(m[2], 10);
        const weight = parseInt(m[3], 10);
        const key = `${weight}-${length}`;
        if (!seen.has(key) && weight > 0 && length > 0) {
          seen.add(key);
          variants.push({ model, length, weight });
        }
      }
    }
  }

  return variants;
}

// ===========================================================================
// Spec Extraction — Method 3: jig pages (全長 + 表示重量)
// ===========================================================================

async function extractJigVariants(jigPages: { url: string }[]): Promise<SizeVariant[]> {
  const variants: SizeVariant[] = [];

  for (const page of jigPages) {
    log(`    Fetching jig page: ${page.url}`);
    const html = await fetchPage(page.url);
    const text = fullWidthToHalf(stripTags(html));

    const lenMatch = text.match(/全長\s*約?\s*(\d+)\s*mm/);
    const wtMatch = text.match(/表示重量[※]?\s*(\d+)\s*g/);

    if (wtMatch) {
      const weight = parseInt(wtMatch[1], 10);
      const length = lenMatch ? parseInt(lenMatch[1], 10) : 0;
      log(`    → Weight: ${weight}g, Length: ${length}mm`);
      variants.push({ model: `${weight}g`, weight, length: length || 0 });
    } else {
      // Fallback: extract weight from URL pattern (/...-150g/ or /...-150/)
      const urlWt = page.url.match(/[-_](\d+)(?:g)?(?:\/|\.html)/);
      if (urlWt) {
        const weight = parseInt(urlWt[1], 10);
        const length = lenMatch ? parseInt(lenMatch[1], 10) : 0;
        log(`    → Weight from URL fallback: ${weight}g, Length: ${length}mm`);
        variants.push({ model: `${weight}g`, weight, length: length || 0 });
      } else {
        log(`    → No weight found!`);
      }
    }

    await sleep(500);
  }

  return variants;
}

// ===========================================================================
// Image extraction — first product image (skip logo.gif)
// ===========================================================================

function extractMainImageUrl(html: string, pageUrl: string): string | null {
  const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/gi)];
  for (const m of imgs) {
    const src = m[1];
    // Skip navigation/logos
    if (src.includes('logo.gif') || src.includes('mark') || src.includes('!mark')) continue;
    // Skip tiny icons
    if (src.includes('button') || src.includes('nav') || src.includes('arrow')) continue;

    // Resolve URL
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    // Relative path — resolve from page URL
    const base = pageUrl.substring(0, pageUrl.lastIndexOf('/') + 1);
    if (src.startsWith('../')) {
      // Go up one directory
      const parentBase = base.replace(/[^/]+\/$/, '');
      return parentBase + src.substring(3);
    }
    return base + src;
  }
  return null;
}

// ===========================================================================
// Description extraction
// ===========================================================================

function extractDescription(html: string): string {
  const text = stripTags(html);
  const half = fullWidthToHalf(text);

  // Find concept/description section
  const conceptMatch = half.match(/■コンセプト\s*\n+([\s\S]{30,500}?)(?:\n\s*\n|\n■)/);
  if (conceptMatch) {
    return conceptMatch[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
  }

  // Fallback: find the first substantial paragraph after the product name
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 30);
  for (const line of lines) {
    // Skip spec lines, copyright, etc.
    if (line.includes('※') || line.includes('Copyright') || line.includes('全長') || line.includes('重量')) continue;
    if (line.includes('仕様') || line.includes('フック') || line.includes('リング')) continue;
    return line.substring(0, 300);
  }

  return '';
}

// ===========================================================================
// Main pipeline
// ===========================================================================

async function main(): Promise<void> {
  const t0 = Date.now();
  let totalProducts = 0;
  let totalScraped = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  let totalImages = 0;
  let totalErrors = 0;

  log(`Starting CARPENTER scraper — ${PRODUCTS.length} products to process`);

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
        'URL': 'https://www.carpenter.ne.jp',
        'ステータス': 'スクレイピング中',
      });
      log(`Created Airtable maker record: ${makerRecordId}`);
    }
  } catch (e) {
    logError(`Airtable maker registration: ${e}`);
  }

  // 2) Process each product
  for (let i = 0; i < PRODUCTS.length; i++) {
    const product = PRODUCTS[i];
    totalProducts++;
    log(`\n--- [${i + 1}/${PRODUCTS.length}] ${product.name} (${product.slug}) ---`);

    let variants: SizeVariant[] = [];

    try {
      // Extract specs based on mode
      switch (product.specMode) {
        case 'table':
          if (product.sizeListUrl) {
            variants = await extractSpecsFromTable(product.sizeListUrl);
          }
          break;
        case 'inline': {
          const html = await fetchPage(product.pageUrl);
          variants = extractSpecsFromInline(html);
          break;
        }
        case 'jig-group':
          if (product.jigPages) {
            variants = await extractJigVariants(product.jigPages);
          }
          break;
      }
    } catch (e) {
      logError(`Spec extraction failed: ${e}`);
      totalErrors++;
      await sleep(500);
      continue;
    }

    if (variants.length === 0) {
      log(`  No size variants found — skipping`);
      totalSkipped++;
      await sleep(500);
      continue;
    }

    log(`  Found ${variants.length} size variants`);
    for (const v of variants) {
      log(`    ${v.model}: ${v.length}mm / ${v.weight}g`);
    }

    // Fetch main page for image + description
    let mainImageUrl: string | null = null;
    let description = '';
    try {
      const pageHtml = await fetchPage(product.pageUrl);
      mainImageUrl = extractMainImageUrl(pageHtml, product.pageUrl);
      description = extractDescription(pageHtml);
    } catch (e) {
      logError(`Main page fetch failed: ${e}`);
    }

    // Upload main image
    let r2ImageUrl = '';
    if (mainImageUrl) {
      try {
        const r2Key = `${MANUFACTURER_SLUG}/${product.slug}/0.webp`;
        r2ImageUrl = await processAndUploadImage(mainImageUrl, r2Key);
        log(`  Image uploaded: ${r2Key}`);
        totalImages++;
      } catch (e) {
        logError(`  Image upload failed: ${e}`);
        totalErrors++;
      }
    } else {
      log(`  No main image found`);
    }

    // Insert rows: 1 colour ("スタンダード") × N size variants
    let insertedForProduct = 0;
    const colorName = 'スタンダード';

    for (const variant of variants) {
      try {
        const exists = await lureExists(product.slug, colorName, variant.weight);
        if (exists) {
          log(`  Skip existing: ${variant.weight}g`);
          continue;
        }

        await insertLure({
          manufacturer: MANUFACTURER,
          manufacturer_slug: MANUFACTURER_SLUG,
          name: product.name,
          slug: product.slug,
          type: product.type,
          color_name: colorName,
          weight: variant.weight,
          length: variant.length > 0 ? variant.length : null,
          price: null,
          images: r2ImageUrl ? [r2ImageUrl] : null,
          description: description || null,
          target_fish: product.targetFish,
          is_limited: false,
          is_discontinued: false,
        });
        insertedForProduct++;
      } catch (e) {
        logError(`  Insert failed (${variant.weight}g): ${e}`);
        totalErrors++;
      }
    }

    totalInserted += insertedForProduct;
    totalScraped++;
    log(`  Inserted ${insertedForProduct} rows (1色 x ${variants.length}サイズ)`);

    // Register in Airtable
    if (makerRecordId) {
      try {
        await airtableCreateRecord(AIRTABLE_LURE_URL_TABLE_ID, {
          'ルアー名': product.name,
          'URL': product.pageUrl,
          'メーカー': [makerRecordId],
          'ステータス': '登録完了',
          '備考': `1色 x ${variants.length}サイズ = ${insertedForProduct}行`,
        });
      } catch (e) {
        logError(`  Airtable record failed: ${(e as Error).message}`);
      }
    }

    await sleep(1000);
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
  log(`Products skipped (no data): ${totalSkipped}`);
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
