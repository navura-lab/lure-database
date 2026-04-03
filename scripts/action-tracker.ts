/**
 * 施策追跡スクリプト
 *
 * 1. gitログから直近の施策（コミット）を自動抽出してaction_logに記録
 * 2. 7日以上前の施策について効果測定（PV前後比較）を自動実行
 *
 * Usage:
 *   npx tsx scripts/action-tracker.ts              # 記録+効果測定
 *   npx tsx scripts/action-tracker.ts --report      # レポート表示
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DB_PATH = path.join(import.meta.dirname, '..', 'ops', 'db', 'agents.db');
const REPORT = process.argv.includes('--report');

function sql(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function log(msg: string) { console.log(`[${new Date().toISOString()}] [action-tracker] ${msg}`); }

// ─── 施策の自動記録 ─────────────────────────────────
function recordActions() {
  // 直近24時間のコミットから施策を抽出
  const gitLog = execSync(
    'git log --since="24 hours ago" --format="%H|%ai|%s" 2>/dev/null',
    { encoding: 'utf8', cwd: path.join(import.meta.dirname, '..') }
  ).trim();

  if (!gitLog) {
    log('直近24時間のコミットなし');
    return;
  }

  for (const line of gitLog.split('\n')) {
    const [hash, date, subject] = line.split('|');
    if (!hash || !subject) continue;

    // 既に記録済みか確認
    const exists = sql(`SELECT COUNT(*) FROM action_log WHERE commit_hash='${hash.slice(0, 7)}'`);
    if (parseInt(exists) > 0) continue;

    // 施策タイプを自動判定
    let actionType = 'deploy';
    if (subject.includes('エディトリアル')) actionType = 'editorial';
    else if (subject.includes('記事') || subject.includes('article')) actionType = 'content';
    else if (subject.includes('SEO') || subject.includes('seo') || subject.includes('検索')) actionType = 'seo';
    else if (subject.includes('fix') || subject.includes('修正')) actionType = 'fix';
    else if (subject.includes('feat') || subject.includes('追加')) actionType = 'feature';

    const safeSubject = subject.replace(/'/g, "''").slice(0, 200);
    const dateStr = date.split(' ')[0];

    sql(`INSERT INTO action_log (date, action_type, description, commit_hash, verdict) VALUES ('${dateStr}', '${actionType}', '${safeSubject}', '${hash.slice(0, 7)}', 'pending')`);
    log(`記録: [${actionType}] ${safeSubject}`);
  }
}

// ─── 効果測定（7日後） ─────────────────────────────────
function measureEffects() {
  // 7日以上前の pending 施策を取得
  const pending = sql(
    "SELECT id, date, action_type, description FROM action_log WHERE verdict='pending' AND date <= date('now', '-7 day', 'localtime')"
  );

  if (!pending) {
    log('効果測定対象なし（7日未経過）');
    return;
  }

  for (const row of pending.split('\n')) {
    const [id, date, type, desc] = row.split('|');
    if (!id) continue;

    // 施策前後のKPIを比較
    const before = sql(
      `SELECT AVG(ga4_pageviews), AVG(gsc_clicks) FROM daily_kpi WHERE date >= date('${date}', '-3 day') AND date < '${date}'`
    );
    const after = sql(
      `SELECT AVG(ga4_pageviews), AVG(gsc_clicks) FROM daily_kpi WHERE date > '${date}' AND date <= date('${date}', '+7 day')`
    );

    if (!before || !after) {
      log(`KPIデータ不足: ${desc}`);
      continue;
    }

    const [pvBefore, clickBefore] = before.split('|').map(Number);
    const [pvAfter, clickAfter] = after.split('|').map(Number);

    let verdict = 'neutral';
    if (pvAfter > pvBefore * 1.1) verdict = 'positive';
    else if (pvAfter < pvBefore * 0.9) verdict = 'negative';

    sql(`UPDATE action_log SET measured_at=datetime('now','localtime'), pv_before=${pvBefore||0}, pv_after=${pvAfter||0}, position_before=${clickBefore||0}, position_after=${clickAfter||0}, verdict='${verdict}' WHERE id=${id}`);
    log(`効果測定: [${verdict}] ${desc} (PV: ${pvBefore?.toFixed(0)||'?'}→${pvAfter?.toFixed(0)||'?'})`);
  }
}

// ─── レポート ─────────────────────────────────────
function showReport() {
  console.log('=== 施策追跡レポート ===\n');

  const recent = sql(
    "SELECT date, action_type, description, verdict, pv_before, pv_after FROM action_log ORDER BY date DESC LIMIT 20"
  );

  if (!recent) {
    console.log('データなし');
    return;
  }

  console.log(`${'日付'.padEnd(12)} ${'種別'.padEnd(12)} ${'判定'.padEnd(10)} ${'PV前→後'.padEnd(15)} 内容`);
  for (const row of recent.split('\n')) {
    const [date, type, desc, verdict, pvB, pvA] = row.split('|');
    const pvStr = pvB && pvA ? `${parseFloat(pvB).toFixed(0)}→${parseFloat(pvA).toFixed(0)}` : '-';
    console.log(`${(date||'').padEnd(12)} ${(type||'').padEnd(12)} ${(verdict||'pending').padEnd(10)} ${pvStr.padEnd(15)} ${(desc||'').slice(0, 50)}`);
  }

  // サマリー
  const stats = sql(
    "SELECT verdict, COUNT(*) FROM action_log GROUP BY verdict"
  );
  console.log('\n=== 判定サマリー ===');
  for (const row of (stats || '').split('\n')) {
    const [v, c] = row.split('|');
    if (v) console.log(`  ${v}: ${c}件`);
  }
}

// ─── メイン ──────────────────────────────────────
if (REPORT) {
  showReport();
} else {
  log('=== 施策追跡 開始 ===');
  recordActions();
  measureEffects();
  log('=== 完了 ===');
}
