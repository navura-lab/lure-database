#!/usr/bin/env npx tsx
/**
 * SEO日次監視スクリプト
 * - Google Search Console APIからインデックス状況・検索パフォーマンスを取得
 * - 前日データとの差分を計算
 * - 異常があればSlackアラート送信
 *
 * Usage:
 *   npx tsx scripts/seo-monitor.ts            # 日次レポート
 *   npx tsx scripts/seo-monitor.ts --inspect   # 主要ページのURL検査も実行
 *   npx tsx scripts/seo-monitor.ts --verbose    # 詳細出力
 *
 * Cron:
 *   0 7 * * * cd /Users/user/ウェブサイト/lure-database && npx tsx scripts/seo-monitor.ts >> logs/seo-monitor.log 2>&1
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// ─── Config ───────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = process.env.GSC_SITE_URL || 'https://www.lure-db.com/';
const SLACK_WEBHOOK = process.env.SLACK_SEO_WEBHOOK; // オプション

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const LOG_DIR = path.join(import.meta.dirname, '..', 'logs');

const VERBOSE = process.argv.includes('--verbose');
const DO_INSPECT = process.argv.includes('--inspect');

// ─── Helper ───────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

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

function gscHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'x-goog-user-project': QUOTA_PROJECT,
    'Content-Type': 'application/json',
  };
}

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ─── API Calls ────────────────────────────────────────

interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function getSearchAnalytics(
  token: string,
  startDate: string,
  endDate: string,
  dimensions: string[] = ['query'],
  rowLimit = 50,
): Promise<SearchAnalyticsRow[]> {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: gscHeaders(token),
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    },
  );
  const data = await res.json() as any;
  return data.rows || [];
}

async function getSitemapInfo(token: string) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/sitemaps`,
    { headers: gscHeaders(token) },
  );
  const data = await res.json() as any;
  return data.sitemap || [];
}

async function inspectUrl(token: string, url: string) {
  const res = await fetch(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    {
      method: 'POST',
      headers: gscHeaders(token),
      body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL }),
    },
  );
  return await res.json() as any;
}

// ─── Slack ────────────────────────────────────────────

async function sendSlack(text: string) {
  if (!SLACK_WEBHOOK) {
    logV('Slack webhook not configured, skipping');
    return;
  }
  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    logV('Slack notification sent');
  } catch (e) {
    log(`Slack send error: ${e}`);
  }
}

// ─── Data Persistence ─────────────────────────────────

interface DailyData {
  date: string;
  timestamp: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: SearchAnalyticsRow[];
  topPages: SearchAnalyticsRow[];
  sitemaps: any[];
  inspections?: Record<string, any>;
}

function loadPreviousData(): DailyData | null {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[0]), 'utf8'));
  } catch {
    return null;
  }
}

function saveData(data: DailyData) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filename = `${data.date}.json`;
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
  logV(`Data saved: ${filename}`);
}

// ─── Report Builder ───────────────────────────────────

function buildReport(current: DailyData, previous: DailyData | null): string {
  const lines: string[] = [];
  lines.push(`📊 *lure-db.com SEO日次レポート* (${current.date})`);
  lines.push('');

  // Summary
  lines.push('*── サマリー ──*');
  lines.push(`クリック: ${current.totalClicks}` +
    (previous ? ` (前日比: ${delta(current.totalClicks, previous.totalClicks)})` : ''));
  lines.push(`表示回数: ${current.totalImpressions}` +
    (previous ? ` (前日比: ${delta(current.totalImpressions, previous.totalImpressions)})` : ''));
  lines.push(`平均CTR: ${(current.avgCtr * 100).toFixed(2)}%` +
    (previous ? ` (前日: ${(previous.avgCtr * 100).toFixed(2)}%)` : ''));
  lines.push(`平均掲載順位: ${current.avgPosition.toFixed(1)}` +
    (previous ? ` (前日: ${previous.avgPosition.toFixed(1)})` : ''));
  lines.push('');

  // Top Queries
  if (current.topQueries.length > 0) {
    lines.push('*── Top検索クエリ ──*');
    for (const q of current.topQueries.slice(0, 10)) {
      lines.push(`  "${q.keys[0]}" — ${q.clicks}click ${q.impressions}imp CTR:${(q.ctr * 100).toFixed(1)}% pos:${q.position.toFixed(1)}`);
    }
    lines.push('');
  } else {
    lines.push('*検索クエリ: データなし（インプレッション0）*');
    lines.push('');
  }

  // Top Pages
  if (current.topPages.length > 0) {
    lines.push('*── Topページ ──*');
    for (const p of current.topPages.slice(0, 10)) {
      const pageUrl = p.keys[0].replace(SITE_URL, '/');
      lines.push(`  ${pageUrl} — ${p.clicks}click ${p.impressions}imp`);
    }
    lines.push('');
  }

  // Sitemaps
  if (current.sitemaps.length > 0) {
    lines.push('*── サイトマップ ──*');
    for (const sm of current.sitemaps) {
      lines.push(`  ${sm.path} — エラー:${sm.errors} 警告:${sm.warnings}`);
    }
    lines.push('');
  }

  // URL Inspections
  if (current.inspections) {
    lines.push('*── URL検査 ──*');
    for (const [url, result] of Object.entries(current.inspections)) {
      const r = (result as any).inspectionResult;
      if (r) {
        const status = r.indexStatusResult?.verdict || 'UNKNOWN';
        const state = r.indexStatusResult?.coverageState || '';
        const emoji = status === 'PASS' ? '✅' : status === 'NEUTRAL' ? '⚠️' : '❌';
        lines.push(`  ${emoji} ${url.replace(SITE_URL, '/')} — ${status} (${state})`);
      }
    }
    lines.push('');
  }

  // Alerts
  const alerts = checkAlerts(current, previous);
  if (alerts.length > 0) {
    lines.push('*🚨 アラート 🚨*');
    for (const a of alerts) {
      lines.push(`  ⚠️ ${a}`);
    }
  }

  return lines.join('\n');
}

function delta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function checkAlerts(current: DailyData, previous: DailyData | null): string[] {
  const alerts: string[] = [];

  if (previous) {
    // インプレッション急減（前日比50%以下）
    if (previous.totalImpressions > 10 && current.totalImpressions < previous.totalImpressions * 0.5) {
      alerts.push(`表示回数が急減: ${previous.totalImpressions} → ${current.totalImpressions}`);
    }
    // クリック急減
    if (previous.totalClicks > 5 && current.totalClicks < previous.totalClicks * 0.5) {
      alerts.push(`クリックが急減: ${previous.totalClicks} → ${current.totalClicks}`);
    }
    // 平均順位悪化（5以上上昇）
    if (current.avgPosition - previous.avgPosition > 5) {
      alerts.push(`平均掲載順位が悪化: ${previous.avgPosition.toFixed(1)} → ${current.avgPosition.toFixed(1)}`);
    }
  }

  // サイトマップエラー
  for (const sm of current.sitemaps) {
    if (sm.errors > 0) {
      alerts.push(`サイトマップエラー: ${sm.path} (${sm.errors}件)`);
    }
  }

  // URL検査でインデックスされていないページ
  if (current.inspections) {
    for (const [url, result] of Object.entries(current.inspections)) {
      const verdict = (result as any).inspectionResult?.indexStatusResult?.verdict;
      if (verdict && verdict !== 'PASS') {
        alerts.push(`インデックス問題: ${url.replace(SITE_URL, '/')} (${verdict})`);
      }
    }
  }

  return alerts;
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Monitor Start ===');

  // 前提チェック
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN が .env に必要');
    process.exit(1);
  }

  // Access Token取得
  const token = await getAccessToken();
  logV('Access token obtained');

  // 期間: 直近7日間（GSCのデータは2-3日遅延があるため）
  const endDate = daysAgo(2);   // 2日前まで（GSCのデータ遅延考慮）
  const startDate = daysAgo(9); // 9日前から

  // 1. 検索パフォーマンス（全体）
  log('Fetching search analytics (summary)...');
  const summaryRows = await getSearchAnalytics(token, startDate, endDate, [], 1);
  const totalClicks = summaryRows.length > 0 ? summaryRows[0].clicks : 0;
  const totalImpressions = summaryRows.length > 0 ? summaryRows[0].impressions : 0;
  const avgCtr = summaryRows.length > 0 ? summaryRows[0].ctr : 0;
  const avgPosition = summaryRows.length > 0 ? summaryRows[0].position : 0;

  // 2. Top クエリ
  log('Fetching top queries...');
  const topQueries = await getSearchAnalytics(token, startDate, endDate, ['query'], 20);

  // 3. Top ページ
  log('Fetching top pages...');
  const topPages = await getSearchAnalytics(token, startDate, endDate, ['page'], 20);

  // 4. サイトマップ
  log('Fetching sitemaps...');
  const sitemaps = await getSitemapInfo(token);

  // 5. URL検査（オプション）
  let inspections: Record<string, any> | undefined;
  if (DO_INSPECT) {
    log('Inspecting key URLs...');
    const urlsToInspect = [
      SITE_URL,                          // トップ
      `${SITE_URL}daiwa/`,              // 主要メーカー
      `${SITE_URL}shimano/`,
      `${SITE_URL}megabass/`,
      `${SITE_URL}jackall/`,
    ];
    inspections = {};
    for (const url of urlsToInspect) {
      logV(`  Inspecting: ${url}`);
      inspections[url] = await inspectUrl(token, url);
      // Rate limit考慮
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // データ構築
  const currentData: DailyData = {
    date: today(),
    timestamp: new Date().toISOString(),
    totalClicks,
    totalImpressions,
    avgCtr,
    avgPosition,
    topQueries,
    topPages,
    sitemaps,
    inspections,
  };

  // 前日データ読み込み
  const previous = loadPreviousData();

  // レポート生成
  const report = buildReport(currentData, previous);
  console.log('\n' + report);

  // データ保存
  saveData(currentData);

  // Slack通知
  const alerts = checkAlerts(currentData, previous);
  if (SLACK_WEBHOOK) {
    // アラートがある場合は常に通知、なければ日次サマリーのみ
    await sendSlack(report);
  }

  // ログファイルにも保存
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(LOG_DIR, 'seo-monitor.log'),
    `\n${report}\n${'='.repeat(60)}\n`,
  );

  log(`=== SEO Monitor Complete (clicks:${totalClicks} imp:${totalImpressions} queries:${topQueries.length}) ===`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
