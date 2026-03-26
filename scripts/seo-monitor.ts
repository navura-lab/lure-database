#!/usr/bin/env npx tsx
/**
 * SEO日次監視スクリプト v2
 *
 * 強化機能:
 * - ページ種別分析（メーカー、ルアー、ガイド、カタログ、カテゴリ）
 * - 週次トレンド比較（今週 vs 先週）
 * - デバイス別分析（モバイル vs デスクトップ）
 * - インデックス進捗統合（daily-indexing.ts の進捗を表示）
 * - インデックスカバレッジサンプリング（--inspect 時、各種別5URL）
 *
 * Usage:
 *   npx tsx scripts/seo-monitor.ts            # 日次レポート
 *   npx tsx scripts/seo-monitor.ts --inspect   # URL検査サンプリングも実行
 *   npx tsx scripts/seo-monitor.ts --verbose    # 詳細出力
 *
 * Cron (launchd):
 *   毎日 7:00 JST (22:00 UTC前日) に自動実行
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// ─── Config ───────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:castlog.xyz';
const SLACK_WEBHOOK = process.env.SLACK_SEO_WEBHOOK; // オプション

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const LOG_DIR = path.join(import.meta.dirname, '..', 'logs');
const PROGRESS_FILE = path.join(DATA_DIR, 'indexing-progress.json');

const VERBOSE = process.argv.includes('--verbose');
const DO_INSPECT = process.argv.includes('--inspect');

// ─── Helper ───────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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

function todayStr() { return new Date().toISOString().split('T')[0]; }
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

// ─── ページ種別分類 ──────────────────────────────────

type PageType = 'guide' | 'ranking' | 'maker' | 'lure' | 'fish' | 'type' | 'new' | 'top' | 'other';

function classifyPageUrl(url: string): PageType {
  const p = url.replace(SITE_URL, '/');
  if (p === '/') return 'top';
  if (p.startsWith('/guide/')) return 'guide';
  if (p.startsWith('/ranking/')) return 'ranking';
  if (p.startsWith('/fish/')) return 'fish';
  if (p.startsWith('/type/')) return 'type';
  if (p.startsWith('/new/')) return 'new';
  if (p.startsWith('/maker/')) return 'maker';
  // /{maker}/ vs /{maker}/{slug}/ 判定
  const segments = p.split('/').filter(Boolean);
  if (segments.length === 1) return 'maker';
  if (segments.length === 2) return 'lure';
  return 'other';
}

interface PageTypeStats {
  type: PageType;
  clicks: number;
  impressions: number;
  avgPosition: number;
  pageCount: number;
}

function aggregateByPageType(pages: SearchAnalyticsRow[]): PageTypeStats[] {
  const map = new Map<PageType, { clicks: number; impressions: number; positions: number[]; count: number }>();

  for (const p of pages) {
    const pt = classifyPageUrl(p.keys[0]);
    const existing = map.get(pt) || { clicks: 0, impressions: 0, positions: [], count: 0 };
    existing.clicks += p.clicks;
    existing.impressions += p.impressions;
    existing.positions.push(p.position);
    existing.count++;
    map.set(pt, existing);
  }

  const result: PageTypeStats[] = [];
  for (const [type, stats] of map) {
    const avgPos = stats.positions.length > 0
      ? stats.positions.reduce((a, b) => a + b, 0) / stats.positions.length
      : 0;
    result.push({
      type,
      clicks: stats.clicks,
      impressions: stats.impressions,
      avgPosition: avgPos,
      pageCount: stats.count,
    });
  }

  return result.sort((a, b) => b.impressions - a.impressions);
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
  // 基本メトリクス（直近7日間 = daysAgo(9) ~ daysAgo(2)）
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  // Top クエリ・ページ
  topQueries: SearchAnalyticsRow[];
  topPages: SearchAnalyticsRow[];
  // ページ種別分析
  pageTypeBreakdown: PageTypeStats[];
  // デバイス別（オプション）
  deviceBreakdown?: { device: string; clicks: number; impressions: number; ctr: number; position: number }[];
  // サイトマップ
  sitemaps: any[];
  // 週次比較データ（先週同期間）
  weeklyComparison?: {
    prevClicks: number;
    prevImpressions: number;
    prevCtr: number;
    prevPosition: number;
  };
  // インデックス進捗（daily-indexing.ts から読み込み）
  indexingProgress?: {
    lure_offset: number;
    total_submitted: number;
    last_run: string;
  };
  // インデックス推移追跡（サイトマップ + indexing-progress統合）
  indexCoverage?: {
    sitemapSubmitted: number;   // サイトマップ送信URL数
    sitemapIndexed: number;     // インデックス済みURL数（GSCサイトマップから）
    indexingApiSubmitted: number; // Indexing API送信済み件数
    indexingApiOffset: number;    // 現在のオフセット
    deltaSubmitted: number;     // 前日比（送信数）
    deltaIndexed: number;       // 前日比（インデックス数）
  };
  // URL検査（--inspect 時）
  inspections?: Record<string, any>;
}

/** YYYY-MM-DD.json パターンにマッチするファイルのみ読み込む */
function loadDailyDataFiles(days = 14): DailyData[] {
  try {
    const datePattern = /^\d{4}-\d{2}-\d{2}\.json$/;
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => datePattern.test(f))
      .sort()
      .reverse()
      .slice(0, days);

    return files.map(f => {
      const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      return raw as DailyData;
    });
  } catch {
    return [];
  }
}

function loadPreviousData(): DailyData | null {
  const all = loadDailyDataFiles(1);
  return all.length > 0 ? all[0] : null;
}

function saveData(data: DailyData) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filename = `${data.date}.json`;
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
  logV(`Data saved: ${filename}`);
}

function loadIndexingProgress(): { lure_offset: number; total_submitted: number; last_run: string } | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      return {
        lure_offset: data.lure_offset || 0,
        total_submitted: data.total_submitted || 0,
        last_run: data.last_run || '',
      };
    }
  } catch { /* ignore */ }
  return null;
}

// ─── インデックス推移追跡 ────────────────────────────

interface IndexCoverage {
  sitemapSubmitted: number;
  sitemapIndexed: number;
  indexingApiSubmitted: number;
  indexingApiOffset: number;
  deltaSubmitted: number;
  deltaIndexed: number;
}

function buildIndexCoverage(
  sitemaps: any[],
  indexingProgress: { lure_offset: number; total_submitted: number; last_run: string } | null,
  previousData: DailyData | null,
): IndexCoverage {
  // サイトマップから送信URL数・インデックス済み数を集計
  let sitemapSubmitted = 0;
  let sitemapIndexed = 0;

  for (const sm of sitemaps) {
    if (sm.contents && Array.isArray(sm.contents)) {
      for (const c of sm.contents) {
        sitemapSubmitted += parseInt(c.submitted || '0', 10);
        sitemapIndexed += parseInt(c.indexed || '0', 10);
      }
    }
  }

  const indexingApiSubmitted = indexingProgress?.total_submitted || 0;
  const indexingApiOffset = indexingProgress?.lure_offset || 0;

  // 前日比を計算
  const prevCoverage = previousData?.indexCoverage;
  const deltaSubmitted = prevCoverage ? sitemapSubmitted - prevCoverage.sitemapSubmitted : 0;
  const deltaIndexed = prevCoverage ? sitemapIndexed - prevCoverage.sitemapIndexed : 0;

  return {
    sitemapSubmitted,
    sitemapIndexed,
    indexingApiSubmitted,
    indexingApiOffset,
    deltaSubmitted,
    deltaIndexed,
  };
}

// ─── インデックスカバレッジサンプリング ──────────────

interface CoverageSample {
  type: string;
  total: number;
  indexed: number;
  samples: { url: string; verdict: string; state: string }[];
}

async function sampleIndexingCoverage(token: string): Promise<CoverageSample[]> {
  // 各ページ種別から5URLずつランダムサンプリングしてURL検査
  const samples: CoverageSample[] = [];

  // ビルド済みページからサンプル取得
  const distDir = path.join(import.meta.dirname, '..', 'dist', 'client');

  const pageTypeDirs: { type: string; dir: string; prefix: string }[] = [
    { type: 'guide', dir: path.join(distDir, 'guide'), prefix: `${SITE_URL}guide/` },
    { type: 'ranking', dir: path.join(distDir, 'ranking'), prefix: `${SITE_URL}ranking/` },
    { type: 'fish', dir: path.join(distDir, 'fish'), prefix: `${SITE_URL}fish/` },
    { type: 'type', dir: path.join(distDir, 'type'), prefix: `${SITE_URL}type/` },
  ];

  for (const pt of pageTypeDirs) {
    try {
      const entries = fs.readdirSync(pt.dir).filter(e => e !== 'index.html' && !e.includes('.'));
      const total = entries.length;
      // ランダム5件サンプリング
      const shuffled = entries.sort(() => Math.random() - 0.5).slice(0, 5);
      const sampleResults: CoverageSample['samples'] = [];
      let indexed = 0;

      for (const slug of shuffled) {
        const url = `${pt.prefix}${slug}/`;
        logV(`  Inspecting [${pt.type}]: ${url}`);
        const result = await inspectUrl(token, url);
        const verdict = result?.inspectionResult?.indexStatusResult?.verdict || 'UNKNOWN';
        const state = result?.inspectionResult?.indexStatusResult?.coverageState || '';
        if (verdict === 'PASS') indexed++;
        sampleResults.push({ url: url.replace(SITE_URL, '/'), verdict, state });
        await sleep(800);
      }

      samples.push({
        type: pt.type,
        total,
        indexed,
        samples: sampleResults,
      });
    } catch (e) {
      logV(`Warning: Could not sample ${pt.type}: ${e}`);
    }
  }

  // メーカーページ: dist直下の1文字目がアルファベットのディレクトリ
  try {
    const topDirs = fs.readdirSync(distDir).filter(e => {
      if (e.includes('.') || ['guide', 'ranking', 'fish', 'type', 'new', 'maker', 'search', 'trap', '_astro'].includes(e)) return false;
      try { return fs.statSync(path.join(distDir, e)).isDirectory(); } catch { return false; }
    });

    // メーカーページ（index.htmlが直下にあるディレクトリ）
    const makerDirs = topDirs.filter(d => fs.existsSync(path.join(distDir, d, 'index.html')));
    const shuffledMakers = makerDirs.sort(() => Math.random() - 0.5).slice(0, 5);
    const makerSamples: CoverageSample['samples'] = [];
    let makerIndexed = 0;

    for (const slug of shuffledMakers) {
      const url = `${SITE_URL}${slug}/`;
      logV(`  Inspecting [maker]: ${url}`);
      const result = await inspectUrl(token, url);
      const verdict = result?.inspectionResult?.indexStatusResult?.verdict || 'UNKNOWN';
      const state = result?.inspectionResult?.indexStatusResult?.coverageState || '';
      if (verdict === 'PASS') makerIndexed++;
      makerSamples.push({ url: url.replace(SITE_URL, '/'), verdict, state });
      await sleep(800);
    }

    samples.push({
      type: 'maker',
      total: makerDirs.length,
      indexed: makerIndexed,
      samples: makerSamples,
    });
  } catch (e) {
    logV(`Warning: Could not sample makers: ${e}`);
  }

  return samples;
}

// ─── Report Builder ───────────────────────────────────

function buildReport(current: DailyData, previous: DailyData | null): string {
  const lines: string[] = [];
  lines.push(`📊 *CAST/LOG SEO日次レポート* (${current.date})`);
  lines.push('');

  // ── サマリー ──
  lines.push('*── サマリー（直近7日間）──*');
  lines.push(`クリック: ${current.totalClicks}` +
    (previous ? ` (前回比: ${delta(current.totalClicks, previous.totalClicks)})` : ''));
  lines.push(`表示回数: ${current.totalImpressions}` +
    (previous ? ` (前回比: ${delta(current.totalImpressions, previous.totalImpressions)})` : ''));
  lines.push(`平均CTR: ${(current.avgCtr * 100).toFixed(2)}%` +
    (previous ? ` (前回: ${(previous.avgCtr * 100).toFixed(2)}%)` : ''));
  lines.push(`平均掲載順位: ${current.avgPosition.toFixed(1)}` +
    (previous ? ` (前回: ${previous.avgPosition.toFixed(1)})` : ''));
  lines.push('');

  // ── 週次比較 ──
  if (current.weeklyComparison) {
    const wc = current.weeklyComparison;
    lines.push('*── 週次比較（今週 vs 先週）──*');
    lines.push(`クリック: ${current.totalClicks} vs ${wc.prevClicks} (${deltaPercent(current.totalClicks, wc.prevClicks)})`);
    lines.push(`表示回数: ${current.totalImpressions} vs ${wc.prevImpressions} (${deltaPercent(current.totalImpressions, wc.prevImpressions)})`);
    lines.push(`平均CTR: ${(current.avgCtr * 100).toFixed(2)}% vs ${(wc.prevCtr * 100).toFixed(2)}%`);
    lines.push(`平均順位: ${current.avgPosition.toFixed(1)} vs ${wc.prevPosition.toFixed(1)}`);
    lines.push('');
  }

  // ── ページ種別分析 ──
  if (current.pageTypeBreakdown.length > 0) {
    lines.push('*── ページ種別パフォーマンス ──*');
    const typeLabels: Record<string, string> = {
      guide: 'ガイド', ranking: 'カタログ', maker: 'メーカー',
      lure: 'ルアー詳細', fish: '魚種', type: 'タイプ',
      new: '新着', top: 'トップ', other: 'その他',
    };
    for (const pt of current.pageTypeBreakdown) {
      const label = typeLabels[pt.type] || pt.type;
      lines.push(`  ${label}: ${pt.clicks}click ${pt.impressions}imp pos:${pt.avgPosition.toFixed(1)} (${pt.pageCount}ページ)`);
    }
    lines.push('');
  }

  // ── デバイス別 ──
  if (current.deviceBreakdown && current.deviceBreakdown.length > 0) {
    lines.push('*── デバイス別 ──*');
    for (const d of current.deviceBreakdown) {
      lines.push(`  ${d.device}: ${d.clicks}click ${d.impressions}imp CTR:${(d.ctr * 100).toFixed(1)}%`);
    }
    lines.push('');
  }

  // ── Top検索クエリ ──
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

  // ── Topページ ──
  if (current.topPages.length > 0) {
    lines.push('*── Topページ ──*');
    for (const p of current.topPages.slice(0, 10)) {
      const pageUrl = p.keys[0].replace(SITE_URL, '/');
      const pt = classifyPageUrl(p.keys[0]);
      lines.push(`  [${pt}] ${pageUrl} — ${p.clicks}click ${p.impressions}imp pos:${p.position.toFixed(1)}`);
    }
    lines.push('');
  }

  // ── サイトマップ ──
  if (current.sitemaps.length > 0) {
    lines.push('*── サイトマップ ──*');
    for (const sm of current.sitemaps) {
      lines.push(`  ${sm.path} — エラー:${sm.errors} 警告:${sm.warnings}`);
    }
    lines.push('');
  }

  // ── インデックス推移 ──
  if (current.indexCoverage) {
    const ic = current.indexCoverage;
    lines.push('*── インデックス推移 ──*');
    lines.push(`  サイトマップ送信URL: ${ic.sitemapSubmitted.toLocaleString()}件${ic.deltaSubmitted !== 0 ? ` (前日比: ${delta(ic.sitemapSubmitted, ic.sitemapSubmitted - ic.deltaSubmitted)})` : ''}`);
    lines.push(`  インデックス済み: ${ic.sitemapIndexed.toLocaleString()}件${ic.deltaIndexed !== 0 ? ` (前日比: ${delta(ic.sitemapIndexed, ic.sitemapIndexed - ic.deltaIndexed)})` : ''}`);
    if (ic.sitemapSubmitted > 0) {
      const rate = (ic.sitemapIndexed / ic.sitemapSubmitted * 100).toFixed(1);
      lines.push(`  インデックス率: ${rate}%`);
    }
    lines.push(`  Indexing API送信済み: ${ic.indexingApiSubmitted.toLocaleString()}件 (offset: ${ic.indexingApiOffset})`);
    lines.push('');
  }

  // ── インデックス送信進捗（後方互換） ──
  if (!current.indexCoverage && current.indexingProgress) {
    const ip = current.indexingProgress;
    lines.push('*── インデックス送信進捗 ──*');
    lines.push(`  送信済み: ${ip.lure_offset}件 / 総送信: ${ip.total_submitted}件`);
    lines.push(`  最終実行: ${ip.last_run || '未実行'}`);
    lines.push('');
  }

  // ── URL検査結果 ──
  if (current.inspections) {
    lines.push('*── インデックスカバレッジ（サンプル調査）──*');
    // inspections が CoverageSample[] 形式の場合
    if (Array.isArray(current.inspections)) {
      for (const cs of current.inspections as unknown as CoverageSample[]) {
        const rate = cs.samples.length > 0 ? `${cs.indexed}/${cs.samples.length}` : 'N/A';
        lines.push(`  ${cs.type}: ${rate} indexed (全${cs.total}ページ中サンプル${cs.samples.length}件)`);
        for (const s of cs.samples) {
          const emoji = s.verdict === 'PASS' ? '✅' : s.verdict === 'NEUTRAL' ? '⚠️' : '❌';
          lines.push(`    ${emoji} ${s.url} — ${s.verdict} (${s.state})`);
        }
      }
    } else {
      // 旧形式: Record<string, any>
      for (const [url, result] of Object.entries(current.inspections)) {
        const r = (result as any).inspectionResult;
        if (r) {
          const status = r.indexStatusResult?.verdict || 'UNKNOWN';
          const state = r.indexStatusResult?.coverageState || '';
          const emoji = status === 'PASS' ? '✅' : status === 'NEUTRAL' ? '⚠️' : '❌';
          lines.push(`  ${emoji} ${url.replace(SITE_URL, '/')} — ${status} (${state})`);
        }
      }
    }
    lines.push('');
  }

  // ── アラート ──
  const alerts = checkAlerts(current, previous);
  if (alerts.length > 0) {
    lines.push('*🚨 アラート 🚨*');
    for (const a of alerts) {
      lines.push(`  ⚠️ ${a}`);
    }
  } else {
    lines.push('✅ 異常なし');
  }

  return lines.join('\n');
}

function delta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function deltaPercent(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+∞' : '±0';
  const pct = ((current - previous) / previous * 100).toFixed(1);
  const sign = current >= previous ? '+' : '';
  return `${sign}${pct}%`;
}

function checkAlerts(current: DailyData, previous: DailyData | null): string[] {
  const alerts: string[] = [];

  if (previous) {
    // インプレッション急減（前回比50%以下）
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

  // 週次比較: 先週比で30%以上のインプレッション減
  if (current.weeklyComparison) {
    const wc = current.weeklyComparison;
    if (wc.prevImpressions > 20 && current.totalImpressions < wc.prevImpressions * 0.7) {
      alerts.push(`週次インプレッション低下: ${wc.prevImpressions} → ${current.totalImpressions} (${deltaPercent(current.totalImpressions, wc.prevImpressions)})`);
    }
  }

  // サイトマップエラー
  for (const sm of current.sitemaps) {
    if (sm.errors > 0) {
      alerts.push(`サイトマップエラー: ${sm.path} (${sm.errors}件)`);
    }
  }

  // インデックス数が前日比で大幅減少
  if (current.indexCoverage && previous?.indexCoverage) {
    if (current.indexCoverage.deltaIndexed < -100) {
      alerts.push(`インデックス数が急減: ${previous.indexCoverage.sitemapIndexed} → ${current.indexCoverage.sitemapIndexed} (${current.indexCoverage.deltaIndexed})`);
    }
  }

  // インデックス送信が3日以上止まっている
  if (current.indexingProgress) {
    const lastRun = current.indexingProgress.last_run;
    if (lastRun) {
      const daysSinceRun = Math.floor((Date.now() - new Date(lastRun).getTime()) / 86400000);
      if (daysSinceRun > 3) {
        alerts.push(`インデックス送信が${daysSinceRun}日間停止中（最終: ${lastRun}）`);
      }
    }
  }

  return alerts;
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Monitor v2 Start ===');

  // 前提チェック
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN が .env に必要');
    process.exit(1);
  }

  // Access Token取得
  const token = await getAccessToken();
  logV('Access token obtained');

  // 期間: 直近7日間（GSCのデータは2-3日遅延があるため）
  const endDate = daysAgo(2);     // 2日前まで
  const startDate = daysAgo(9);   // 9日前から（7日間）

  // 先週の期間（週次比較用）
  const prevEndDate = daysAgo(9);    // 9日前まで
  const prevStartDate = daysAgo(16); // 16日前から

  // 1. 検索パフォーマンス（全体・今週）
  log('Fetching search analytics (this week summary)...');
  const summaryRows = await getSearchAnalytics(token, startDate, endDate, [], 1);
  const totalClicks = summaryRows.length > 0 ? summaryRows[0].clicks : 0;
  const totalImpressions = summaryRows.length > 0 ? summaryRows[0].impressions : 0;
  const avgCtr = summaryRows.length > 0 ? summaryRows[0].ctr : 0;
  const avgPosition = summaryRows.length > 0 ? summaryRows[0].position : 0;

  // 2. 先週のパフォーマンス（週次比較用）
  log('Fetching search analytics (last week summary)...');
  const prevSummaryRows = await getSearchAnalytics(token, prevStartDate, prevEndDate, [], 1);
  const weeklyComparison = prevSummaryRows.length > 0 ? {
    prevClicks: prevSummaryRows[0].clicks,
    prevImpressions: prevSummaryRows[0].impressions,
    prevCtr: prevSummaryRows[0].ctr,
    prevPosition: prevSummaryRows[0].position,
  } : undefined;

  // 3. Top クエリ
  log('Fetching top queries...');
  const topQueries = await getSearchAnalytics(token, startDate, endDate, ['query'], 30);

  // 4. Top ページ（種別分析用に多めに取得）
  log('Fetching top pages...');
  const topPages = await getSearchAnalytics(token, startDate, endDate, ['page'], 100);

  // 5. ページ種別分析
  const pageTypeBreakdown = aggregateByPageType(topPages);

  // 6. デバイス別分析
  log('Fetching device breakdown...');
  const deviceRows = await getSearchAnalytics(token, startDate, endDate, ['device'], 5);
  const deviceBreakdown = deviceRows.map(r => ({
    device: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  // 7. サイトマップ
  log('Fetching sitemaps...');
  const sitemaps = await getSitemapInfo(token);

  // 8. インデックス送信進捗
  const indexingProgress = loadIndexingProgress();

  // 9. 前回データ読み込み（indexCoverage計算用に先に取得）
  const previous = loadPreviousData();

  // 10. インデックス推移追跡
  const indexCoverage = buildIndexCoverage(sitemaps, indexingProgress, previous);
  log(`Index coverage: submitted=${indexCoverage.sitemapSubmitted} indexed=${indexCoverage.sitemapIndexed} apiSent=${indexCoverage.indexingApiSubmitted}`);

  // 11. URL検査（オプション）
  let inspections: CoverageSample[] | undefined;
  if (DO_INSPECT) {
    log('Running indexing coverage sampling...');
    inspections = await sampleIndexingCoverage(token);
  }

  // データ構築
  const currentData: DailyData = {
    date: todayStr(),
    timestamp: new Date().toISOString(),
    totalClicks,
    totalImpressions,
    avgCtr,
    avgPosition,
    topQueries,
    topPages: topPages.slice(0, 20), // 保存は上位20件のみ
    pageTypeBreakdown,
    deviceBreakdown,
    sitemaps,
    weeklyComparison,
    indexingProgress: indexingProgress || undefined,
    indexCoverage,
    inspections: inspections as any,
  };

  // レポート生成
  const report = buildReport(currentData, previous);
  console.log('\n' + report);

  // データ保存
  saveData(currentData);

  // Slack通知
  if (SLACK_WEBHOOK) {
    await sendSlack(report);
  }

  // ログファイルにも保存
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(LOG_DIR, 'seo-monitor.log'),
    `\n${report}\n${'='.repeat(60)}\n`,
  );

  log(`=== SEO Monitor v2 Complete (clicks:${totalClicks} imp:${totalImpressions} queries:${topQueries.length} pageTypes:${pageTypeBreakdown.length}) ===`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
