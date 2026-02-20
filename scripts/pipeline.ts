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
  rowsInserted: number;
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
  log(`Uploaded: ${publicUrl}`);
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
async function insertLure(row: Record<string, unknown>): Promise<void> {
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
    return { recordId, lureName, status: 'error', message: msg, colorsProcessed: 0, rowsInserted: 0 };
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

    log(`Scraped: ${scraped.name}, ${scraped.colors.length} colors, ${scraped.weights.length} weights, price: ${scraped.price}`);

    // Process and upload color images to R2
    const colorImageMap = new Map<string, string>(); // colorName -> r2 public URL

    for (let i = 0; i < scraped.colors.length; i++) {
      const color = scraped.colors[i];
      if (!color.imageUrl) {
        log(`Skipping color ${i} (${color.name}): no image URL`);
        continue;
      }

      try {
        const paddedIndex = String(i + 1).padStart(2, '0');
        const r2Key = `${manufacturerSlug}/${scraped.slug}/${paddedIndex}.webp`;
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

        const row: Record<string, unknown> = {
          name: scraped.name,
          name_kana: scraped.name_kana || scraped.name,
          slug: scraped.slug,
          manufacturer: manufacturerName,
          manufacturer_slug: manufacturerSlug,
          type: scraped.type,
          price: scraped.price,
          description: scraped.description || null,
          images: imageUrl ? [imageUrl] : null,
          color_name: color.name,
          weight: weight,
          length: scraped.length,
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

    // Update Airtable to 登録完了
    await updateAirtableStatus(recordId, '登録完了', `${scraped.colors.length}色 x ${weights.length}ウェイト = ${rowsInserted}行挿入`);

    return {
      recordId,
      lureName,
      status: 'success',
      message: `${scraped.colors.length} colors, ${rowsInserted} rows inserted`,
      colorsProcessed: scraped.colors.length,
      rowsInserted,
    };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`Failed to process ${lureName}: ${errMsg}`);
    try {
      await updateAirtableStatus(recordId, 'エラー', errMsg.substring(0, 500));
    } catch (statusErr) {
      logError(`Failed to update Airtable status for ${lureName}: ${statusErr instanceof Error ? statusErr.message : String(statusErr)}`);
    }
    return { recordId, lureName, status: 'error', message: errMsg, colorsProcessed: 0, rowsInserted: 0 };
  }
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseLimit(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0; // 0 = 全件処理
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('========================================');
  log('Lure Database Pipeline - Starting');
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

    const limit = parseLimit();
    const records = limit > 0 ? allRecords.slice(0, limit) : allRecords;
    log(`Processing ${records.length} of ${allRecords.length} pending record(s)${limit > 0 ? ` (--limit ${limit})` : ''}`);

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
  log(`Total colors processed: ${results.reduce((sum, r) => sum + r.colorsProcessed, 0)}`);
  log(`Elapsed time: ${elapsed}s`);
  log('========================================');

  for (const result of results) {
    const icon = result.status === 'success' ? 'OK' : 'FAIL';
    log(`  [${icon}] ${result.lureName}: ${result.message}`);
  }

  // 5. Check for unpushed commits (warn if local is ahead of remote)
  try {
    const { execSync } = await import('child_process');
    const unpushed = execSync('git log --oneline origin/main..HEAD 2>/dev/null', {
      cwd: new URL('..', import.meta.url).pathname,
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

  log('Pipeline complete.');
}

// Run
main().catch((err) => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
