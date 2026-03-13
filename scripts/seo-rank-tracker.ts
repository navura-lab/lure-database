#!/usr/bin/env npx tsx
/**
 * SEO Rank Tracker — ページ×クエリの日次ランキング追跡
 *
 * GSCから全ページ×全クエリの交差データを取得し、日次で保存。
 * 過去データとの差分（順位変動、インプレッション変化）を計算。
 *
 * 出力:
 *   logs/seo-data/rankings/YYYY-MM-DD.json  — 全ページ×クエリのランキングデータ
 *   logs/seo-data/rankings/trends.json       — 週次トレンド（順位変動の累積追跡）
 *
 * Usage:
 *   npx tsx scripts/seo-rank-tracker.ts              # 日次データ収集
 *   npx tsx scripts/seo-rank-tracker.ts --verbose     # 詳細出力
 *   npx tsx scripts/seo-rank-tracker.ts --report      # トレンドレポート出力
 *
 * Cron: 毎日 7:30 JST（seo-monitor直後）
 */

import fs from 'fs';
import path from 'path';
import { getSearchAnalytics, daysAgo, todayStr, SITE_URL } from './lib/gsc-client.js';

// ─── Config ───────────────────────────────────────────

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'rankings');
const VERBOSE = process.argv.includes('--verbose');
const REPORT_ONLY = process.argv.includes('--report');

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────

interface PageQueryRanking {
  page: string;       // /manufacturer_slug/slug/
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface DailyRankingData {
  date: string;
  collectedAt: string;
  period: { start: string; end: string };
  totalEntries: number;
  rankings: PageQueryRanking[];
}

interface TrendEntry {
  page: string;
  query: string;
  // 直近4週の順位
  positions: { date: string; position: number; impressions: number; clicks: number }[];
  // 変動
  currentPosition: number;
  previousPosition: number | null;
  positionChange: number | null;  // マイナス=改善
  currentImpressions: number;
  impressionChange: number | null;
  // スコア
  opportunityScore: number;  // 改善余地のスコア
}

// ─── Main ─────────────────────────────────────────────

async function collectDailyRankings(): Promise<DailyRankingData> {
  // GSCデータは2-3日遅延があるため、4日前〜2日前の3日間を取得
  // 短い期間にして「その週」の正確なスナップショットを取る
  const endDate = daysAgo(2);
  const startDate = daysAgo(8); // 7日間

  log(`Collecting rankings for ${startDate} to ${endDate}...`);

  // page × query の交差データを取得（最大25,000行）
  const rows = await getSearchAnalytics(startDate, endDate, ['page', 'query'], 25000);

  log(`Got ${rows.length} page×query combinations`);

  const rankings: PageQueryRanking[] = rows.map(r => ({
    page: r.keys[0].replace(SITE_URL.replace(/\/$/, ''), '').replace('https://castlog.xyz', ''),
    query: r.keys[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  // ページパス正規化（castlog.xyz → 相対パス）
  const normalized = rankings.map(r => ({
    ...r,
    page: r.page.startsWith('/') ? r.page : '/' + r.page,
  }));

  return {
    date: todayStr(),
    collectedAt: new Date().toISOString(),
    period: { start: startDate, end: endDate },
    totalEntries: normalized.length,
    rankings: normalized,
  };
}

function computeTrends(current: DailyRankingData): TrendEntry[] {
  // 過去のデータファイルを読み込み（最大4週間分）
  const pastFiles: string[] = [];
  for (let i = 7; i <= 28; i += 7) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const file = path.join(DATA_DIR, `${dateStr}.json`);
    if (fs.existsSync(file)) pastFiles.push(file);
  }

  // 直近の前回データ（7日前付近を探す）
  let previousData: DailyRankingData | null = null;
  const allPastFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json') && f !== 'trends.json')
    .sort()
    .reverse();

  // 今日以外の最新ファイル
  for (const f of allPastFiles) {
    if (f.replace('.json', '') !== todayStr()) {
      const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      previousData = content;
      break;
    }
  }

  // page+query をキーにした前回データのマップ
  const prevMap = new Map<string, PageQueryRanking>();
  if (previousData) {
    for (const r of previousData.rankings) {
      prevMap.set(`${r.page}|||${r.query}`, r);
    }
  }

  // トレンド計算
  const trends: TrendEntry[] = [];
  for (const r of current.rankings) {
    const key = `${r.page}|||${r.query}`;
    const prev = prevMap.get(key);

    const positionChange = prev ? r.position - prev.position : null;
    const impressionChange = prev ? r.impressions - prev.impressions : null;

    // 機会スコア: インプレッション × (1/順位) × 改善余地
    // 順位4-15で高インプレッション = 最大のチャンス
    let opportunityScore = 0;
    if (r.position >= 2 && r.position <= 20) {
      const positionFactor = r.position <= 10 ? (11 - r.position) / 10 : 0.1;
      const impFactor = Math.log2(r.impressions + 1);
      const ctrGap = Math.max(0, estimatedMaxCtr(r.position) - r.ctr);
      opportunityScore = impFactor * positionFactor * (1 + ctrGap * 10);
    }

    trends.push({
      page: r.page,
      query: r.query,
      positions: [{ date: current.date, position: r.position, impressions: r.impressions, clicks: r.clicks }],
      currentPosition: r.position,
      previousPosition: prev?.position || null,
      positionChange,
      currentImpressions: r.impressions,
      impressionChange,
      opportunityScore: Math.round(opportunityScore * 100) / 100,
    });
  }

  // スコア降順
  trends.sort((a, b) => b.opportunityScore - a.opportunityScore);

  return trends;
}

function estimatedMaxCtr(position: number): number {
  const ctrMap: Record<number, number> = {
    1: 0.30, 2: 0.18, 3: 0.12, 4: 0.08, 5: 0.06,
    6: 0.05, 7: 0.04, 8: 0.03, 9: 0.025, 10: 0.02,
  };
  const rounded = Math.min(Math.max(Math.round(position), 1), 10);
  return ctrMap[rounded] || 0.015;
}

function generateReport(trends: TrendEntry[]): string {
  const lines: string[] = [];
  lines.push(`# SEO Rank Tracker Report — ${todayStr()}`);
  lines.push('');

  // Top 50 機会
  lines.push('## Top 50 SEO Opportunities');
  lines.push('');
  lines.push('| # | ページ | クエリ | 順位 | 変動 | Imp | Click | CTR | スコア |');
  lines.push('|---|--------|--------|------|------|-----|-------|-----|--------|');

  const top50 = trends.slice(0, 50);
  for (let i = 0; i < top50.length; i++) {
    const t = top50[i];
    const change = t.positionChange !== null
      ? (t.positionChange < 0 ? `↑${Math.abs(t.positionChange).toFixed(1)}` : t.positionChange > 0 ? `↓${t.positionChange.toFixed(1)}` : '→')
      : 'NEW';
    const ctr = (t.positions[0]?.clicks && t.positions[0]?.impressions)
      ? `${((t.positions[0].clicks / t.positions[0].impressions) * 100).toFixed(1)}%`
      : '0%';
    const clicks = t.positions[0]?.clicks || 0;
    lines.push(`| ${i + 1} | \`${t.page}\` | ${t.query} | ${t.currentPosition.toFixed(1)} | ${change} | ${t.currentImpressions} | ${clicks} | ${ctr} | ${t.opportunityScore} |`);
  }

  // 急上昇・急降下
  const improved = trends
    .filter(t => t.positionChange !== null && t.positionChange < -2)
    .sort((a, b) => (a.positionChange || 0) - (b.positionChange || 0))
    .slice(0, 10);

  if (improved.length > 0) {
    lines.push('');
    lines.push('## 🚀 急上昇（順位改善 > 2位）');
    lines.push('');
    for (const t of improved) {
      lines.push(`- **${t.query}** on \`${t.page}\`: ${t.previousPosition?.toFixed(1)} → ${t.currentPosition.toFixed(1)} (↑${Math.abs(t.positionChange!).toFixed(1)})`);
    }
  }

  const declined = trends
    .filter(t => t.positionChange !== null && t.positionChange > 2)
    .sort((a, b) => (b.positionChange || 0) - (a.positionChange || 0))
    .slice(0, 10);

  if (declined.length > 0) {
    lines.push('');
    lines.push('## ⚠️ 急降下（順位低下 > 2位）');
    lines.push('');
    for (const t of declined) {
      lines.push(`- **${t.query}** on \`${t.page}\`: ${t.previousPosition?.toFixed(1)} → ${t.currentPosition.toFixed(1)} (↓${t.positionChange!.toFixed(1)})`);
    }
  }

  // ページ集約サマリー
  lines.push('');
  lines.push('## ページ別サマリー（Top 20）');
  lines.push('');
  const pageMap = new Map<string, { queries: number; totalImp: number; totalClicks: number; avgPos: number; topScore: number }>();
  for (const t of trends) {
    const p = pageMap.get(t.page) || { queries: 0, totalImp: 0, totalClicks: 0, avgPos: 0, topScore: 0 };
    p.queries++;
    p.totalImp += t.currentImpressions;
    p.totalClicks += (t.positions[0]?.clicks || 0);
    p.avgPos += t.currentPosition;
    p.topScore = Math.max(p.topScore, t.opportunityScore);
    pageMap.set(t.page, p);
  }

  const pageSummary = [...pageMap.entries()]
    .map(([page, data]) => ({
      page,
      queries: data.queries,
      totalImp: data.totalImp,
      totalClicks: data.totalClicks,
      avgPos: data.avgPos / data.queries,
      topScore: data.topScore,
    }))
    .sort((a, b) => b.totalImp - a.totalImp)
    .slice(0, 20);

  lines.push('| # | ページ | クエリ数 | 合計Imp | Click | 平均順位 | 最高スコア |');
  lines.push('|---|--------|---------|--------|-------|---------|-----------|');
  for (let i = 0; i < pageSummary.length; i++) {
    const p = pageSummary[i];
    lines.push(`| ${i + 1} | \`${p.page}\` | ${p.queries} | ${p.totalImp} | ${p.totalClicks} | ${p.avgPos.toFixed(1)} | ${p.topScore} |`);
  }

  return lines.join('\n');
}

// ─── Entry ────────────────────────────────────────────

async function main() {
  log('=== SEO Rank Tracker Start ===');

  if (REPORT_ONLY) {
    const trendsFile = path.join(DATA_DIR, 'trends.json');
    if (!fs.existsSync(trendsFile)) {
      log('No trends data found. Run without --report first.');
      return;
    }
    const trends = JSON.parse(fs.readFileSync(trendsFile, 'utf-8'));
    const report = generateReport(trends);
    console.log(report);
    return;
  }

  // 1. 日次データ収集
  const dailyData = await collectDailyRankings();

  // 2. 保存
  const dailyFile = path.join(DATA_DIR, `${dailyData.date}.json`);
  fs.writeFileSync(dailyFile, JSON.stringify(dailyData, null, 2));
  log(`Saved ${dailyData.totalEntries} rankings to ${dailyFile}`);

  // 3. トレンド計算
  const trends = computeTrends(dailyData);

  // 4. トレンド保存
  const trendsFile = path.join(DATA_DIR, 'trends.json');
  fs.writeFileSync(trendsFile, JSON.stringify(trends, null, 2));
  log(`Saved ${trends.length} trend entries`);

  // 5. レポート生成
  const report = generateReport(trends);
  const reportFile = path.join(DATA_DIR, `report-${dailyData.date}.md`);
  fs.writeFileSync(reportFile, report);
  log(`Report: ${reportFile}`);

  // サマリー出力
  const top5 = trends.slice(0, 5);
  log('');
  log('=== Top 5 Opportunities ===');
  for (const t of top5) {
    log(`  ${t.query} on ${t.page}: pos=${t.currentPosition.toFixed(1)} imp=${t.currentImpressions} score=${t.opportunityScore}`);
  }

  log(`\n=== Done: ${dailyData.totalEntries} entries, ${trends.length} trends ===`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
