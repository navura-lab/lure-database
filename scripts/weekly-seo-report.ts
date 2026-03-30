#!/usr/bin/env npx tsx
/**
 * SEO週次PDCAレポート生成スクリプト
 *
 * 機能:
 * - 過去14日分のseo-monitorデータを集約し、週次比較を生成
 * - クエリ成長/衰退分析
 * - ページ種別トレンド
 * - インデックス送信進捗
 * - PDCA（Plan-Do-Check-Act）自動分析・推奨アクション生成
 * - Markdown形式のレポートをlogs/seo-reports/に保存
 * - Slack通知（オプション）
 *
 * Usage:
 *   npx tsx scripts/weekly-seo-report.ts           # 週次レポート生成
 *   npx tsx scripts/weekly-seo-report.ts --verbose  # 詳細出力
 *
 * Cron (launchd):
 *   毎週月曜 9:00 JST (0:00 UTC) に自動実行
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// ─── Config ───────────────────────────────────────────

const SLACK_WEBHOOK = process.env.SLACK_SEO_WEBHOOK;
// 旧ドメイン（主）: Googleインデックスの主体。2026/09まで301リダイレクト継続
const SITE_URL = process.env.GSC_SITE_URL || 'https://www.lure-db.com/';

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const REPORT_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-reports');
const LOG_DIR = path.join(import.meta.dirname, '..', 'logs');
const PROGRESS_FILE = path.join(DATA_DIR, 'indexing-progress.json');

const VERBOSE = process.argv.includes('--verbose');

// ─── Types ────────────────────────────────────────────

interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PageTypeStats {
  type: string;
  clicks: number;
  impressions: number;
  avgPosition: number;
  pageCount: number;
}

interface DailyData {
  date: string;
  timestamp: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: SearchAnalyticsRow[];
  topPages: SearchAnalyticsRow[];
  pageTypeBreakdown?: PageTypeStats[];
  deviceBreakdown?: { device: string; clicks: number; impressions: number; ctr: number; position: number }[];
  sitemaps: any[];
  weeklyComparison?: {
    prevClicks: number;
    prevImpressions: number;
    prevCtr: number;
    prevPosition: number;
  };
  indexingProgress?: {
    lure_offset: number;
    total_submitted: number;
    last_run: string;
  };
  inspections?: any;
}

interface IndexingProgress {
  lure_offset: number;
  total_submitted: number;
  last_run: string;
  history: { date: string; offset: number; success: number; failed: number }[];
}

// ─── Helpers ──────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] [weekly-report] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

function todayStr() { return new Date().toISOString().split('T')[0]; }

/** YYYY-MM-DD.json パターンにマッチするファイルのみ読み込む */
function loadDailyDataFiles(days = 14): DailyData[] {
  try {
    const datePattern = /^\d{4}-\d{2}-\d{2}\.json$/;
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => datePattern.test(f))
      .sort()
      .reverse()
      .slice(0, days);

    return files.map(f =>
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) as DailyData
    );
  } catch {
    return [];
  }
}

function loadIndexingProgress(): IndexingProgress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

function deltaPercent(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+∞' : '±0';
  const pct = ((current - previous) / previous * 100).toFixed(1);
  const sign = current >= previous ? '+' : '';
  return `${sign}${pct}%`;
}

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

// ─── Analysis ─────────────────────────────────────────

interface WeeklyAnalysis {
  reportDate: string;
  // 基本メトリクス比較
  thisWeek: { clicks: number; impressions: number; ctr: number; position: number; dataPoints: number };
  lastWeek: { clicks: number; impressions: number; ctr: number; position: number; dataPoints: number };
  // クエリ分析
  newQueries: SearchAnalyticsRow[];       // 今週出現、先週なし
  lostQueries: SearchAnalyticsRow[];      // 先週あり、今週消失
  growingQueries: (SearchAnalyticsRow & { prevImpressions: number })[];  // インプレッション増加
  decliningQueries: (SearchAnalyticsRow & { prevImpressions: number })[]; // インプレッション減少
  // ページ種別トレンド
  pageTypeTrend: {
    type: string;
    thisWeekClicks: number; thisWeekImpressions: number;
    lastWeekClicks: number; lastWeekImpressions: number;
  }[];
  // デバイストレンド
  deviceTrend: {
    device: string;
    thisWeekClicks: number; thisWeekImpressions: number;
    lastWeekClicks: number; lastWeekImpressions: number;
  }[];
  // インデックス進捗
  indexingProgress: IndexingProgress | null;
  // PDCA推奨アクション
  recommendations: string[];
}

function analyzeWeekly(dailyData: DailyData[]): WeeklyAnalysis {
  // 最新データと7日前のデータに分割
  const latest = dailyData[0]; // 最新
  const thisWeekData = dailyData.slice(0, 7);
  const lastWeekData = dailyData.slice(7, 14);

  // 基本メトリクス: 最新データのGSC集計値を使用（7日間集計済み）
  const thisWeek = {
    clicks: latest?.totalClicks || 0,
    impressions: latest?.totalImpressions || 0,
    ctr: latest?.avgCtr || 0,
    position: latest?.avgPosition || 0,
    dataPoints: thisWeekData.length,
  };

  // 先週は最新データのweeklyComparisonを使うか、7日前のデータを使う
  const lastWeekSource = latest?.weeklyComparison;
  const lastWeek = lastWeekSource ? {
    clicks: lastWeekSource.prevClicks,
    impressions: lastWeekSource.prevImpressions,
    ctr: lastWeekSource.prevCtr,
    position: lastWeekSource.prevPosition,
    dataPoints: lastWeekData.length,
  } : {
    clicks: 0, impressions: 0, ctr: 0, position: 0, dataPoints: 0,
  };

  // クエリ分析
  const thisWeekQueries = new Map<string, SearchAnalyticsRow>();
  const lastWeekQueries = new Map<string, SearchAnalyticsRow>();

  // 最新のtopQueriesを今週のクエリとして使用
  if (latest?.topQueries) {
    for (const q of latest.topQueries) {
      thisWeekQueries.set(q.keys[0], q);
    }
  }

  // 7日前のデータからクエリを取得
  const oldestRelevant = lastWeekData[0];
  if (oldestRelevant?.topQueries) {
    for (const q of oldestRelevant.topQueries) {
      lastWeekQueries.set(q.keys[0], q);
    }
  }

  // 新規クエリ（今週出現、先週なし）
  const newQueries: SearchAnalyticsRow[] = [];
  for (const [key, q] of thisWeekQueries) {
    if (!lastWeekQueries.has(key)) {
      newQueries.push(q);
    }
  }

  // 消失クエリ（先週あり、今週なし）
  const lostQueries: SearchAnalyticsRow[] = [];
  for (const [key, q] of lastWeekQueries) {
    if (!thisWeekQueries.has(key)) {
      lostQueries.push(q);
    }
  }

  // 成長/衰退クエリ
  const growingQueries: (SearchAnalyticsRow & { prevImpressions: number })[] = [];
  const decliningQueries: (SearchAnalyticsRow & { prevImpressions: number })[] = [];
  for (const [key, q] of thisWeekQueries) {
    const prev = lastWeekQueries.get(key);
    if (prev) {
      if (q.impressions > prev.impressions) {
        growingQueries.push({ ...q, prevImpressions: prev.impressions });
      } else if (q.impressions < prev.impressions) {
        decliningQueries.push({ ...q, prevImpressions: prev.impressions });
      }
    }
  }

  growingQueries.sort((a, b) => (b.impressions - b.prevImpressions) - (a.impressions - a.prevImpressions));
  decliningQueries.sort((a, b) => (a.impressions - a.prevImpressions) - (b.impressions - b.prevImpressions));

  // ページ種別トレンド
  const pageTypeTrend: WeeklyAnalysis['pageTypeTrend'] = [];
  const thisWeekPageTypes = latest?.pageTypeBreakdown || [];
  const lastWeekPageTypes = oldestRelevant?.pageTypeBreakdown || [];

  const allPageTypes = new Set([
    ...thisWeekPageTypes.map(p => p.type),
    ...lastWeekPageTypes.map(p => p.type),
  ]);

  for (const type of allPageTypes) {
    const tw = thisWeekPageTypes.find(p => p.type === type);
    const lw = lastWeekPageTypes.find(p => p.type === type);
    pageTypeTrend.push({
      type,
      thisWeekClicks: tw?.clicks || 0,
      thisWeekImpressions: tw?.impressions || 0,
      lastWeekClicks: lw?.clicks || 0,
      lastWeekImpressions: lw?.impressions || 0,
    });
  }

  // デバイストレンド
  const deviceTrend: WeeklyAnalysis['deviceTrend'] = [];
  const thisWeekDevices = latest?.deviceBreakdown || [];
  const lastWeekDevices = oldestRelevant?.deviceBreakdown || [];

  const allDevices = new Set([
    ...thisWeekDevices.map(d => d.device),
    ...lastWeekDevices.map(d => d.device),
  ]);

  for (const device of allDevices) {
    const tw = thisWeekDevices.find(d => d.device === device);
    const lw = lastWeekDevices.find(d => d.device === device);
    deviceTrend.push({
      device,
      thisWeekClicks: tw?.clicks || 0,
      thisWeekImpressions: tw?.impressions || 0,
      lastWeekClicks: lw?.clicks || 0,
      lastWeekImpressions: lw?.impressions || 0,
    });
  }

  // インデックス進捗
  const indexingProgress = loadIndexingProgress();

  // PDCA推奨アクション生成
  const recommendations = generateRecommendations({
    thisWeek, lastWeek, newQueries, growingQueries, decliningQueries,
    pageTypeTrend, indexingProgress,
  });

  return {
    reportDate: todayStr(),
    thisWeek, lastWeek,
    newQueries, lostQueries, growingQueries, decliningQueries,
    pageTypeTrend, deviceTrend,
    indexingProgress,
    recommendations,
  };
}

function generateRecommendations(ctx: {
  thisWeek: WeeklyAnalysis['thisWeek'];
  lastWeek: WeeklyAnalysis['lastWeek'];
  newQueries: SearchAnalyticsRow[];
  growingQueries: (SearchAnalyticsRow & { prevImpressions: number })[];
  decliningQueries: (SearchAnalyticsRow & { prevImpressions: number })[];
  pageTypeTrend: WeeklyAnalysis['pageTypeTrend'];
  indexingProgress: IndexingProgress | null;
}): string[] {
  const recs: string[] = [];

  // インデックス送信の継続推奨
  if (ctx.indexingProgress) {
    const ip = ctx.indexingProgress;
    if (ip.last_run) {
      const daysSince = Math.floor((Date.now() - new Date(ip.last_run).getTime()) / 86400000);
      if (daysSince > 1) {
        recs.push(`[Do] daily-indexing が${daysSince}日間停止中。launchdの動作確認を推奨`);
      }
    }
  }

  // 成長中のクエリに対するアクション
  if (ctx.newQueries.length > 0) {
    const topNew = ctx.newQueries.slice(0, 3).map(q => `"${q.keys[0]}"`).join(', ');
    recs.push(`[Check] 新出クエリ ${ctx.newQueries.length}件: ${topNew}`);
    recs.push(`[Plan] 新出クエリのランディングページ最適化を検討`);
  }

  // 成長クエリ
  if (ctx.growingQueries.length > 0) {
    const top = ctx.growingQueries[0];
    recs.push(`[Check] 成長クエリ: "${top.keys[0]}" (imp: ${top.prevImpressions}→${top.impressions})`);
    if (top.position > 10) {
      recs.push(`[Act] "${top.keys[0]}" は順位${top.position.toFixed(0)}位。コンテンツ強化で10位以内を狙える`);
    }
  }

  // 衰退クエリ
  if (ctx.decliningQueries.length > 0) {
    const top = ctx.decliningQueries[0];
    recs.push(`[Check] 衰退クエリ: "${top.keys[0]}" (imp: ${top.prevImpressions}→${top.impressions})`);
  }

  // ページ種別パフォーマンス
  for (const pt of ctx.pageTypeTrend) {
    if (pt.lastWeekImpressions > 0 && pt.thisWeekImpressions < pt.lastWeekImpressions * 0.7) {
      const typeLabels: Record<string, string> = {
        guide: 'ガイド', ranking: 'カタログ', maker: 'メーカー',
        lure: 'ルアー詳細', fish: '魚種', type: 'タイプ',
      };
      const label = typeLabels[pt.type] || pt.type;
      recs.push(`[Act] ${label}ページのインプレッションが低下 (${deltaPercent(pt.thisWeekImpressions, pt.lastWeekImpressions)})。コンテンツ見直しを推奨`);
    }
  }

  // トラフィック全体
  if (ctx.lastWeek.impressions > 0) {
    if (ctx.thisWeek.impressions > ctx.lastWeek.impressions * 1.2) {
      recs.push(`[Check] 全体インプレッション好調 (${deltaPercent(ctx.thisWeek.impressions, ctx.lastWeek.impressions)})。成長要因を分析して再現を狙う`);
    }
    if (ctx.thisWeek.clicks > 0 && ctx.thisWeek.ctr < 0.03) {
      recs.push(`[Act] CTRが${(ctx.thisWeek.ctr * 100).toFixed(1)}%と低め。title/descriptionの改善を検討`);
    }
    if (ctx.thisWeek.position > 20) {
      recs.push(`[Plan] 平均順位が${ctx.thisWeek.position.toFixed(0)}位。コンテンツ品質・内部リンク強化を優先`);
    }
  }

  // デフォルト推奨
  if (recs.length === 0) {
    recs.push('[Check] データ蓄積中。日次モニタリングを継続');
    recs.push('[Do] daily-indexingの継続で全ページのインデックス登録を完了させる');
  }

  return recs;
}

// ─── Report Generation ────────────────────────────────

function generateMarkdownReport(analysis: WeeklyAnalysis): string {
  const lines: string[] = [];

  lines.push(`# CAST/LOG SEO週次レポート`);
  lines.push(`\n生成日: ${analysis.reportDate}`);
  lines.push(`\n---\n`);

  // ── サマリー ──
  lines.push(`## 週次サマリー\n`);
  lines.push(`| 指標 | 今週 | 先週 | 変化 |`);
  lines.push(`|------|------|------|------|`);
  lines.push(`| クリック | ${analysis.thisWeek.clicks} | ${analysis.lastWeek.clicks} | ${deltaPercent(analysis.thisWeek.clicks, analysis.lastWeek.clicks)} |`);
  lines.push(`| インプレッション | ${analysis.thisWeek.impressions} | ${analysis.lastWeek.impressions} | ${deltaPercent(analysis.thisWeek.impressions, analysis.lastWeek.impressions)} |`);
  lines.push(`| CTR | ${(analysis.thisWeek.ctr * 100).toFixed(2)}% | ${(analysis.lastWeek.ctr * 100).toFixed(2)}% | - |`);
  lines.push(`| 平均順位 | ${analysis.thisWeek.position.toFixed(1)} | ${analysis.lastWeek.position.toFixed(1)} | - |`);
  lines.push(`| データ日数 | ${analysis.thisWeek.dataPoints} | ${analysis.lastWeek.dataPoints} | - |`);
  lines.push('');

  // ── クエリ分析 ──
  lines.push(`## クエリ分析\n`);

  if (analysis.newQueries.length > 0) {
    lines.push(`### 新出クエリ (${analysis.newQueries.length}件)\n`);
    for (const q of analysis.newQueries.slice(0, 10)) {
      lines.push(`- "${q.keys[0]}" — ${q.clicks}click ${q.impressions}imp pos:${q.position.toFixed(1)}`);
    }
    lines.push('');
  }

  if (analysis.growingQueries.length > 0) {
    lines.push(`### 成長クエリ (${analysis.growingQueries.length}件)\n`);
    for (const q of analysis.growingQueries.slice(0, 10)) {
      lines.push(`- "${q.keys[0]}" — imp: ${q.prevImpressions}→${q.impressions} (${deltaPercent(q.impressions, q.prevImpressions)}) pos:${q.position.toFixed(1)}`);
    }
    lines.push('');
  }

  if (analysis.decliningQueries.length > 0) {
    lines.push(`### 衰退クエリ (${analysis.decliningQueries.length}件)\n`);
    for (const q of analysis.decliningQueries.slice(0, 10)) {
      lines.push(`- "${q.keys[0]}" — imp: ${q.prevImpressions}→${q.impressions} (${deltaPercent(q.impressions, q.prevImpressions)})`);
    }
    lines.push('');
  }

  if (analysis.lostQueries.length > 0) {
    lines.push(`### 消失クエリ (${analysis.lostQueries.length}件)\n`);
    for (const q of analysis.lostQueries.slice(0, 5)) {
      lines.push(`- "${q.keys[0]}" — 先週: ${q.impressions}imp`);
    }
    lines.push('');
  }

  // ── ページ種別トレンド ──
  if (analysis.pageTypeTrend.length > 0) {
    lines.push(`## ページ種別トレンド\n`);
    const typeLabels: Record<string, string> = {
      guide: 'ガイド', ranking: 'カタログ', maker: 'メーカー',
      lure: 'ルアー詳細', fish: '魚種', type: 'タイプ',
      new: '新着', top: 'トップ', other: 'その他',
    };
    lines.push(`| 種別 | 今週click | 今週imp | 先週click | 先週imp | imp変化 |`);
    lines.push(`|------|-----------|---------|-----------|---------|---------|`);
    for (const pt of analysis.pageTypeTrend) {
      const label = typeLabels[pt.type] || pt.type;
      lines.push(`| ${label} | ${pt.thisWeekClicks} | ${pt.thisWeekImpressions} | ${pt.lastWeekClicks} | ${pt.lastWeekImpressions} | ${deltaPercent(pt.thisWeekImpressions, pt.lastWeekImpressions)} |`);
    }
    lines.push('');
  }

  // ── デバイストレンド ──
  if (analysis.deviceTrend.length > 0) {
    lines.push(`## デバイス別トレンド\n`);
    lines.push(`| デバイス | 今週click | 今週imp | 先週click | 先週imp |`);
    lines.push(`|----------|-----------|---------|-----------|---------|`);
    for (const d of analysis.deviceTrend) {
      lines.push(`| ${d.device} | ${d.thisWeekClicks} | ${d.thisWeekImpressions} | ${d.lastWeekClicks} | ${d.lastWeekImpressions} |`);
    }
    lines.push('');
  }

  // ── インデックス進捗 ──
  lines.push(`## インデックス送信進捗\n`);
  if (analysis.indexingProgress) {
    const ip = analysis.indexingProgress;
    lines.push(`- 送信済みオフセット: ${ip.lure_offset}件`);
    lines.push(`- 累計送信数: ${ip.total_submitted}件`);
    lines.push(`- 最終実行日: ${ip.last_run || '未実行'}`);
    if (ip.history && ip.history.length > 0) {
      lines.push(`\n### 直近の送信履歴\n`);
      lines.push(`| 日付 | オフセット | 成功 | 失敗 |`);
      lines.push(`|------|-----------|------|------|`);
      for (const h of ip.history.slice(-7)) {
        lines.push(`| ${h.date} | ${h.offset} | ${h.success} | ${h.failed} |`);
      }
    }
  } else {
    lines.push(`- インデックス進捗データなし`);
  }
  lines.push('');

  // ── PDCA推奨アクション ──
  lines.push(`## PDCA推奨アクション\n`);
  for (const rec of analysis.recommendations) {
    const tag = rec.match(/^\[(Plan|Do|Check|Act)\]/)?.[1] || '';
    const emoji: Record<string, string> = { Plan: '📋', Do: '🔨', Check: '🔍', Act: '⚡' };
    lines.push(`- ${emoji[tag] || '📌'} ${rec}`);
  }
  lines.push('');

  // ── フッター ──
  lines.push(`---`);
  lines.push(`*自動生成: weekly-seo-report.ts | ${new Date().toISOString()}*`);

  return lines.join('\n');
}

function generateSlackSummary(analysis: WeeklyAnalysis): string {
  const lines: string[] = [];

  lines.push(`📈 *CAST/LOG SEO週次レポート* (${analysis.reportDate})`);
  lines.push('');

  // サマリー
  lines.push('*── 週次サマリー ──*');
  lines.push(`クリック: ${analysis.thisWeek.clicks} (先週: ${analysis.lastWeek.clicks}, ${deltaPercent(analysis.thisWeek.clicks, analysis.lastWeek.clicks)})`);
  lines.push(`インプレッション: ${analysis.thisWeek.impressions} (先週: ${analysis.lastWeek.impressions}, ${deltaPercent(analysis.thisWeek.impressions, analysis.lastWeek.impressions)})`);
  lines.push(`平均CTR: ${(analysis.thisWeek.ctr * 100).toFixed(2)}% / 平均順位: ${analysis.thisWeek.position.toFixed(1)}`);
  lines.push('');

  // クエリハイライト
  if (analysis.newQueries.length > 0) {
    const top3 = analysis.newQueries.slice(0, 3).map(q => `"${q.keys[0]}"`).join(', ');
    lines.push(`🆕 新出クエリ ${analysis.newQueries.length}件: ${top3}`);
  }
  if (analysis.growingQueries.length > 0) {
    const top = analysis.growingQueries[0];
    lines.push(`📈 成長クエリ: "${top.keys[0]}" (imp: ${top.prevImpressions}→${top.impressions})`);
  }
  lines.push('');

  // インデックス進捗
  if (analysis.indexingProgress) {
    lines.push(`📤 インデックス送信: ${analysis.indexingProgress.lure_offset}件完了 (最終: ${analysis.indexingProgress.last_run})`);
  }
  lines.push('');

  // 推奨アクション（上位3件）
  lines.push('*── PDCA推奨 ──*');
  for (const rec of analysis.recommendations.slice(0, 3)) {
    lines.push(`  ${rec}`);
  }

  lines.push('');
  lines.push('_詳細: logs/seo-reports/ を参照_');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== Weekly SEO Report Start ===');

  // 日次データ読み込み（過去14日分）
  const dailyData = loadDailyDataFiles(14);
  log(`Loaded ${dailyData.length} daily data files`);

  if (dailyData.length === 0) {
    log('WARNING: No daily data found. Run seo-monitor.ts first.');
    log('=== Weekly SEO Report Skipped ===');
    return;
  }

  // 分析実行
  const analysis = analyzeWeekly(dailyData);

  // Markdownレポート生成
  const mdReport = generateMarkdownReport(analysis);

  // ファイル保存
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportFile = path.join(REPORT_DIR, `weekly-${analysis.reportDate}.md`);
  fs.writeFileSync(reportFile, mdReport);
  log(`Report saved: ${reportFile}`);

  // コンソール出力
  console.log('\n' + mdReport);

  // Slack通知（要約版）
  if (SLACK_WEBHOOK) {
    const slackMsg = generateSlackSummary(analysis);
    await sendSlack(slackMsg);
  }

  // JSONデータも保存（プログラムからの参照用）
  const jsonFile = path.join(REPORT_DIR, `weekly-${analysis.reportDate}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(analysis, null, 2));
  logV(`JSON data saved: ${jsonFile}`);

  log(`=== Weekly SEO Report Complete (thisWeek: ${analysis.thisWeek.clicks}click/${analysis.thisWeek.impressions}imp, newQueries: ${analysis.newQueries.length}, recs: ${analysis.recommendations.length}) ===`);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
