// scripts/_image-pipeline-fix.ts
// 画像パイプライン修正: 外部URL→R2アップロード、不完全URL修正
//
// Usage:
//   npx tsx scripts/_image-pipeline-fix.ts --audit       # 調査のみ
//   npx tsx scripts/_image-pipeline-fix.ts --fix         # 実際に修正
//   npx tsx scripts/_image-pipeline-fix.ts --dry-run     # 修正内容を表示するが実行しない

import 'dotenv/config';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '../src/lib/slugify.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!; // https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const IMAGE_WIDTH = 500;

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const MODE = process.argv.includes('--fix')
  ? 'fix'
  : process.argv.includes('--dry-run')
    ? 'dry-run'
    : 'audit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LureRow {
  id: string; // UUID
  manufacturer: string;
  manufacturer_slug: string;
  slug: string;
  color_name: string;
  images: string[] | null;
}

type ProblemType = 'path_only' | 'http_external' | 'https_external';

interface Problem {
  type: ProblemType;
  rowId: string;
  manufacturer: string;
  manufacturerSlug: string;
  slug: string;
  colorName: string;
  originalUrl: string;
  fixedUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[image-fix] ${msg}`);
}

function logError(msg: string) {
  console.error(`[image-fix] ERROR: ${msg}`);
}

/** URL がR2 CDNの正しい形式か */
function isValidR2Url(url: string): boolean {
  return url.startsWith(R2_PUBLIC_URL + '/');
}

/** パスのみのURLをフルURLに補完 */
function fixPathOnlyUrl(path: string): string {
  // 先頭のスラッシュを除去
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${R2_PUBLIC_URL}/${cleanPath}`;
}

/** 外部URLから画像をダウンロード → R2アップロード → R2 URLを返す */
async function downloadAndUploadToR2(
  externalUrl: string,
  manufacturerSlug: string,
  lureSlug: string,
  colorName: string,
): Promise<string> {
  // カラースラグを生成
  const colorSlug = slugify(colorName).substring(0, 40) || 'default';
  const r2Key = `${manufacturerSlug}/${lureSlug}/${colorSlug}.webp`;

  log(`  ダウンロード: ${externalUrl}`);
  const fetchHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };

  const response = await fetch(externalUrl, {
    headers: fetchHeaders,
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // sharp で WebP に変換
  const webpBuffer = await sharp(buffer)
    .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  log(`  R2アップロード: ${r2Key} (${(webpBuffer.length / 1024).toFixed(1)} KB)`);

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: webpBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return `${R2_PUBLIC_URL}/${r2Key}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`モード: ${MODE}`);

  // 問題のある行だけを取得（外部URLを含むもの）
  // Supabaseのrangeページネーションは大量行で取りこぼすため、
  // idベースのカーソルページネーションを使用
  log('Supabaseから画像データを取得中（idカーソル方式）...');
  const allRows: LureRow[] = [];
  let lastId = '00000000-0000-0000-0000-000000000000';
  const PAGE = 1000;
  let totalWithImages = 0;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('id, manufacturer, manufacturer_slug, slug, color_name, images')
      .not('images', 'is', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE);

    if (error) {
      logError(`Supabase query error: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    totalWithImages += data.length;
    allRows.push(...(data as LureRow[]));
    lastId = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }

  log(`画像あり行数: ${totalWithImages}`);

  // 問題検出
  const problems: Problem[] = [];

  for (const row of allRows) {
    if (!row.images) continue;
    for (const url of row.images) {
      if (!url) continue;

      // 1. パスのみ（httpで始まらない）
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        problems.push({
          type: 'path_only',
          rowId: row.id,
          manufacturer: row.manufacturer,
          manufacturerSlug: row.manufacturer_slug,
          slug: row.slug,
          colorName: row.color_name,
          originalUrl: url,
          fixedUrl: fixPathOnlyUrl(url),
        });
        continue;
      }

      // 2. R2 CDN URLならOK
      if (isValidR2Url(url)) continue;

      // 3. 外部URL（HTTP or HTTPS）
      problems.push({
        type: url.startsWith('http://') ? 'http_external' : 'https_external',
        rowId: row.id,
        manufacturer: row.manufacturer,
        manufacturerSlug: row.manufacturer_slug,
        slug: row.slug,
        colorName: row.color_name,
        originalUrl: url,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // レポート
  // ---------------------------------------------------------------------------

  // メーカー別集計
  const byMaker = new Map<string, { pathOnly: number; httpExternal: number; httpsExternal: number; examples: string[] }>();

  for (const p of problems) {
    const entry = byMaker.get(p.manufacturer) || { pathOnly: 0, httpExternal: 0, httpsExternal: 0, examples: [] };
    if (p.type === 'path_only') entry.pathOnly++;
    else if (p.type === 'http_external') entry.httpExternal++;
    else entry.httpsExternal++;
    if (entry.examples.length < 3) entry.examples.push(p.originalUrl);
    byMaker.set(p.manufacturer, entry);
  }

  console.log('\n' + '='.repeat(80));
  console.log('画像URL問題レポート');
  console.log('='.repeat(80));

  const pathOnlyCount = problems.filter(p => p.type === 'path_only').length;
  const httpCount = problems.filter(p => p.type === 'http_external').length;
  const httpsExtCount = problems.filter(p => p.type === 'https_external').length;

  console.log(`\n問題合計: ${problems.length}件`);
  console.log(`  パスのみ（ドメインなし）: ${pathOnlyCount}件`);
  console.log(`  HTTP外部URL: ${httpCount}件`);
  console.log(`  HTTPS外部URL: ${httpsExtCount}件`);

  console.log('\n--- メーカー別内訳 ---');
  const sortedMakers = [...byMaker.entries()].sort((a, b) => {
    const totalA = a[1].pathOnly + a[1].httpExternal + a[1].httpsExternal;
    const totalB = b[1].pathOnly + b[1].httpExternal + b[1].httpsExternal;
    return totalB - totalA;
  });

  for (const [maker, info] of sortedMakers) {
    const total = info.pathOnly + info.httpExternal + info.httpsExternal;
    const parts: string[] = [];
    if (info.pathOnly > 0) parts.push(`パスのみ=${info.pathOnly}`);
    if (info.httpExternal > 0) parts.push(`HTTP=${info.httpExternal}`);
    if (info.httpsExternal > 0) parts.push(`HTTPS外部=${info.httpsExternal}`);
    console.log(`  ${maker}: ${total}件 (${parts.join(', ')})`);
    for (const ex of info.examples) {
      console.log(`    例: ${ex}`);
    }
  }

  if (MODE === 'audit') {
    log('\n--audit モードのため修正は行いません。--fix または --dry-run で実行してください。');
    return;
  }

  // ---------------------------------------------------------------------------
  // 修正実行
  // ---------------------------------------------------------------------------

  console.log('\n' + '='.repeat(80));
  console.log(MODE === 'dry-run' ? '修正内容プレビュー (dry-run)' : '修正実行');
  console.log('='.repeat(80));

  let fixedCount = 0;
  let failedCount = 0;

  // 1. パスのみの修正（DB更新のみ、ダウンロード不要）
  const pathOnlyProblems = problems.filter(p => p.type === 'path_only');
  if (pathOnlyProblems.length > 0) {
    log(`\n[Phase 1] パスのみURL修正: ${pathOnlyProblems.length}件`);
    for (const p of pathOnlyProblems) {
      const newUrl = p.fixedUrl!;
      log(`  ${p.manufacturer}/${p.slug}: ${p.originalUrl} → ${newUrl}`);

      if (MODE === 'fix') {
        const { error } = await sb
          .from('lures')
          .update({ images: [newUrl] })
          .eq('id', p.rowId);

        if (error) {
          logError(`  更新失敗 (id=${p.rowId}): ${error.message}`);
          failedCount++;
        } else {
          fixedCount++;
        }
      } else {
        fixedCount++; // dry-run
      }
    }
  }

  // 2. 外部URL → R2アップロード + DB更新
  const externalProblems = problems.filter(p => p.type !== 'path_only');
  if (externalProblems.length > 0) {
    log(`\n[Phase 2] 外部URL→R2アップロード: ${externalProblems.length}件`);
    for (const p of externalProblems) {
      log(`  ${p.manufacturer}/${p.slug}/${p.colorName}: ${p.originalUrl}`);

      if (MODE === 'fix') {
        try {
          const newUrl = await downloadAndUploadToR2(
            p.originalUrl,
            p.manufacturerSlug,
            p.slug,
            p.colorName,
          );

          const { error } = await sb
            .from('lures')
            .update({ images: [newUrl] })
            .eq('id', p.rowId);

          if (error) {
            logError(`  DB更新失敗 (id=${p.rowId}): ${error.message}`);
            failedCount++;
          } else {
            fixedCount++;
            log(`  → ${newUrl}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logError(`  アップロード失敗: ${msg}`);
          failedCount++;
        }

        // レート制限回避
        await new Promise(r => setTimeout(r, 200));
      } else {
        fixedCount++; // dry-run
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`完了: 修正${fixedCount}件, 失敗${failedCount}件`);
  console.log('='.repeat(80));
}

main().catch(err => {
  logError(err.message || String(err));
  process.exit(1);
});
