// scripts/pipeline.ts
// Main scraping pipeline: Airtable -> Scrape -> R2 -> Supabase -> Vercel deploy

import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  R2_ENDPOINT,
  R2_BUCKET,
  R2_PUBLIC_URL,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_REGION,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID,
  AIRTABLE_MAKER_TABLE_ID,
  AIRTABLE_API_BASE,
  VERCEL_DEPLOY_HOOK,
  PAGE_LOAD_DELAY_MS,
  IMAGE_WIDTH,
} from './config.js';
import { getScraper, getRegisteredManufacturers, type ScrapedLure } from './scrapers/index.js';
import { normalizeType } from './lib/normalize-type.js';
import { parseRegionArg, makeRegionFilter, isUSMaker, type Region } from './lib/regions.js';
import { slugify } from '../src/lib/slugify.js';
import { isNonLureProduct } from '../src/lib/fish-type-validation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AirtableLureRecord {
  id: string;
  fields: {
    'ルアー名': string;
    'URL': string;
    'メーカー': string[];   // linked record IDs
    'ステータス': string;
    '備考'?: string;
  };
}

interface AirtableMakerRecord {
  id: string;
  fields: {
    'メーカー名': string;
    'URL'?: string;
    'Slug': string;
  };
}

interface PipelineResult {
  recordId: string;
  lureName: string;
  status: 'success' | 'error';
  message: string;
  colorsProcessed: number;
  colorsWithImage: number;
  rowsInserted: number;
  /** 新規追加されたルアーのパス（manufacturer_slug/slug） */
  lurePath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] [pipeline] ${message}`);
}

function logError(message: string): void {
  console.error(`[${timestamp()}] [pipeline] ERROR: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 画像URLがR2 CDNの正しい形式かどうかを検証する。
 * R2形式でないURL（外部HTTP/HTTPS、パスのみ等）をDBに保存しない。
 */
function isValidR2ImageUrl(url: string): boolean {
  return url.startsWith(R2_PUBLIC_URL + '/');
}

/**
 * images配列をサニタイズ。
 * - R2 CDN URLのみ許可、外部URLはnullに置換してログ警告
 * - パスのみのURLはR2フルURLに補完
 */
function sanitizeImageUrls(images: string[] | null): string[] | null {
  if (!images || images.length === 0) return null;

  const sanitized: string[] = [];
  for (const url of images) {
    if (!url) continue;

    // パスのみの場合はR2フルURLに補完
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const cleanPath = url.startsWith('/') ? url.slice(1) : url;
      const fullUrl = `${R2_PUBLIC_URL}/${cleanPath}`;
      log(`⚠️  画像URL補完: ${url} → ${fullUrl}`);
      sanitized.push(fullUrl);
      continue;
    }

    // R2 CDN URLならOK
    if (isValidR2ImageUrl(url)) {
      sanitized.push(url);
      continue;
    }

    // 外部URL → 警告して除外（mixed contentやリンク切れを防止）
    log(`⚠️  外部画像URLを除外（R2未アップロード）: ${url}`);
  }

  return sanitized.length > 0 ? sanitized : null;
}

// ---------------------------------------------------------------------------
// R2 (S3-compatible) client
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Download an image from a URL, resize to IMAGE_WIDTH, convert to WebP,
 * then upload to R2. Returns the public URL.
 */
async function processAndUploadImage(
  imageUrl: string,
  r2Key: string,
): Promise<string> {
  log(`Downloading image: ${imageUrl}`);
  // Shimano CDN (dassets2.shimano.com) blocks requests without proper headers.
  // Other CDNs are generally fine, but adding headers doesn't hurt.
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  if (imageUrl.includes('shimano.com')) {
    fetchHeaders['Referer'] = 'https://fish.shimano.com/';
  }
  const response = await fetch(imageUrl, { headers: fetchHeaders });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText} for ${imageUrl}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  log(`Processing image -> WebP (width: ${IMAGE_WIDTH}px)`);
  const webpBuffer = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // プレースホルダー画像の検出: 5KB未満の画像はロゴ/空画像の可能性が高い
  const MIN_IMAGE_SIZE_BYTES = 5000;
  if (webpBuffer.length < MIN_IMAGE_SIZE_BYTES) {
    log(`⚠️  画像が小さすぎます (${webpBuffer.length} bytes < ${MIN_IMAGE_SIZE_BYTES}): ${imageUrl} → スキップ`);
    throw new Error(`Image too small after processing (${webpBuffer.length} bytes): likely a placeholder or logo image`);
  }

  log(`Uploading to R2: ${r2Key} (${(webpBuffer.length / 1024).toFixed(1)} KB)`);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: webpBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;

  // アップロード後の検証: HEADリクエストで確認、404なら1回リトライ
  const MAX_VERIFY_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES; attempt++) {
    // R2の反映に少し時間がかかる場合がある
    await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 2000));
    try {
      const verifyRes = await fetch(publicUrl, { method: 'HEAD' });
      if (verifyRes.ok) {
        log(`Verified: ${publicUrl}`);
        return publicUrl;
      }
      if (attempt < MAX_VERIFY_RETRIES) {
        log(`⚠️  アップロード検証失敗 (HTTP ${verifyRes.status})、リトライ中... (${attempt + 1}/${MAX_VERIFY_RETRIES})`);
        // 再アップロード
        await s3.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: r2Key,
            Body: webpBuffer,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } else {
        throw new Error(`R2 upload verification failed after ${MAX_VERIFY_RETRIES + 1} attempts: ${publicUrl} returned HTTP ${verifyRes.status}`);
      }
    } catch (verifyErr) {
      if (attempt >= MAX_VERIFY_RETRIES) {
        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        throw new Error(`R2 upload verification error: ${msg}`);
      }
      log(`⚠️  検証リクエスト失敗、リトライ中...`);
    }
  }

  // ここに到達することはないが型安全のため
  return publicUrl;
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch<T>(
  tableId: string,
  path: string = '',
  options: RequestInit = {},
): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch all "未処理" records from the ルアーURL table.
 * Handles Airtable's 100-record pagination automatically.
 */
async function fetchPendingRecords(): Promise<AirtableLureRecord[]> {
  log('Fetching pending records from Airtable...');
  const allRecords: AirtableLureRecord[] = [];
  let offset: string | undefined;

  do {
    const filterFormula = encodeURIComponent("{ステータス}='未処理'");
    let query = `?filterByFormula=${filterFormula}`;
    if (offset) query += `&offset=${encodeURIComponent(offset)}`;

    const data = await airtableFetch<{
      records: AirtableLureRecord[];
      offset?: string;
    }>(AIRTABLE_LURE_URL_TABLE_ID, query);

    allRecords.push(...data.records);
    offset = data.offset;

    if (offset) {
      log(`  Fetched ${allRecords.length} records so far, loading next page...`);
      await sleep(200); // Airtable rate limit
    }
  } while (offset);

  log(`Found ${allRecords.length} pending record(s)`);
  return allRecords;
}

// Cache maker records to avoid redundant API calls
const makerCache = new Map<string, AirtableMakerRecord>();

/**
 * Fetch a maker record by ID from the メーカー table.
 * Results are cached in-memory for the pipeline run.
 */
async function fetchMakerRecord(recordId: string): Promise<AirtableMakerRecord> {
  const cached = makerCache.get(recordId);
  if (cached) {
    log(`Maker (cached): ${cached.fields['メーカー名']} (slug: ${cached.fields['Slug']})`);
    return cached;
  }

  log(`Fetching maker record: ${recordId}`);
  const data = await airtableFetch<AirtableMakerRecord>(
    AIRTABLE_MAKER_TABLE_ID,
    `/${recordId}`,
  );
  log(`Maker: ${data.fields['メーカー名']} (slug: ${data.fields['Slug']})`);
  makerCache.set(recordId, data);
  return data;
}

/**
 * Update a record's status (and optionally 備考) in Airtable.
 */
async function updateAirtableStatus(
  recordId: string,
  status: string,
  note?: string,
): Promise<void> {
  log(`Updating Airtable record ${recordId} -> status: ${status}`);
  const fields: Record<string, string> = { 'ステータス': status };
  if (note !== undefined) {
    fields['備考'] = note;
  }
  await airtableFetch(
    AIRTABLE_LURE_URL_TABLE_ID,
    `/${recordId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    },
  );
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

/**
 * Check if a lure record already exists in Supabase by slug + color_name + weight.
 */
async function lureExists(
  slug: string,
  colorName: string,
  weight: number | null,
): Promise<boolean> {
  let queryParams = `slug=eq.${encodeURIComponent(slug)}&color_name=eq.${encodeURIComponent(colorName)}`;
  if (weight !== null) {
    queryParams += `&weight=eq.${weight}`;
  } else {
    queryParams += '&weight=is.null';
  }
  queryParams += '&select=id&limit=1';

  const url = `${SUPABASE_URL}/rest/v1/lures?${queryParams}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase query error ${res.status}: ${body}`);
  }
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

/**
 * Insert a single lure row into Supabase.
 */
// 挿入前バリデーション
import { validateLureData } from './lib/data-validator';

// Phase 6 ガードレール: パイプライン完了時の検証結果を蓄積
const pipelineValidationLog: Array<{ slug: string; manufacturer: string; category: string; message: string }> = [];

async function insertLure(row: Record<string, unknown>): Promise<void> {
  // Phase 6: target_fish自動判定ガードレール
  // type×target_fishルール違反の場合、target_fishを空にしてwarning
  const issues = validateLureData(row as any);
  const typeFishIssues = issues.filter(i => i.category === 'invalid-type-fish' || i.category === 'weight-fish-mismatch');
  if (typeFishIssues.length > 0) {
    for (const issue of typeFishIssues) {
      console.warn(`[Phase6 GUARDRAIL] ${row.slug}: ${issue.message}`);
      pipelineValidationLog.push({
        slug: row.slug as string,
        manufacturer: (row.manufacturer_slug as string) || '',
        category: issue.category,
        message: issue.message,
      });
    }
    // ルール違反のtarget_fishを空にする（AIが推測で決めた対象魚を信用しない）
    row.target_fish = null;
    log(`⚠️ target_fish cleared for ${row.slug} due to type-fish rule violation`);
  }

  // 品質ゲート: 挿入前にバリデーション（再実行: target_fishクリア後の状態で）
  const finalIssues = typeFishIssues.length > 0 ? validateLureData(row as any) : issues;
  const errors = finalIssues.filter(i => i.severity === 'error');
  if (errors.length > 0) {
    console.warn(`[QC BLOCKED] ${row.slug}: ${errors.map(e => e.message).join(', ')}`);
    return; // 挿入しない
  }
  const warnings = finalIssues.filter(i => i.severity === 'warning');
  if (warnings.length > 0) {
    console.warn(`[QC WARN] ${row.slug}: ${warnings.map(w => w.category).join(', ')}`);
  }

  const url = `${SUPABASE_URL}/rest/v1/lures`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert error ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Vercel deploy
// ---------------------------------------------------------------------------

async function triggerVercelDeploy(maxRetries = 3): Promise<void> {
  log('Triggering Vercel deploy...');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(VERCEL_DEPLOY_HOOK, { method: 'POST' });
      if (res.ok) {
        log('Vercel deploy triggered successfully');
        return;
      }

      if (res.status === 429) {
        // Rate limited — wait and retry with exponential backoff
        const waitMs = attempt * 10000; // 10s, 20s, 30s
        log(`Vercel deploy hook rate limited (429). Retry ${attempt}/${maxRetries} in ${waitMs / 1000}s...`);
        await sleep(waitMs);
        continue;
      }

      logError(`Vercel deploy hook failed: ${res.status} (attempt ${attempt}/${maxRetries})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`Vercel deploy hook error: ${errMsg} (attempt ${attempt}/${maxRetries})`);
    }

    if (attempt < maxRetries) {
      await sleep(5000);
    }
  }

  logError('Vercel deploy hook failed after all retries — deploy manually if needed');
}

// ---------------------------------------------------------------------------
// Process a single record
// ---------------------------------------------------------------------------

async function processRecord(
  record: AirtableLureRecord,
): Promise<PipelineResult> {
  const recordId = record.id;
  const lureName = record.fields['ルアー名'] || '(unknown)';
  const url = record.fields['URL'] || '';
  const makerIds = record.fields['メーカー'] || [];

  log(`=== Processing: ${lureName} (${url}) ===`);

  if (!url) {
    const msg = 'No URL found in record';
    logError(msg);
    await updateAirtableStatus(recordId, 'エラー', msg);
    return { recordId, lureName, status: 'error', message: msg, colorsProcessed: 0, colorsWithImage: 0, rowsInserted: 0 };
  }

  // Update to 処理中
  await updateAirtableStatus(recordId, '処理中');

  try {
    // Fetch manufacturer info
    let manufacturerName = 'BlueBlueFishing';
    let manufacturerSlug = 'blueblue';

    if (makerIds.length > 0) {
      const maker = await fetchMakerRecord(makerIds[0]);
      manufacturerName = maker.fields['メーカー名'] || manufacturerName;
      manufacturerSlug = maker.fields['Slug'] || manufacturerSlug;
    }

    // Scrape the page using the appropriate manufacturer scraper
    const scraper = getScraper(manufacturerSlug);
    if (!scraper) {
      const supported = getRegisteredManufacturers().join(', ');
      throw new Error(`No scraper registered for manufacturer "${manufacturerSlug}". Supported: ${supported}`);
    }
    const scraped: ScrapedLure = await scraper(url);

    // Override manufacturer info from Airtable (more reliable)
    scraped.manufacturer = manufacturerName;
    scraped.manufacturer_slug = manufacturerSlug;

    // 非ルアー商品の除外（Shopifyブランドが返す '__non_lure__' を検出）
    if (scraped.type === '__non_lure__') {
      const msg = `非ルアー商品をスキップ: ${scraped.name} (${manufacturerSlug})`;
      log(`⏭️ ${msg}`);
      await updateAirtableStatus(recordId, 'エラー', msg);
      return { recordId, lureName, status: 'error', message: msg, colorsProcessed: 0, colorsWithImage: 0, rowsInserted: 0 };
    }

    // 品質ゲート: 名前パターンによる非ルアー製品チェック（全パイプライン共通）
    if (isNonLureProduct(scraped.name, scraped.slug)) {
      const msg = `[品質ゲート] 非ルアー製品をスキップ: ${scraped.name} (${manufacturerSlug})`;
      log(`⏭️ ${msg}`);
      await updateAirtableStatus(recordId, 'エラー', msg);
      return { recordId, lureName, status: 'error', message: msg, colorsProcessed: 0, colorsWithImage: 0, rowsInserted: 0 };
    }

    // Normalize type to canonical 33 types (prevents scraper drift)
    scraped.type = normalizeType(scraped.type);

    // USメーカーで type='その他' の場合はスキップ（非ルアー商品の可能性が高い）
    if (scraped.type === 'その他' && isUSMaker(manufacturerSlug)) {
      const msg = `USメーカーの未分類商品をスキップ: ${scraped.name} (type=その他)`;
      log(`⏭️ ${msg}`);
      await updateAirtableStatus(recordId, 'エラー', msg);
      return { recordId, lureName, status: 'error', message: msg, colorsProcessed: 0, colorsWithImage: 0, rowsInserted: 0 };
    }

    log(`Scraped: ${scraped.name}, ${scraped.colors.length} colors, ${scraped.weights.length} weights, price: ${scraped.price}`);

    // Fallback: if no colors were extracted, create a default entry using mainImage
    if (scraped.colors.length === 0) {
      log(`No colors extracted — creating default color entry`);
      scraped.colors = [{ name: '(default)', imageUrl: scraped.mainImage || '' }];
    }

    // Process and upload color images to R2
    const colorImageMap = new Map<string, string>(); // colorName -> r2 public URL

    for (let i = 0; i < scraped.colors.length; i++) {
      const color = scraped.colors[i];
      if (!color.imageUrl) {
        log(`Skipping color ${i} (${color.name}): no image URL`);
        continue;
      }

      try {
        // カラー名ベースのR2キー（Shopifyカラーバリアント統合で同一slugに
        // 複数処理ラウンドが走っても上書きされない）
        const colorSlug = slugify(color.name).substring(0, 40)
          || String(i + 1).padStart(2, '0');
        const r2Key = `${manufacturerSlug}/${scraped.slug}/${colorSlug}.webp`;
        const publicUrl = await processAndUploadImage(color.imageUrl, r2Key);
        colorImageMap.set(color.name, publicUrl);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`Failed to process image for color ${color.name}: ${errMsg}`);
        // Continue with other colors
      }
    }

    log(`Uploaded ${colorImageMap.size} color images to R2`);

    // Determine the weight list.
    // If no weights found, use [null] to still create one row per color.
    const weights: (number | null)[] = scraped.weights.length > 0
      ? scraped.weights
      : [null];

    // weightSpecsマップ（ウェイトごとのprice/length対応）
    const weightSpecMap = new Map<number, { length: number | null; price: number; model?: string }>();
    if (scraped.weightSpecs) {
      for (const ws of scraped.weightSpecs) {
        weightSpecMap.set(ws.weight, { length: ws.length, price: ws.price, model: ws.model });
      }
    }

    // Insert into Supabase: one row per color x weight combination
    let rowsInserted = 0;

    for (const color of scraped.colors) {
      for (const weight of weights) {
        // Check if exists
        const exists = await lureExists(scraped.slug, color.name, weight);
        if (exists) {
          log(`Skipping existing: ${scraped.slug} / ${color.name} / ${weight}g`);
          continue;
        }

        const imageUrl = colorImageMap.get(color.name) || null;

        // weightSpecsがある場合、ウェイトに対応するprice/lengthを使用
        const spec = weight !== null ? weightSpecMap.get(weight) : undefined;
        const rowPrice = spec?.price || scraped.price;
        const rowLength = spec?.length ?? scraped.length;

        const row: Record<string, unknown> = {
          name: scraped.name,
          name_kana: scraped.name_kana || scraped.name,
          slug: scraped.slug,
          manufacturer: manufacturerName,
          manufacturer_slug: manufacturerSlug,
          type: scraped.type,
          target_fish: scraped.target_fish?.length ? scraped.target_fish : null,
          price: rowPrice,
          description: scraped.description || null,
          images: sanitizeImageUrls(imageUrl ? [imageUrl] : null),
          color_name: color.name,
          weight: weight,
          length: rowLength,
          source_url: scraped.sourceUrl || url,
          is_limited: false,
          is_discontinued: false,
        };

        try {
          await insertLure(row);
          rowsInserted++;
          log(`Inserted: ${scraped.name} / ${color.name} / ${weight !== null ? weight + 'g' : 'N/A'}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError(`Failed to insert row: ${errMsg}`);
        }
      }
    }

    log(`Inserted ${rowsInserted} rows for ${scraped.name}`);

    // If 0 rows inserted, mark as error (scraper likely returned insufficient data)
    if (rowsInserted === 0) {
      const msg = `0行挿入: ${scraped.colors.length}色 x ${weights.length}ウェイト (全て既存 or 挿入失敗)`;
      logError(msg);
      await updateAirtableStatus(recordId, 'エラー', msg);
      return { recordId, lureName, status: 'error', message: msg, colorsProcessed: scraped.colors.length, colorsWithImage: colorImageMap.size, rowsInserted: 0 };
    }

    // Update Airtable to 登録完了
    await updateAirtableStatus(recordId, '登録完了', `${scraped.colors.length}色 x ${weights.length}ウェイト = ${rowsInserted}行挿入`);

    return {
      recordId,
      lureName,
      status: 'success',
      message: `${scraped.colors.length} colors (${colorImageMap.size} with image), ${rowsInserted} rows inserted`,
      colorsProcessed: scraped.colors.length,
      colorsWithImage: colorImageMap.size,
      rowsInserted,
      lurePath: `${manufacturerSlug}/${scraped.slug}`,
    };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`Failed to process ${lureName}: ${errMsg}`);
    try {
      await updateAirtableStatus(recordId, 'エラー', errMsg.substring(0, 500));
    } catch (statusErr) {
      logError(`Failed to update Airtable status for ${lureName}: ${statusErr instanceof Error ? statusErr.message : String(statusErr)}`);
    }
    return { recordId, lureName, status: 'error', message: errMsg, colorsProcessed: 0, colorsWithImage: 0, rowsInserted: 0 };
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseLimit(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n >= 0) return n;
  }
  return 0; // 0 = 全件処理
}

/**
 * 全未処理レコードのメーカーslugを事前解決し、regionでフィルタする。
 * makerCacheも同時に温まるので、processRecord内の再fetchが不要になる。
 */
async function filterByRegion(
  records: AirtableLureRecord[],
  region: Region,
): Promise<AirtableLureRecord[]> {
  if (region === 'all') return records;

  const regionFilter = makeRegionFilter(region);

  // 全レコードのメーカーIDを収集し、一括キャッシュ
  const uniqueMakerIds = new Set<string>();
  for (const r of records) {
    const ids = r.fields['メーカー'] || [];
    if (ids.length > 0) uniqueMakerIds.add(ids[0]);
  }

  // メーカーレコードを事前fetch（キャッシュに乗る）
  for (const id of uniqueMakerIds) {
    if (!makerCache.has(id)) {
      try {
        await fetchMakerRecord(id);
        await sleep(200); // Airtable rate limit
      } catch (err) {
        logError(`Failed to fetch maker ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // regionでフィルタ
  const filtered: AirtableLureRecord[] = [];
  for (const r of records) {
    const ids = r.fields['メーカー'] || [];
    if (ids.length === 0) continue;
    const maker = makerCache.get(ids[0]);
    if (!maker) continue;
    const slug = maker.fields['Slug'];
    if (regionFilter(slug)) {
      filtered.push(r);
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const region = parseRegionArg();
  const regionLabel = region === 'all' ? '' : ` [region: ${region}]`;

  log('========================================');
  log(`Lure Database Pipeline - Starting${regionLabel}`);
  log('========================================');

  const startTime = Date.now();
  const results: PipelineResult[] = [];

  try {
    // 1. Fetch pending records
    const allRecords = await fetchPendingRecords();

    if (allRecords.length === 0) {
      log('No pending records found. Exiting.');
      return;
    }

    // 1.5. Region filter（メーカーslugでJP/US分離）
    const regionRecords = await filterByRegion(allRecords, region);
    if (region !== 'all') {
      log(`Region filter (${region}): ${allRecords.length} -> ${regionRecords.length} record(s)`);
    }

    if (regionRecords.length === 0) {
      log(`No pending records for region=${region}. Exiting.`);
      return;
    }

    const limit = parseLimit();
    const records = limit > 0 ? regionRecords.slice(0, limit) : regionRecords;
    log(`Processing ${records.length} of ${regionRecords.length} pending record(s)${limit > 0 ? ` (--limit ${limit})` : ''}${regionLabel}`);

    // 2. Process each record
    for (let i = 0; i < records.length; i++) {
      log(`--- Record ${i + 1} of ${records.length} ---`);
      const result = await processRecord(records[i]);
      results.push(result);

      // Polite delay between page loads
      if (i < records.length - 1) {
        log(`Waiting ${PAGE_LOAD_DELAY_MS}ms before next record...`);
        await sleep(PAGE_LOAD_DELAY_MS);
      }
    }

    // 3. Trigger Vercel deploy if any records were processed successfully
    const successCount = results.filter(r => r.status === 'success').length;
    if (successCount > 0) {
      await triggerVercelDeploy();
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`Pipeline failed: ${errMsg}`);
  }

  // 4. Log summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('========================================');
  log('Pipeline Summary');
  log('========================================');
  log(`Total records processed: ${results.length}`);
  log(`Successful: ${results.filter(r => r.status === 'success').length}`);
  log(`Errors: ${results.filter(r => r.status === 'error').length}`);
  log(`Total rows inserted: ${results.reduce((sum, r) => sum + r.rowsInserted, 0)}`);
  const totalColors = results.reduce((sum, r) => sum + r.colorsProcessed, 0);
  const totalColorsWithImage = results.reduce((sum, r) => sum + r.colorsWithImage, 0);
  const imageRate = totalColors > 0 ? Math.round(totalColorsWithImage / totalColors * 100) : 0;
  log(`Total colors processed: ${totalColors}`);
  log(`Colors with image: ${totalColorsWithImage}/${totalColors} (${imageRate}%)`);
  if (totalColors > 0 && imageRate < 50) {
    log(`⚠️  WARNING: Image coverage is below 50%! Check scraper color image extraction.`);
  }
  log(`Elapsed time: ${elapsed}s`);
  log('========================================');

  for (const result of results) {
    const icon = result.status === 'success' ? 'OK' : 'FAIL';
    log(`  [${icon}] ${result.lureName}: ${result.message}`);
  }

  // 4.5 Phase 6: パイプライン完了時の検証結果ログ出力
  if (pipelineValidationLog.length > 0) {
    log('========================================');
    log(`Phase 6 検証結果: ${pipelineValidationLog.length}件のルール違反を検出（target_fishクリア済み）`);
    log('========================================');
    for (const entry of pipelineValidationLog) {
      log(`  [${entry.category}] ${entry.manufacturer}/${entry.slug}: ${entry.message}`);
    }
  }

  // 5. Check for unpushed commits (warn if local is ahead of remote)
  try {
    const { execSync } = await import('child_process');
    const unpushed = execSync('git log --oneline origin/main..HEAD 2>/dev/null', {
      cwd: decodeURIComponent(new URL('..', import.meta.url).pathname),
      encoding: 'utf-8',
    }).trim();
    if (unpushed) {
      const count = unpushed.split('\n').length;
      log('========================================');
      log(`⚠️  WARNING: ${count} unpushed commit(s) detected!`);
      log('⚠️  Deploy Hook rebuilds the LAST PUSHED commit.');
      log('⚠️  Run "git push origin main" to deploy code changes.');
      log('========================================');
    }
  } catch {
    // git not available or not a git repo — skip check silently
  }

  // 6. 完了通知ファイル（Claude Codeセッション間の引き継ぎ用）
  const summaryData = {
    completedAt: new Date().toISOString(),
    region,
    totalRecords: results.length,
    successful: results.filter(r => r.status === 'success').length,
    errors: results.filter(r => r.status === 'error').length,
    rowsInserted: results.reduce((sum, r) => sum + r.rowsInserted, 0),
    elapsedSeconds: parseFloat(elapsed),
    errorDetails: results.filter(r => r.status === 'error').map(r => ({
      name: r.lureName,
      message: r.message,
    })),
    phase6Violations: pipelineValidationLog,
  };
  const { writeFileSync } = await import('fs');
  // region別のサマリファイル（allの場合は従来通り pipeline-last-run.json）
  const summaryFilename = region === 'all'
    ? 'pipeline-last-run.json'
    : `pipeline-${region}-last-run.json`;
  const summaryPath = decodeURIComponent(new URL(`../logs/${summaryFilename}`, import.meta.url).pathname);
  writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
  log(`Completion summary saved to ${summaryPath}`);

  // 7. 新規追加ルアーの即時インデックス送信
  const newLurePaths = results
    .filter(r => r.status === 'success' && r.lurePath)
    .map(r => r.lurePath!);

  if (newLurePaths.length > 0) {
    log(`\n=== Indexing API: 新規${newLurePaths.length}件を即時送信 ===`);
    try {
      const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
      const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
      const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
        log('⚠️ Google Indexing API credentials not found, skipping indexing');
      } else {
        // OAuth2 トークン取得
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: GOOGLE_REFRESH_TOKEN,
            grant_type: 'refresh_token',
          }),
        });
        const tokenData = await tokenRes.json() as any;
        const accessToken = tokenData.access_token;

        if (!accessToken) {
          log(`⚠️ Failed to get access token: ${JSON.stringify(tokenData)}`);
        } else {
          const siteUrl = process.env.GSC_SITE_URL || 'https://www.castlog.xyz/';
          const quotaProject = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';

          // ルアーページ + メーカーページ（新規メーカーの場合）のURLを送信
          const urlsToIndex = new Set<string>();
          for (const p of newLurePaths) {
            urlsToIndex.add(`${siteUrl}${p}/`);
            // メーカーページも更新通知（新ルアー追加でページ内容が変わるため）
            urlsToIndex.add(`${siteUrl}${p.split('/')[0]}/`);
          }

          let indexSuccess = 0;
          let indexFailed = 0;
          for (const url of urlsToIndex) {
            try {
              const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'x-goog-user-project': quotaProject,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url, type: 'URL_UPDATED' }),
              });
              if (res.ok) {
                indexSuccess++;
              } else {
                const errData = await res.json() as any;
                log(`⚠️ Indexing failed for ${url}: ${errData.error?.message || res.status}`);
                indexFailed++;
              }
              // レート制限対策
              await new Promise(r => setTimeout(r, 500));
            } catch (e: any) {
              log(`⚠️ Indexing error for ${url}: ${e.message}`);
              indexFailed++;
            }
          }
          log(`Indexing API: ${indexSuccess}/${urlsToIndex.size} URLs sent successfully${indexFailed > 0 ? `, ${indexFailed} failed` : ''}`);
        }
      }
    } catch (e: any) {
      log(`⚠️ Indexing API error (non-fatal): ${e.message}`);
    }
  }

  log('Pipeline complete.');
}

// Run
main().catch((err) => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
