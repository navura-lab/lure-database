#!/usr/bin/env npx tsx
/**
 * 日次KPI収集スクリプト
 *
 * GA4 + GSC + サイト状態を1行にまとめてSQLiteに積み上げ保存。
 * improvement-loopから毎日呼び出される。
 *
 * Usage:
 *   npx tsx scripts/collect-daily-kpi.ts
 *   npx tsx scripts/collect-daily-kpi.ts --report   # 直近14日のトレンド表示
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DB_PATH = path.join(import.meta.dirname, '..', 'ops', 'db', 'agents.db');
const SEO_DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const GA4_DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'ga4-data');
const EDITORIALS_DIR = path.join(import.meta.dirname, '..', 'src', 'data', 'seo', 'editorials');
const ARTICLES_DIR = path.join(import.meta.dirname, '..', 'src', 'data', 'articles');

const REPORT_MODE = process.argv.includes('--report');

function sql(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── GA4データ取得 ─────────────────────────────────
function getGA4Data(date: string): { users: number; newUsers: number; sessions: number; pageviews: number; avgDuration: number; bounceRate: number } | null {
  // まずga4-daily-report.pyを実行してJSON保存
  try {
    execSync('python3 scripts/ga4-daily-report.py --json 2>/dev/null', {
      cwd: path.join(import.meta.dirname, '..'),
      timeout: 30000,
    });
  } catch { /* GA4取得失敗は無視 */ }

  const ga4File = path.join(GA4_DATA_DIR, `ga4-${date}.json`);
  if (!fs.existsSync(ga4File)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(ga4File, 'utf8'));
    const daily = data.daily || [];
    // 昨日のデータを使う（今日はまだ不完全）
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
    const row = daily.find((d: any) => d.date === yStr);
    if (row) {
      return {
        users: row.users || 0,
        newUsers: row.newUsers || 0,
        sessions: row.sessions || 0,
        pageviews: row.pageviews || 0,
        avgDuration: row.avgDuration || 0,
        bounceRate: row.bounceRate || 0,
      };
    }
  } catch { /* パースエラー */ }
  return null;
}

// ─── GSCデータ取得 ─────────────────────────────────
function getGSCData(date: string): { impressions: number; clicks: number; ctr: number; avgPosition: number } | null {
  // 昨日のGSCデータ
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split('T')[0];
  const gscFile = path.join(SEO_DATA_DIR, `${yDate}.json`);
  if (!fs.existsSync(gscFile)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(gscFile, 'utf8'));
    return {
      impressions: data.totalImpressions || 0,
      clicks: data.totalClicks || 0,
      ctr: data.avgCtr || 0,
      avgPosition: data.avgPosition || 0,
    };
  } catch { return null; }
}

// ─── サイト状態 ──────────────────────────────────
function getSiteState(): { editorials: number; articles: number } {
  const editorials = fs.readdirSync(EDITORIALS_DIR).filter(f => f.endsWith('.ts') && !f.startsWith('_')).length;
  const articles = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.ts') && !f.startsWith('_')).length;
  return { editorials, articles };
}

// ─── メイン: KPI記録 ──────────────────────────────
function collectAndSave() {
  const date = today();
  const ga4 = getGA4Data(date);
  const gsc = getGSCData(date);
  const site = getSiteState();

  const values = [
    `'${date}'`,
    ga4?.users ?? 'NULL', ga4?.newUsers ?? 'NULL', ga4?.sessions ?? 'NULL',
    ga4?.pageviews ?? 'NULL', ga4?.avgDuration ?? 'NULL', ga4?.bounceRate ?? 'NULL',
    gsc?.impressions ?? 'NULL', gsc?.clicks ?? 'NULL', gsc?.ctr ?? 'NULL', gsc?.avgPosition ?? 'NULL',
    site.editorials, site.articles,
    'NULL', 'NULL', // total_pages, indexed_pages（ビルド後に取得する場合）
    'NULL', 'NULL', // audit_passed, audit_failed
  ].join(',');

  sql(`INSERT OR REPLACE INTO daily_kpi (date, ga4_users, ga4_new_users, ga4_sessions, ga4_pageviews, ga4_avg_duration, ga4_bounce_rate, gsc_impressions, gsc_clicks, gsc_ctr, gsc_avg_position, editorial_count, article_count, total_pages, indexed_pages, audit_passed, audit_failed) VALUES (${values})`);

  console.log(`[${new Date().toISOString()}] KPI記録完了: ${date}`);
  console.log(`  GA4: users=${ga4?.users ?? '?'} pv=${ga4?.pageviews ?? '?'} bounce=${ga4?.bounceRate ?? '?'}%`);
  console.log(`  GSC: imp=${gsc?.impressions ?? '?'} click=${gsc?.clicks ?? '?'} pos=${gsc?.avgPosition?.toFixed(1) ?? '?'}`);
  console.log(`  Site: editorials=${site.editorials} articles=${site.articles}`);
}

// ─── レポート: トレンド表示 ──────────────────────────
function showReport() {
  console.log('=== 日次KPIトレンド（直近14日） ===\n');
  const rows = sql(
    "SELECT date, ga4_users, ga4_pageviews, ga4_bounce_rate, gsc_impressions, gsc_clicks, gsc_avg_position, editorial_count FROM daily_kpi ORDER BY date DESC LIMIT 14"
  );

  if (!rows) {
    console.log('データなし。collect-daily-kpi.ts を先に実行してください。');
    return;
  }

  console.log(`${'日付'.padEnd(12)} ${'GA4ユーザー'.padStart(10)} ${'GA4 PV'.padStart(8)} ${'直帰率'.padStart(8)} ${'GSCインプ'.padStart(10)} ${'GSCクリック'.padStart(10)} ${'順位'.padStart(6)} ${'エディトリアル'.padStart(12)}`);

  for (const row of rows.split('\n')) {
    const [date, users, pv, br, imp, click, pos, ed] = row.split('|');
    console.log(
      `${date.padEnd(12)} ${(users || '?').padStart(10)} ${(pv || '?').padStart(8)} ${br ? (parseFloat(br) * 100).toFixed(1) + '%' : '?'.padStart(8)} ${(imp || '?').padStart(10)} ${(click || '?').padStart(10)} ${pos ? parseFloat(pos).toFixed(1) : '?'.padStart(6)} ${(ed || '?').padStart(12)}`
    );
  }

  // 週次比較
  const thisWeek = sql(
    "SELECT SUM(ga4_users), SUM(ga4_pageviews), SUM(gsc_clicks) FROM daily_kpi WHERE date >= date('now', '-7 day', 'localtime')"
  );
  const lastWeek = sql(
    "SELECT SUM(ga4_users), SUM(ga4_pageviews), SUM(gsc_clicks) FROM daily_kpi WHERE date >= date('now', '-14 day', 'localtime') AND date < date('now', '-7 day', 'localtime')"
  );

  if (thisWeek && lastWeek) {
    const [tw_u, tw_pv, tw_c] = thisWeek.split('|').map(Number);
    const [lw_u, lw_pv, lw_c] = lastWeek.split('|').map(Number);

    console.log('\n=== 週次比較 ===');
    if (lw_u > 0) console.log(`  GA4ユーザー: ${lw_u}→${tw_u}（${((tw_u - lw_u) / lw_u * 100).toFixed(1)}%）`);
    if (lw_pv > 0) console.log(`  GA4 PV: ${lw_pv}→${tw_pv}（${((tw_pv - lw_pv) / lw_pv * 100).toFixed(1)}%）`);
    if (lw_c > 0) console.log(`  GSCクリック: ${lw_c}→${tw_c}（${((tw_c - lw_c) / lw_c * 100).toFixed(1)}%）`);
  }
}

// ─── 実行 ─────────────────────────────────────
if (REPORT_MODE) {
  showReport();
} else {
  collectAndSave();
}
