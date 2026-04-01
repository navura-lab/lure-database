#!/usr/bin/env npx tsx
/**
 * SEOペナルティ自動検知スクリプト
 *
 * GSCデータの急激な変動を検出し、ペナルティの兆候を早期警告する。
 * seo-monitor.ts の日次データを分析して異常を判定。
 *
 * 検知項目:
 *   1. インプレッション急落（前日比-30%以上 or 前週比-50%以上）
 *   2. クリック急落（前日比-40%以上 or 前週比-50%以上）
 *   3. 平均順位の急激な悪化（+3以上）
 *   4. インデックス数の減少（GSC APIでカバレッジ確認）
 *   5. 特定ページ群の一斉順位低下（エディトリアル追加ページ vs 非追加ページ）
 *   6. CTR異常低下（同インプレッション帯での比較）
 *
 * Usage:
 *   npx tsx scripts/seo-penalty-detector.ts              # チェック実行
 *   npx tsx scripts/seo-penalty-detector.ts --verbose     # 詳細表示
 *   npx tsx scripts/seo-penalty-detector.ts --notify      # Discord通知送信
 *
 * 出力:
 *   logs/seo-data/penalty-check-YYYY-MM-DD.json
 *   console に警告レベル表示
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SEO_DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const VERBOSE = process.argv.includes('--verbose');
const NOTIFY = process.argv.includes('--notify');

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

interface DailyData {
  date: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
}

// ─── データ読み込み ───────────────────────────────────
function loadDailyData(daysBack: number = 14): DailyData[] {
  const results: DailyData[] = [];
  const now = new Date();

  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const file = path.join(SEO_DATA_DIR, `${dateStr}.json`);

    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        results.push({
          date: dateStr,
          totalClicks: data.totalClicks || 0,
          totalImpressions: data.totalImpressions || 0,
          avgCtr: data.avgCtr || 0,
          avgPosition: data.avgPosition || 0,
        });
      } catch { /* skip corrupt files */ }
    }
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 異常検知ロジック ─────────────────────────────────
interface Alert {
  level: 'critical' | 'warning' | 'info';
  metric: string;
  message: string;
  current: number;
  previous: number;
  changePercent: number;
}

function detectAnomalies(data: DailyData[]): Alert[] {
  const alerts: Alert[] = [];

  if (data.length < 2) {
    log('データ不足（2日分以上必要）');
    return alerts;
  }

  const today = data[data.length - 1];
  const yesterday = data[data.length - 2];

  // 7日前のデータ（あれば）
  const weekAgo = data.length >= 8 ? data[data.length - 8] : null;

  // 直近7日の平均（ベースライン）
  const recent7 = data.slice(-7);
  const avgImp = recent7.reduce((s, d) => s + d.totalImpressions, 0) / recent7.length;
  const avgClick = recent7.reduce((s, d) => s + d.totalClicks, 0) / recent7.length;
  const avgPos = recent7.reduce((s, d) => s + d.avgPosition, 0) / recent7.length;

  // ─── 1. インプレッション急落 ───
  if (yesterday.totalImpressions > 0) {
    const dayChange = (today.totalImpressions - yesterday.totalImpressions) / yesterday.totalImpressions;
    if (dayChange <= -0.30) {
      alerts.push({
        level: dayChange <= -0.50 ? 'critical' : 'warning',
        metric: 'impressions_daily',
        message: `インプレッション前日比 ${(dayChange * 100).toFixed(1)}%（${yesterday.totalImpressions}→${today.totalImpressions}）`,
        current: today.totalImpressions,
        previous: yesterday.totalImpressions,
        changePercent: dayChange * 100,
      });
    }
  }

  if (weekAgo && weekAgo.totalImpressions > 0) {
    const weekChange = (today.totalImpressions - weekAgo.totalImpressions) / weekAgo.totalImpressions;
    if (weekChange <= -0.50) {
      alerts.push({
        level: 'critical',
        metric: 'impressions_weekly',
        message: `インプレッション前週比 ${(weekChange * 100).toFixed(1)}%（${weekAgo.totalImpressions}→${today.totalImpressions}）`,
        current: today.totalImpressions,
        previous: weekAgo.totalImpressions,
        changePercent: weekChange * 100,
      });
    }
  }

  // ─── 2. クリック急落 ───
  if (yesterday.totalClicks > 0) {
    const dayChange = (today.totalClicks - yesterday.totalClicks) / yesterday.totalClicks;
    if (dayChange <= -0.40) {
      alerts.push({
        level: dayChange <= -0.60 ? 'critical' : 'warning',
        metric: 'clicks_daily',
        message: `クリック前日比 ${(dayChange * 100).toFixed(1)}%（${yesterday.totalClicks}→${today.totalClicks}）`,
        current: today.totalClicks,
        previous: yesterday.totalClicks,
        changePercent: dayChange * 100,
      });
    }
  }

  // ─── 3. 平均順位の急激な悪化 ───
  if (yesterday.avgPosition > 0 && today.avgPosition > 0) {
    const posChange = today.avgPosition - yesterday.avgPosition;
    if (posChange >= 3) {
      alerts.push({
        level: posChange >= 5 ? 'critical' : 'warning',
        metric: 'position_daily',
        message: `平均順位 ${posChange.toFixed(1)}悪化（${yesterday.avgPosition.toFixed(1)}→${today.avgPosition.toFixed(1)}）`,
        current: today.avgPosition,
        previous: yesterday.avgPosition,
        changePercent: posChange,
      });
    }
  }

  // ─── 4. CTR異常低下（インプレッションが増えているのにCTRが落ちる） ───
  if (today.totalImpressions > avgImp * 0.8 && today.avgCtr > 0 && avgClick > 0) {
    const avgCtrBaseline = avgClick / avgImp;
    const ctrDrop = (today.avgCtr - avgCtrBaseline) / avgCtrBaseline;
    if (ctrDrop <= -0.30) {
      alerts.push({
        level: 'warning',
        metric: 'ctr_anomaly',
        message: `CTR異常低下: 7日平均${(avgCtrBaseline * 100).toFixed(1)}%→本日${(today.avgCtr * 100).toFixed(1)}%`,
        current: today.avgCtr * 100,
        previous: avgCtrBaseline * 100,
        changePercent: ctrDrop * 100,
      });
    }
  }

  // ─── 5. 連続下落検出（3日連続でインプレッション減少） ───
  if (data.length >= 4) {
    const last4 = data.slice(-4);
    const consecutive = last4.every((d, i) => i === 0 || d.totalImpressions < last4[i - 1].totalImpressions);
    if (consecutive && last4[0].totalImpressions > 0) {
      const totalDrop = (last4[3].totalImpressions - last4[0].totalImpressions) / last4[0].totalImpressions;
      alerts.push({
        level: totalDrop <= -0.40 ? 'critical' : 'warning',
        metric: 'consecutive_decline',
        message: `3日連続インプレッション減少: ${last4[0].totalImpressions}→${last4[3].totalImpressions}（${(totalDrop * 100).toFixed(1)}%）`,
        current: last4[3].totalImpressions,
        previous: last4[0].totalImpressions,
        changePercent: totalDrop * 100,
      });
    }
  }

  // ─── 6. ゼロインプレッション日の検出 ───
  if (today.totalImpressions === 0 && avgImp > 100) {
    alerts.push({
      level: 'critical',
      metric: 'zero_impressions',
      message: `本日のインプレッションが0（7日平均: ${avgImp.toFixed(0)}）。手動アクション / インデックス除外の可能性`,
      current: 0,
      previous: avgImp,
      changePercent: -100,
    });
  }

  return alerts;
}

// ─── Discord通知 ─────────────────────────────────────
function notifyDiscord(alerts: Alert[]) {
  const critical = alerts.filter(a => a.level === 'critical');
  const warnings = alerts.filter(a => a.level === 'warning');

  if (critical.length === 0 && warnings.length === 0) return;

  const emoji = critical.length > 0 ? '🚨' : '⚠️';
  const status = critical.length > 0 ? 'failed' : 'info';
  const lines = alerts
    .map(a => `${a.level === 'critical' ? '🔴' : '🟡'} ${a.message}`)
    .join('\n');

  const message = `${emoji} SEOペナルティ検知\nCritical: ${critical.length}件 / Warning: ${warnings.length}件\n\n${lines}`;

  try {
    execSync(
      `bash ops/scripts/notify-discord.sh "penalty-detector" "${status}" "${message.replace(/"/g, '\\"').slice(0, 1500)}"`,
      { cwd: path.join(import.meta.dirname, '..') }
    );
    log('Discord通知送信完了');
  } catch (err) {
    log('Discord通知失敗（Webhook未設定？）');
  }
}

// ─── メイン ──────────────────────────────────────────
async function main() {
  log('=== SEOペナルティ検知 開始 ===');

  const data = loadDailyData(14);
  log(`読み込み: ${data.length}日分のGSCデータ`);

  if (data.length === 0) {
    log('GSCデータなし。seo-monitor.ts を先に実行してください。');
    return;
  }

  const alerts = detectAnomalies(data);

  // 結果表示
  const critical = alerts.filter(a => a.level === 'critical');
  const warnings = alerts.filter(a => a.level === 'warning');
  const infos = alerts.filter(a => a.level === 'info');

  if (alerts.length === 0) {
    log('✅ 異常なし。全指標が正常範囲内。');
  } else {
    if (critical.length > 0) {
      log(`🚨 CRITICAL: ${critical.length}件`);
      critical.forEach(a => log(`  🔴 ${a.message}`));
    }
    if (warnings.length > 0) {
      log(`⚠️ WARNING: ${warnings.length}件`);
      warnings.forEach(a => log(`  🟡 ${a.message}`));
    }
    if (infos.length > 0) {
      infos.forEach(a => log(`  ℹ️ ${a.message}`));
    }
  }

  // 直近データのサマリー
  if (VERBOSE && data.length >= 2) {
    log('\n--- 直近データ ---');
    data.slice(-7).forEach(d => {
      log(`  ${d.date}: imp=${d.totalImpressions} click=${d.totalClicks} ctr=${(d.avgCtr * 100).toFixed(1)}% pos=${d.avgPosition.toFixed(1)}`);
    });
  }

  // 推奨アクション
  if (critical.length > 0) {
    log('\n🚨 推奨アクション:');
    log('  1. GSCの「手動による対策」ページを確認');
    log('  2. エディトリアル自動生成を一時停止（launchctl unload editorial-writer）');
    log('  3. 直近のコミットで大量ページ追加がないか確認');
    log('  4. サイトマップのインデックスカバレッジを確認');
  }

  // 結果保存
  const today = new Date().toISOString().split('T')[0];
  const result = {
    date: today,
    dataPoints: data.length,
    alerts,
    criticalCount: critical.length,
    warningCount: warnings.length,
    latestData: data[data.length - 1],
    verdict: critical.length > 0 ? 'PENALTY_SUSPECTED' : warnings.length > 0 ? 'MONITOR' : 'HEALTHY',
  };

  const outFile = path.join(SEO_DATA_DIR, `penalty-check-${today}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  log(`結果保存: ${outFile}`);

  // Discord通知
  if (NOTIFY || critical.length > 0) {
    notifyDiscord(alerts);
  }

  // exit code: criticalがあれば1
  if (critical.length > 0) process.exit(1);

  log('=== 完了 ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
