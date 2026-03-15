#!/usr/bin/env npx tsx
/**
 * GSCインデックス状況チェックスクリプト
 *
 * ランキングページ・カテゴリページのインデックス状況を確認し、
 * 結果をログに出力する。launchdで定期実行する想定。
 *
 * Usage:
 *   npx tsx scripts/check-indexing-status.ts
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// ─── Config ───
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN!;
const QUOTA_PROJECT = process.env.GOOGLE_QUOTA_PROJECT || 'plucky-mile-486802-j6';
const SITE_URL = 'https://www.castlog.xyz/';

const LOG_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');

// ─── Helpers ───

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [check-indexing] ${msg}`);
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

// ─── GSC Search Analytics ───

interface AnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function fetchSearchAnalytics(token: string, startDate: string, endDate: string): Promise<AnalyticsRow[]> {
  const allRows: AnalyticsRow[] = [];
  let startRow = 0;

  while (true) {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-goog-user-project': QUOTA_PROJECT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit: 25000,
          startRow,
        }),
      },
    );

    const data = await res.json() as any;
    if (!data.rows || data.rows.length === 0) break;
    allRows.push(...data.rows);
    if (data.rows.length < 25000) break;
    startRow += 25000;
  }

  return allRows;
}

// ─── URL Inspection API ───

interface InspectionResult {
  url: string;
  verdict: string;
  coverageState: string;
  indexingState: string;
  lastCrawlTime?: string;
}

async function inspectUrl(token: string, url: string): Promise<InspectionResult> {
  const res = await fetch(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-goog-user-project': QUOTA_PROJECT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionUrl: url,
        siteUrl: SITE_URL,
      }),
    },
  );

  const data = await res.json() as any;
  const result = data.inspectionResult?.indexStatusResult || {};

  return {
    url,
    verdict: result.verdict || 'UNKNOWN',
    coverageState: result.coverageState || 'UNKNOWN',
    indexingState: result.indexingState || 'UNKNOWN',
    lastCrawlTime: result.lastCrawlTime,
  };
}

// ─── Main ───

async function main() {
  log('=== Indexing Status Check ===');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    log('ERROR: Google credentials not found');
    process.exit(1);
  }

  const token = await getAccessToken();
  log('Access token obtained');

  // 過去14日間のSearch Analytics
  const endDate = new Date().toISOString().split('T')[0];
  const startDateObj = new Date();
  startDateObj.setDate(startDateObj.getDate() - 14);
  const startDate = startDateObj.toISOString().split('T')[0];

  log(`Fetching search analytics: ${startDate} ~ ${endDate}`);
  const rows = await fetchSearchAnalytics(token, startDate, endDate);
  log(`Total pages with impressions: ${rows.length}`);

  // ランキングページのみ抽出
  const rankingRows = rows.filter(r => r.keys[0].includes('/ranking/'));
  const newRows = rows.filter(r => r.keys[0].includes('/new/'));
  const fishRows = rows.filter(r => r.keys[0].includes('/fish/'));
  const typeRows = rows.filter(r => r.keys[0].includes('/type/'));

  // 集計
  const summary = {
    total: {
      pages: rows.length,
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
    },
    ranking: {
      pages: rankingRows.length,
      clicks: rankingRows.reduce((s, r) => s + r.clicks, 0),
      impressions: rankingRows.reduce((s, r) => s + r.impressions, 0),
    },
    new: {
      pages: newRows.length,
      clicks: newRows.reduce((s, r) => s + r.clicks, 0),
      impressions: newRows.reduce((s, r) => s + r.impressions, 0),
    },
    fish: {
      pages: fishRows.length,
      clicks: fishRows.reduce((s, r) => s + r.clicks, 0),
      impressions: fishRows.reduce((s, r) => s + r.impressions, 0),
    },
    type: {
      pages: typeRows.length,
      clicks: typeRows.reduce((s, r) => s + r.clicks, 0),
      impressions: typeRows.reduce((s, r) => s + r.impressions, 0),
    },
  };

  log('');
  log('=== Summary ===');
  log(`全体: ${summary.total.pages}ページ, ${summary.total.clicks}クリック, ${summary.total.impressions}インプレッション`);
  log(`ランキング: ${summary.ranking.pages}ページ, ${summary.ranking.clicks}クリック, ${summary.ranking.impressions}インプレッション`);
  log(`新製品: ${summary.new.pages}ページ, ${summary.new.clicks}クリック, ${summary.new.impressions}インプレッション`);
  log(`魚種: ${summary.fish.pages}ページ, ${summary.fish.clicks}クリック, ${summary.fish.impressions}インプレッション`);
  log(`タイプ: ${summary.type.pages}ページ, ${summary.type.clicks}クリック, ${summary.type.impressions}インプレッション`);

  // ランキングページのURL Inspection（上位10件サンプル）
  const rankingDir = path.join(import.meta.dirname, '..', 'dist', 'client', 'ranking');
  let sampleSlugs: string[] = [];
  try {
    sampleSlugs = fs.readdirSync(rankingDir)
      .filter(e => e !== 'index.html' && !e.includes('.'))
      .slice(0, 10);
  } catch {
    log('Warning: dist/client/ranking/ not found');
  }

  if (sampleSlugs.length > 0) {
    log('');
    log('=== URL Inspection (sample 10 ranking pages) ===');
    const inspections: InspectionResult[] = [];

    for (const slug of sampleSlugs) {
      const url = `${SITE_URL}ranking/${slug}/`;
      try {
        const result = await inspectUrl(token, url);
        inspections.push(result);
        log(`  ${slug}: ${result.verdict} / ${result.coverageState}`);
        await sleep(1200); // レートリミット回避
      } catch (e: any) {
        log(`  ${slug}: ERROR - ${e.message}`);
      }
    }

    const indexed = inspections.filter(i => i.verdict === 'PASS').length;
    log(`  → インデックス済み: ${indexed}/${inspections.length}`);
  }

  // ログ保存
  const today = new Date().toISOString().split('T')[0];
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `indexing-check-${today}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    date: new Date().toISOString(),
    period: { startDate, endDate },
    summary,
    rankingTop10: rankingRows.sort((a, b) => b.impressions - a.impressions).slice(0, 10),
  }, null, 2));
  log(`Log saved: ${logFile}`);

  log('=== Check Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
