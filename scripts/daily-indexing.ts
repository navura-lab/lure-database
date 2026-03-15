#!/usr/bin/env npx tsx
/**
 * 日次 Indexing API 自動送信スクリプト
 *
 * 進捗ファイル（indexing-progress.json）を読み、前回の続きから
 * 最大200件のルアーページURLを Google Indexing API に送信する。
 * 全ページ送信完了後は offset=0 にリセットして2周目に入る。
 *
 * cron で毎日実行する想定。引数不要。
 *
 * Usage:
 *   npx tsx scripts/daily-indexing.ts           # 次の200件を送信
 *   npx tsx scripts/daily-indexing.ts --dry-run  # 送信せずに対象URLを表示
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ─── Config ───────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = process.env.GSC_SITE_URL || 'https://www.castlog.xyz/';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200;

const LOG_DIR = path.join(import.meta.dirname, '..', 'logs');
const DATA_DIR = path.join(LOG_DIR, 'seo-data');
const PROGRESS_FILE = path.join(DATA_DIR, 'indexing-progress.json');

// ─── Types ────────────────────────────────────────────

interface Progress {
  lure_offset: number;
  total_submitted: number;
  last_run: string;
  history: { date: string; offset: number; success: number; failed: number }[];
}

interface IndexingResult {
  url: string;
  success: boolean;
  notifyTime?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [daily-indexing] ${msg}`);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json() as any;
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

function headers(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'x-goog-user-project': QUOTA_PROJECT,
    'Content-Type': 'application/json',
  };
}

// ─── Supabase: 全ルアーURL取得 ───────────────────────

async function fetchAllLureUrls(): Promise<string[]> {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  const allPaths = new Set<string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug,manufacturer_slug')
      .range(from, from + pageSize - 1);

    if (error) { log(`Supabase error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.slug && r.manufacturer_slug) {
        allPaths.add(`${r.manufacturer_slug}/${r.slug}`);
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // メーカーページも含める
  const makerSlugs = new Set<string>();
  for (const p of allPaths) {
    makerSlugs.add(p.split('/')[0]);
  }

  // 魚種・タイプ・ランキングページ用: 全対象魚・タイプスラグ取得
  const fishSlugs = new Set<string>();
  const typeSlugs = new Set<string>();
  const rankingSlugs = new Set<string>();

  // target_fish と type を取得してカテゴリページURL生成
  let from2 = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('target_fish,type')
      .range(from2, from2 + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      if (r.type) typeSlugs.add(r.type);
      if (r.target_fish) {
        const fish = Array.isArray(r.target_fish) ? r.target_fish : [];
        for (const f of fish) fishSlugs.add(f as string);
      }
    }
    if (data.length < pageSize) break;
    from2 += pageSize;
  }

  // ビルド済みランキングスラグをファイルから取得
  const fs2 = await import('fs');
  const rankingDir = path.join(import.meta.dirname, '..', 'dist', 'client', 'ranking');
  try {
    const entries = fs2.readdirSync(rankingDir);
    for (const e of entries) {
      if (e !== 'index.html' && !e.includes('.')) rankingSlugs.add(e);
    }
  } catch {
    log('Warning: dist/client/ranking/ not found, skipping ranking URLs');
  }

  // 特集記事ページ（最優先 — SEO価値が最も高い）
  const articleUrls: string[] = [];
  try {
    const { contentArticles } = await import('../src/data/articles/_index.js');
    articleUrls.push(...contentArticles.map((a: any) => `${SITE_URL}article/${a.slug}/`));
    log(`Article pages: ${articleUrls.length}`);
  } catch {
    log('Warning: articles not found, skipping article pages');
  }

  // 比較ページ（ランキングと同一slug体系）
  const compareUrls = [...rankingSlugs].sort().map(s => `${SITE_URL}compare/${s}/`);

  // ── 日本語URL（優先） ──
  const jaUrls = [
    // 固定ページ（優先度最高）
    `${SITE_URL}`,
    `${SITE_URL}article/`,
    `${SITE_URL}compare/`,
    `${SITE_URL}ranking/`,
    `${SITE_URL}new/`,
    `${SITE_URL}fish/`,
    `${SITE_URL}type/`,
    `${SITE_URL}search/`,
    // 特集記事（SEO価値 最高: 月100-300click/本）
    ...articleUrls,
    // 比較ページ（SEO価値 高: エディトリアル説明文付き）
    ...compareUrls,
    // ランキングページ
    ...[...rankingSlugs].sort().map(s => `${SITE_URL}ranking/${s}/`),
    // メーカーページ
    ...[...makerSlugs].sort().map(s => `${SITE_URL}${s}/`),
    // ルアーページ
    ...[...allPaths].sort().map(p => `${SITE_URL}${p}/`),
  ];

  // ── 英語URL（日本語の後に追加） ──
  const EN = `${SITE_URL}en/`;
  const enUrls = [
    // 固定ページ
    EN,
    `${EN}ranking/`,
    `${EN}compare/`,
    `${EN}fish/`,
    `${EN}type/`,
    `${EN}maker/`,
    `${EN}method/`,
    `${EN}season/`,
    `${EN}guide/price/`,
    // 比較ページ
    ...[...rankingSlugs].sort().map(s => `${EN}compare/${s}/`),
    // ランキングページ
    ...[...rankingSlugs].sort().map(s => `${EN}ranking/${s}/`),
    // メーカーページ
    ...[...makerSlugs].sort().map(s => `${EN}${s}/`),
    // ルアーページ
    ...[...allPaths].sort().map(p => `${EN}${p}/`),
  ];

  log(`URL breakdown: JA=${jaUrls.length}, EN=${enUrls.length}`);
  return [...jaUrls, ...enUrls];
}

// ─── Indexing API 送信 ────────────────────────────────

async function requestIndexing(token: string, url: string): Promise<IndexingResult> {
  try {
    const res = await fetch(
      'https://indexing.googleapis.com/v3/urlNotifications:publish',
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      },
    );

    const data = await res.json() as any;

    if (!res.ok) {
      return {
        url,
        success: false,
        error: data.error?.message || `HTTP ${res.status}: ${JSON.stringify(data)}`,
      };
    }

    return {
      url,
      success: true,
      notifyTime: data.urlNotificationMetadata?.latestUpdate?.notifyTime,
    };
  } catch (e: any) {
    return { url, success: false, error: e.message };
  }
}

// ─── Progress 管理 ────────────────────────────────────

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {
    log(`Warning: Could not read progress file, starting fresh`);
  }

  // 初回: 既存ログから推定
  let maxOffset = 0;
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('indexing-lures-'));
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      const endOffset = (data.offset || 0) + (data.summary?.success || 0);
      if (endOffset > maxOffset) maxOffset = endOffset;
    }
    if (maxOffset > 0) {
      log(`Detected previous progress from logs: offset ${maxOffset}`);
    }
  } catch (e) {
    // ignore
  }

  return {
    lure_offset: maxOffset,
    total_submitted: maxOffset,
    last_run: '',
    history: [],
  };
}

function saveProgress(progress: Progress) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─── Rewrites Applied 読み込み ──────────────────────────

const REWRITES_APPLIED_FILE = path.join(DATA_DIR, 'rewrites-applied.json');

interface RewritesApplied {
  urls: string[];
  appliedAt: string;
}

/**
 * rewrite-detector が出力した rewrites-applied.json を読み込み、
 * 通常バッチの先頭に優先挿入するURLリストを返す。
 * 読み込み後、アーカイブにリネームする。
 */
function loadAndArchiveRewritesApplied(): string[] {
  if (!fs.existsSync(REWRITES_APPLIED_FILE)) return [];

  try {
    const data: RewritesApplied = JSON.parse(fs.readFileSync(REWRITES_APPLIED_FILE, 'utf-8'));
    const urls = data.urls || [];

    if (urls.length > 0) {
      // アーカイブ
      const today = new Date().toISOString().split('T')[0];
      const archiveName = path.join(DATA_DIR, `rewrites-applied-${today}.json`);
      fs.renameSync(REWRITES_APPLIED_FILE, archiveName);
      log(`Rewrites applied: ${urls.length}件を優先送信（アーカイブ: ${path.basename(archiveName)}）`);
    }

    return urls;
  } catch (e: any) {
    log(`Warning: rewrites-applied.json の読み込みに失敗: ${e.message}`);
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== Daily Indexing Start ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found in .env');
    process.exit(1);
  }

  // 1. 進捗読み込み
  const progress = loadProgress();
  log(`Progress: offset=${progress.lure_offset}, total_submitted=${progress.total_submitted}, last_run=${progress.last_run}`);

  // 1.5. Rewrites applied（title書き換え済みURL）を優先送信リストとして取得
  const rewriteUrls = loadAndArchiveRewritesApplied();

  // 2. 全URL取得
  log('Fetching all URLs from Supabase...');
  const allUrls = await fetchAllLureUrls();
  log(`Total URLs: ${allUrls.length} (makers + lures)`);

  // 3. バッチ切り出し
  let offset = progress.lure_offset;

  // 全完了していたらリセット（2周目）
  if (offset >= allUrls.length) {
    log(`All ${allUrls.length} URLs submitted. Resetting to offset=0 for re-submission cycle.`);
    offset = 0;
  }

  // rewrite URLを先頭に挿入し、通常バッチから残り枠を埋める
  const normalBatchSize = Math.max(0, BATCH_SIZE - rewriteUrls.length);
  const normalUrls = allUrls.slice(offset, offset + normalBatchSize);
  // 重複排除（rewriteUrlsとnormalUrlsの重複を除去）
  const rewriteSet = new Set(rewriteUrls);
  const dedupedNormal = normalUrls.filter(u => !rewriteSet.has(u));
  const batchUrls = [...rewriteUrls, ...dedupedNormal];

  if (batchUrls.length === 0) {
    log('No URLs to submit.');
    return;
  }

  log(`Batch: offset=${offset}, size=${batchUrls.length}`);
  log(`  First: ${batchUrls[0].replace(SITE_URL, '/')}`);
  log(`  Last:  ${batchUrls[batchUrls.length - 1].replace(SITE_URL, '/')}`);

  // 4. Dry Run
  if (DRY_RUN) {
    log('--- DRY RUN ---');
    for (const url of batchUrls) {
      log(`  📤 ${url.replace(SITE_URL, '/')}`);
    }
    log(`Next run would submit from offset ${offset}`);
    log(`Remaining after this batch: ${allUrls.length - offset - batchUrls.length}`);
    return;
  }

  // 5. Access Token取得
  const token = await getAccessToken();
  log('Access token obtained');

  // 6. バッチ送信
  const results: IndexingResult[] = [];
  let consecutiveQuotaErrors = 0;

  for (let i = 0; i < batchUrls.length; i++) {
    const url = batchUrls[i];
    const shortUrl = url.replace(SITE_URL, '/');

    const result = await requestIndexing(token, url);
    results.push(result);

    if (result.success) {
      if (i % 20 === 0 || i === batchUrls.length - 1) {
        log(`  [${i + 1}/${batchUrls.length}] ✅ ${shortUrl}`);
      }
      consecutiveQuotaErrors = 0;
    } else {
      log(`  [${i + 1}/${batchUrls.length}] ❌ ${shortUrl} — ${result.error}`);
      if (result.error?.includes('Quota exceeded') || result.error?.includes('rateLimitExceeded')) {
        consecutiveQuotaErrors++;
        if (consecutiveQuotaErrors >= 3) {
          log('⚠️  Quota exceeded 3x in a row — stopping early');
          break;
        }
      }
    }

    await sleep(1000);
  }

  // 7. 結果集計
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;

  log('');
  log('=== Summary ===');
  log(`✅ Submitted: ${successCount}`);
  log(`❌ Failed:    ${failedCount}`);
  log(`📊 Progress:  ${offset + successCount}/${allUrls.length} (${((offset + successCount) / allUrls.length * 100).toFixed(1)}%)`);

  const remaining = allUrls.length - offset - successCount;
  if (remaining > 0) {
    log(`📅 Remaining: ${remaining} URLs (~${Math.ceil(remaining / BATCH_SIZE)} days)`);
  } else {
    log('🎉 All URLs submitted! Next run will start re-submission cycle.');
  }

  // 8. 進捗保存
  const today = new Date().toISOString().split('T')[0];
  // rewriteUrlsは優先挿入分なので通常進捗には含めない
  const normalSuccessCount = results
    .slice(rewriteUrls.length) // rewrite分を除いた通常バッチ部分
    .filter(r => r.success).length;
  progress.lure_offset = offset + normalSuccessCount;
  progress.total_submitted += successCount;
  progress.last_run = today;
  progress.history.push({ date: today, offset, success: successCount, failed: failedCount });

  // 直近30日分のhistoryだけ保持
  if (progress.history.length > 30) {
    progress.history = progress.history.slice(-30);
  }

  saveProgress(progress);
  log(`Progress saved: offset=${progress.lure_offset}`);

  // 9. 詳細ログ保存
  const logFile = path.join(DATA_DIR, `indexing-lures-${today}-offset${offset}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    date: new Date().toISOString(),
    mode: 'daily-auto',
    offset,
    batchSize: batchUrls.length,
    totalUrls: allUrls.length,
    summary: { success: successCount, failed: failedCount },
    results,
  }, null, 2));
  log(`Detailed log: ${logFile}`);

  log('=== Daily Indexing Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
