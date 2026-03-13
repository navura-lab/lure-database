#!/usr/bin/env npx tsx
/**
 * Google Indexing API + URL Inspection バッチスクリプト
 *
 * ■ メーカーページモード（デフォルト）
 *   1. 全メーカーページ + トップページの URL検査 (Inspection API)
 *   2. 未インデックスページに Indexing API で URL_UPDATED 通知
 *
 * ■ ルアーページモード (--lures)
 *   全ルアーページを直接 Indexing API に送信（検査スキップ）
 *   --offset / --limit でバッチ制御（API上限 200/日）
 *
 * ■ カテゴリページモード (--categories)
 *   /type/[slug]/ + /fish/[slug]/ + 各一覧ページを Indexing API に送信
 *   category-slugs.ts からURL一覧を自動構築（125件程度）
 *
 * Usage:
 *   npx tsx scripts/request-indexing.ts                        # メーカーページURL検査のみ (dry-run)
 *   npx tsx scripts/request-indexing.ts --submit               # 未インデックスURLをIndexing APIに送信
 *   npx tsx scripts/request-indexing.ts --submit --all         # 全URLをIndexing APIに送信（再送信）
 *   npx tsx scripts/request-indexing.ts --inspect-only         # URL検査だけ実行
 *   npx tsx scripts/request-indexing.ts --lures                # ルアーページ一覧表示 (dry-run)
 *   npx tsx scripts/request-indexing.ts --lures --submit       # ルアーページ200件をIndexing APIに送信
 *   npx tsx scripts/request-indexing.ts --lures --submit --offset 200  # 201件目から200件
 *   npx tsx scripts/request-indexing.ts --lures --submit --offset 400 --limit 100  # 401件目から100件
 *   npx tsx scripts/request-indexing.ts --categories           # カテゴリページ一覧表示 (dry-run)
 *   npx tsx scripts/request-indexing.ts --categories --submit  # カテゴリ全件をIndexing APIに送信
 *   npx tsx scripts/request-indexing.ts --pages                # ガイド・ランキング・新着ページ一覧 (dry-run)
 *   npx tsx scripts/request-indexing.ts --pages --submit       # ガイド・ランキング・新着をIndexing APIに送信
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { TYPE_SLUG_MAP, FISH_SLUG_MAP } from '../src/lib/category-slugs.js';
import { guideArticles } from '../src/data/guides.js';

// ─── Config ───────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = process.env.GSC_SITE_URL || 'https://castlog.xyz/';

const DO_SUBMIT = process.argv.includes('--submit');
const DO_ALL = process.argv.includes('--all');
const INSPECT_ONLY = process.argv.includes('--inspect-only');
const LURE_MODE = process.argv.includes('--lures');
const CATEGORY_MODE = process.argv.includes('--categories');
const PAGES_MODE = process.argv.includes('--pages');

function getArgValue(flag: string, defaultValue: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultValue;
  return parseInt(process.argv[idx + 1], 10) || defaultValue;
}

const OFFSET = getArgValue('--offset', 0);
const LIMIT = getArgValue('--limit', 200);

const LOG_DIR = path.join(import.meta.dirname, '..', 'logs');
const DATA_DIR = path.join(LOG_DIR, 'seo-data');

// ─── Helper ───────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Supabase: URL一覧取得 ──────────────────────────

async function fetchManufacturerSlugs(sb: any): Promise<string[]> {
  const allSlugs = new Set<string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug')
      .range(from, from + pageSize - 1);

    if (error) { log(`Supabase error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;
    for (const r of data) allSlugs.add(r.manufacturer_slug);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return [...allSlugs].sort();
}

async function fetchLureUrls(sb: any): Promise<string[]> {
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

  return [...allPaths].sort().map(p => `${SITE_URL}${p}/`);
}

// ─── API: URL Inspection ─────────────────────────────

interface InspectionResult {
  url: string;
  verdict: string;           // PASS, NEUTRAL, FAIL, VERDICT_UNSPECIFIED
  coverageState: string;     // e.g., "Submitted and indexed", "Discovered - currently not indexed"
  crawledAs: string;
  lastCrawlTime?: string;
  indexingState?: string;
  robotsTxtState?: string;
  error?: string;
}

async function inspectUrl(token: string, url: string): Promise<InspectionResult> {
  try {
    const res = await fetch(
      'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { url, verdict: 'ERROR', coverageState: `HTTP ${res.status}`, crawledAs: '', error: errText };
    }

    const data = await res.json() as any;
    const r = data.inspectionResult;
    const idx = r?.indexStatusResult;

    return {
      url,
      verdict: idx?.verdict || 'UNKNOWN',
      coverageState: idx?.coverageState || '',
      crawledAs: idx?.crawledAs || '',
      lastCrawlTime: idx?.lastCrawlTime,
      indexingState: idx?.indexingState,
      robotsTxtState: idx?.robotsTxtState,
    };
  } catch (e: any) {
    return { url, verdict: 'ERROR', coverageState: e.message, crawledAs: '', error: e.message };
  }
}

// ─── API: Indexing API ───────────────────────────────

interface IndexingResult {
  url: string;
  success: boolean;
  notifyTime?: string;
  error?: string;
}

async function requestIndexing(token: string, url: string): Promise<IndexingResult> {
  try {
    const res = await fetch(
      'https://indexing.googleapis.com/v3/urlNotifications:publish',
      {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({
          url: url,
          type: 'URL_UPDATED',
        }),
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

// ─── Indexing API バッチ送信 ─────────────────────────

async function submitBatch(token: string, urls: string[], label: string): Promise<IndexingResult[]> {
  log(`--- Indexing API: Submitting ${urls.length} ${label} URLs ---`);
  const results: IndexingResult[] = [];
  let consecutiveQuotaErrors = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const shortUrl = url.replace(SITE_URL, '/');
    process.stdout.write(`  [${i + 1}/${urls.length}] ${shortUrl} ... `);

    const result = await requestIndexing(token, url);
    results.push(result);

    if (result.success) {
      console.log(`✅ Submitted (${result.notifyTime})`);
      consecutiveQuotaErrors = 0;
    } else {
      console.log(`❌ Failed: ${result.error}`);
      // クォータ超過を検知して早期停止
      if (result.error?.includes('Quota exceeded')) {
        consecutiveQuotaErrors++;
        if (consecutiveQuotaErrors >= 3) {
          log('');
          log('⚠️ Quota exceeded 3 times in a row — stopping early');
          log(`   Successfully submitted: ${results.filter(r => r.success).length} URLs`);
          break;
        }
      }
    }

    // Indexing API = 200/day なので慎重に
    await sleep(1000);
  }

  const submitted = results.filter(r => r.success);
  const submitFailed = results.filter(r => !r.success);

  log('');
  log(`=== Indexing API Summary (${label}) ===`);
  log(`✅ Submitted: ${submitted.length}`);
  log(`❌ Failed:    ${submitFailed.length}`);

  if (submitFailed.length > 0) {
    log('');
    log('--- Failed Submissions ---');
    for (const r of submitFailed) {
      log(`  ❌ ${r.url.replace(SITE_URL, '/')} — ${r.error}`);
    }
  }

  return results;
}

// ─── Main: ルアーページモード ─────────────────────────

async function mainLures() {
  log('=== Indexing Request Script Start (LURE MODE) ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found in .env');
    process.exit(1);
  }

  // 1. 全ルアーURL取得
  log('Fetching all lure URLs from Supabase...');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const allUrls = await fetchLureUrls(sb);
  log(`Total lure pages: ${allUrls.length}`);

  // 2. offset/limitでスライス
  const batchUrls = allUrls.slice(OFFSET, OFFSET + LIMIT);
  log(`Batch: offset=${OFFSET}, limit=${LIMIT} → ${batchUrls.length} URLs`);

  if (batchUrls.length === 0) {
    log('No URLs in this range. All done!');
    return;
  }

  // 3. dry-run表示
  if (!DO_SUBMIT) {
    log('');
    log(`--- Dry Run: ${batchUrls.length} URLs would be submitted ---`);
    log(`  First: ${batchUrls[0].replace(SITE_URL, '/')}`);
    log(`  Last:  ${batchUrls[batchUrls.length - 1].replace(SITE_URL, '/')}`);
    log('');
    log(`Next batch: --lures --submit --offset ${OFFSET + LIMIT}`);
    log('Run with --submit to actually send Indexing API requests');
    return;
  }

  // 4. Access Token取得 + 送信
  const token = await getAccessToken();
  log('Access token obtained');

  const results = await submitBatch(token, batchUrls, 'lures');

  // 5. 結果を保存
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const indexingFile = path.join(DATA_DIR, `indexing-lures-${new Date().toISOString().split('T')[0]}-offset${OFFSET}.json`);
  fs.writeFileSync(indexingFile, JSON.stringify({
    date: new Date().toISOString(),
    mode: 'lures',
    offset: OFFSET,
    limit: LIMIT,
    totalLurePages: allUrls.length,
    batchSize: batchUrls.length,
    summary: {
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    },
    results,
  }, null, 2));
  log(`Results saved: ${indexingFile}`);

  // 6. 次バッチの案内
  const nextOffset = OFFSET + LIMIT;
  if (nextOffset < allUrls.length) {
    log('');
    log(`📋 Next batch: npx tsx scripts/request-indexing.ts --lures --submit --offset ${nextOffset}`);
    log(`   Remaining: ${allUrls.length - nextOffset} URLs`);
  } else {
    log('');
    log('🎉 All lure pages have been submitted!');
  }

  log('=== Done ===');
}

// ─── Main: メーカーページモード（既存） ─────────────────

async function mainMakers() {
  log('=== Indexing Request Script Start ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found in .env');
    process.exit(1);
  }

  // 1. メーカーslug一覧取得
  log('Fetching manufacturer slugs from Supabase...');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const slugs = await fetchManufacturerSlugs(sb);
  log(`Found ${slugs.length} manufacturers`);

  // 2. URLリスト構築
  const urls = [
    SITE_URL,                       // トップページ
    ...slugs.map(s => `${SITE_URL}${s}/`),  // メーカーページ
  ];
  log(`Total URLs to check: ${urls.length}`);

  // 3. Access Token取得
  const token = await getAccessToken();
  log('Access token obtained');

  // 4. URL Inspection (バッチ)
  log('--- URL Inspection Start ---');
  const inspectionResults: InspectionResult[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const shortUrl = url.replace(SITE_URL, '/');
    process.stdout.write(`  [${i + 1}/${urls.length}] ${shortUrl} ... `);

    const result = await inspectUrl(token, url);
    inspectionResults.push(result);

    const emoji = result.verdict === 'PASS' ? '✅' :
                  result.verdict === 'NEUTRAL' ? '⚠️' :
                  result.verdict === 'ERROR' ? '💥' : '❌';
    console.log(`${emoji} ${result.verdict} (${result.coverageState})`);

    // Rate limit: URL Inspection API = 600/min だが安全マージン
    await sleep(500);
  }

  // 5. 結果サマリー
  const passed = inspectionResults.filter(r => r.verdict === 'PASS');
  const neutral = inspectionResults.filter(r => r.verdict === 'NEUTRAL');
  const failed = inspectionResults.filter(r => r.verdict === 'FAIL');
  const errors = inspectionResults.filter(r => r.verdict === 'ERROR');

  log('');
  log('=== URL Inspection Summary ===');
  log(`✅ Indexed (PASS):     ${passed.length}`);
  log(`⚠️ Not indexed (NEUTRAL): ${neutral.length}`);
  log(`❌ Failed (FAIL):      ${failed.length}`);
  log(`💥 Error:              ${errors.length}`);
  log('');

  if (neutral.length > 0) {
    log('--- Not Indexed URLs ---');
    for (const r of neutral) {
      log(`  ⚠️ ${r.url.replace(SITE_URL, '/')} — ${r.coverageState}`);
    }
    log('');
  }

  if (failed.length > 0) {
    log('--- Failed URLs ---');
    for (const r of failed) {
      log(`  ❌ ${r.url.replace(SITE_URL, '/')} — ${r.coverageState}`);
    }
    log('');
  }

  if (errors.length > 0) {
    log('--- Error URLs ---');
    for (const r of errors) {
      log(`  💥 ${r.url.replace(SITE_URL, '/')} — ${r.error}`);
    }
    log('');
  }

  // 6. 結果をJSONに保存
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const inspectionFile = path.join(DATA_DIR, `inspection-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(inspectionFile, JSON.stringify({
    date: new Date().toISOString(),
    totalUrls: urls.length,
    summary: {
      pass: passed.length,
      neutral: neutral.length,
      fail: failed.length,
      error: errors.length,
    },
    results: inspectionResults,
  }, null, 2));
  log(`Inspection results saved: ${inspectionFile}`);

  if (INSPECT_ONLY) {
    log('--inspect-only mode, skipping Indexing API');
    log('=== Done ===');
    return;
  }

  // 7. Indexing API送信
  const urlsToSubmit = DO_ALL
    ? urls
    : [...neutral, ...failed].map(r => r.url);

  if (urlsToSubmit.length === 0) {
    log('No URLs to submit for indexing (all already indexed!)');
    log('=== Done ===');
    return;
  }

  if (!DO_SUBMIT) {
    log(`--- Dry Run: ${urlsToSubmit.length} URLs would be submitted ---`);
    for (const url of urlsToSubmit) {
      log(`  📤 ${typeof url === 'string' ? url.replace(SITE_URL, '/') : url}`);
    }
    log('');
    log('Run with --submit to actually send Indexing API requests');
    log('=== Done ===');
    return;
  }

  const indexingResults = await submitBatch(token, urlsToSubmit, 'makers');

  // 8. Indexing結果を保存
  const indexingFile = path.join(DATA_DIR, `indexing-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(indexingFile, JSON.stringify({
    date: new Date().toISOString(),
    totalSubmitted: urlsToSubmit.length,
    summary: {
      success: indexingResults.filter(r => r.success).length,
      failed: indexingResults.filter(r => !r.success).length,
    },
    results: indexingResults,
  }, null, 2));
  log(`Indexing results saved: ${indexingFile}`);

  log('=== Done ===');
}

// ─── Main: カテゴリページモード ─────────────────────────

async function mainCategories() {
  log('=== Indexing Request Script Start (CATEGORY MODE) ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found in .env');
    process.exit(1);
  }

  // 1. カテゴリURL一覧構築
  const urls: string[] = [
    `${SITE_URL}type/`,   // タイプ一覧
    `${SITE_URL}fish/`,   // 対象魚一覧
    ...Object.values(TYPE_SLUG_MAP).map(s => `${SITE_URL}type/${s}/`),
    ...Object.values(FISH_SLUG_MAP).map(s => `${SITE_URL}fish/${s}/`),
  ];

  // 重複排除（同じslugが2つのキーに割り当たっている場合）
  const uniqueUrls = [...new Set(urls)].sort();
  log(`Total category pages: ${uniqueUrls.length} (${Object.keys(TYPE_SLUG_MAP).length} types + ${Object.keys(FISH_SLUG_MAP).length} fish + 2 index pages)`);

  // 2. dry-run表示
  if (!DO_SUBMIT) {
    log('');
    log(`--- Dry Run: ${uniqueUrls.length} URLs would be submitted ---`);
    for (const url of uniqueUrls) {
      log(`  📤 ${url.replace(SITE_URL, '/')}`);
    }
    log('');
    log('Run with --categories --submit to actually send Indexing API requests');
    return;
  }

  // 3. Access Token取得 + 送信
  const token = await getAccessToken();
  log('Access token obtained');

  const results = await submitBatch(token, uniqueUrls, 'categories');

  // 4. 結果を保存
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const indexingFile = path.join(DATA_DIR, `indexing-categories-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(indexingFile, JSON.stringify({
    date: new Date().toISOString(),
    mode: 'categories',
    totalCategoryPages: uniqueUrls.length,
    summary: {
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    },
    results,
  }, null, 2));
  log(`Results saved: ${indexingFile}`);

  log('=== Done ===');
}

// ─── Main: ガイド・ランキング・新着ページモード ──────────

async function mainPages() {
  log('=== Indexing Request Script Start (PAGES MODE) ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found in .env');
    process.exit(1);
  }

  // 1. URL一覧構築
  const urls: string[] = [
    `${SITE_URL}maker/`,                       // メーカー一覧
    `${SITE_URL}new/`,                          // 新着ページ
    `${SITE_URL}guide/`,                        // ガイド一覧
    `${SITE_URL}ranking/`,                      // ランキング一覧
    `${SITE_URL}compare/`,                      // 比較一覧
    `${SITE_URL}article/`,                      // 特集記事一覧
    // ガイド記事（全件）
    ...guideArticles.map((g: any) => `${SITE_URL}guide/${g.slug}/`),
  ];

  // 特集記事ページ
  try {
    const { contentArticles } = await import('../src/data/articles/_index.js');
    urls.push(...contentArticles.map((a: any) => `${SITE_URL}article/${a.slug}/`));
    log(`Article pages: ${contentArticles.length}`);
  } catch {
    log('Warning: articles not found, skipping article pages');
  }

  // ランキングページ: ranking-descriptions.tsのキーから構築
  // DBクロス集計と同等（エディトリアル付きページが優先対象）
  try {
    const { rankingDescriptions } = await import('../src/data/ranking-descriptions.js');
    const rankingSlugs = Object.keys(rankingDescriptions);
    urls.push(...rankingSlugs.map(s => `${SITE_URL}ranking/${s}/`));
    // 比較ページも同一slug体系で追加
    urls.push(...rankingSlugs.map(s => `${SITE_URL}compare/${s}/`));
    log(`Ranking pages with editorial: ${rankingSlugs.length}`);
    log(`Compare pages: ${rankingSlugs.length}`);
  } catch {
    log('Warning: ranking-descriptions not found, skipping ranking/compare pages');
  }

  const uniqueUrls = [...new Set(urls)].sort();
  log(`Total pages: ${uniqueUrls.length}`);

  // 2. dry-run表示
  if (!DO_SUBMIT) {
    log('');
    log(`--- Dry Run: ${uniqueUrls.length} URLs would be submitted ---`);
    for (const url of uniqueUrls.slice(0, 30)) {
      log(`  📤 ${url.replace(SITE_URL, '/')}`);
    }
    if (uniqueUrls.length > 30) log(`  ... and ${uniqueUrls.length - 30} more`);
    log('');
    log('Run with --pages --submit to actually send Indexing API requests');
    return;
  }

  // 3. Access Token取得 + 送信
  const token = await getAccessToken();
  log('Access token obtained');

  const results = await submitBatch(token, uniqueUrls, 'pages');

  // 4. 結果を保存
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const indexingFile = path.join(DATA_DIR, `indexing-pages-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(indexingFile, JSON.stringify({
    date: new Date().toISOString(),
    mode: 'pages',
    totalPages: uniqueUrls.length,
    summary: {
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    },
    results,
  }, null, 2));
  log(`Results saved: ${indexingFile}`);

  log('=== Done ===');
}

// ─── Entry Point ──────────────────────────────────────

const mainFn = PAGES_MODE ? mainPages : CATEGORY_MODE ? mainCategories : LURE_MODE ? mainLures : mainMakers;
mainFn().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
