#!/usr/bin/env npx tsx
/**
 * SEO Opportunity Finder
 *
 * ルアー単位でSEOの優先順位を自動算出する。
 *
 * Phase 1: DISCOVER — GSCデータから既存インプレッション/クリックを取得
 * Phase 2: ASSESS — allintitle検索で競合数を推定
 * Phase 3: ESTIMATE — ROIスコアリング、優先順位リスト出力
 *
 * 出力:
 *   logs/seo-data/opportunities-YYYY-MM-DD.json  (機械用)
 *   logs/seo-data/opportunities-YYYY-MM-DD.md    (人間用レポート)
 *
 * Usage:
 *   npx tsx scripts/seo-opportunity-finder.ts                    # GSCデータのみ (Phase 1)
 *   npx tsx scripts/seo-opportunity-finder.ts --competition      # 競合チェック含む (Phase 1+2)
 *   npx tsx scripts/seo-opportunity-finder.ts --full             # フル分析 (Phase 1+2+3)
 *   npx tsx scripts/seo-opportunity-finder.ts --top 50           # 上位N件を分析
 *   npx tsx scripts/seo-opportunity-finder.ts --verbose          # 詳細出力
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
const SITE_URL = process.env.GSC_SITE_URL || 'https://www.lure-db.com/';

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');

const VERBOSE = process.argv.includes('--verbose');
const DO_COMPETITION = process.argv.includes('--competition') || process.argv.includes('--full');
const DO_FULL = process.argv.includes('--full');

function getArgValue(flag: string, defaultValue: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return defaultValue;
  return parseInt(process.argv[idx + 1], 10) || defaultValue;
}
const TOP_N = getArgValue('--top', 100);

// ─── 修飾語定義 ────────────────────────────────────────

const MODIFIERS = [
  { keyword: 'インプレ', intent: 'review', revenue: 'mid' },
  { keyword: '使い方', intent: 'howto', revenue: 'low' },
  { keyword: '最安値', intent: 'purchase', revenue: 'high' },
  { keyword: '価格', intent: 'purchase', revenue: 'high' },
  { keyword: 'カラー', intent: 'spec', revenue: 'mid' },
  { keyword: '釣果', intent: 'result', revenue: 'mid' },
] as const;

// CTR想定（順位別）
const CTR_BY_POSITION: Record<number, number> = {
  1: 0.30, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05,
  6: 0.04, 7: 0.03, 8: 0.025, 9: 0.02, 10: 0.015,
};
function estimatedCtr(position: number): number {
  const rounded = Math.min(Math.max(Math.round(position), 1), 10);
  return CTR_BY_POSITION[rounded] || 0.01;
}

// ─── Helper ───────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ─── Google Auth ──────────────────────────────────────

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

// ─── GSC API ──────────────────────────────────────────

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
  rowLimit = 1000,
): Promise<SearchAnalyticsRow[]> {
  const allRows: SearchAnalyticsRow[] = [];
  let startRow = 0;

  while (true) {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: gscHeaders(token),
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions,
          rowLimit: Math.min(rowLimit - allRows.length, 5000),
          startRow,
        }),
      },
    );
    const data = await res.json() as any;
    const rows: SearchAnalyticsRow[] = data.rows || [];
    if (rows.length === 0) break;
    allRows.push(...rows);
    if (allRows.length >= rowLimit || rows.length < 5000) break;
    startRow += rows.length;
    await sleep(200);
  }

  return allRows;
}

// ─── Supabase: ルアーシリーズ取得 ──────────────────────

interface LureSeries {
  name: string;
  slug: string;
  manufacturer_slug: string;
  manufacturer: string;
  url: string;
}

async function fetchAllLureSeries(): Promise<LureSeries[]> {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  const seen = new Map<string, LureSeries>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('name, slug, manufacturer_slug, manufacturer')
      .range(from, from + pageSize - 1);

    if (error) { log(`Supabase error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (!r.slug || !r.manufacturer_slug) continue;
      const key = `${r.manufacturer_slug}/${r.slug}`;
      if (!seen.has(key)) {
        seen.set(key, {
          name: r.name || r.slug,
          slug: r.slug,
          manufacturer_slug: r.manufacturer_slug,
          manufacturer: r.manufacturer || r.manufacturer_slug,
          url: `${SITE_URL}${key}/`,
        });
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return [...seen.values()];
}

// ─── Phase 1: DISCOVER ───────────────────────────────

interface QueryOpportunity {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  // Phase 2で追加
  allintitleCount?: number;
  competitionScore?: number;
  // Phase 3で追加
  estimatedMonthlyVolume?: number;
  estimatedTrafficAt1?: number;
  estimatedTrafficAt3?: number;
  roiScore?: number;
  priority?: number;
  category?: 'low-hanging' | 'ctr-improve' | 'content-gap' | 'growth';
}

interface PageOpportunity {
  url: string;
  lureName: string;
  slug: string;
  manufacturerSlug: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: QueryOpportunity[];
  modifierOpportunities: ModifierOpportunity[];
  overallScore: number;
}

interface ModifierOpportunity {
  keyword: string;         // 「VJ-16 インプレ」
  modifier: string;        // 「インプレ」
  intent: string;
  revenue: string;
  allintitleCount?: number;
  estimatedVolume?: number;
  roiScore?: number;
}

async function discoverOpportunities(token: string): Promise<{
  queryData: SearchAnalyticsRow[];
  pageData: SearchAnalyticsRow[];
}> {
  log('Phase 1: DISCOVER — GSCからデータ取得中...');

  const startDate = daysAgo(30); // 直近30日のデータ
  const endDate = daysAgo(2);    // GSC 2日遅延

  // クエリ別とページ別のデータを並列取得
  const [queryData, pageData] = await Promise.all([
    getSearchAnalytics(token, startDate, endDate, ['query'], 5000),
    getSearchAnalytics(token, startDate, endDate, ['page'], 5000),
  ]);

  log(`  クエリ数: ${queryData.length}`);
  log(`  ページ数: ${pageData.length}`);

  return { queryData, pageData };
}

// ─── Phase 2: ASSESS (allintitle競合チェック) ─────────

async function checkAllintitle(keyword: string): Promise<number> {
  // Google検索の allintitle: で競合数を推定
  // 注意: 短時間に大量リクエストするとブロックされるため、間隔を空ける
  try {
    const query = encodeURIComponent(`allintitle:${keyword}`);
    const url = `https://www.google.co.jp/search?q=${query}&hl=ja`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });

    const html = await res.text();

    // 「約 X 件」のパターンを抽出
    const match = html.match(/約\s*([\d,]+)\s*件/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }

    // 英語フォーマット: "About X results"
    const matchEn = html.match(/About\s*([\d,]+)\s*results/);
    if (matchEn) {
      return parseInt(matchEn[1].replace(/,/g, ''), 10);
    }

    // ヒットなし or パース失敗
    logV(`  allintitle パース失敗: ${keyword}`);
    return -1;
  } catch (e) {
    logV(`  allintitle エラー: ${keyword} - ${e}`);
    return -1;
  }
}

// ─── Phase 3: ESTIMATE & SCORE ────────────────────────

function scoreLureOpportunities(
  lureSeries: LureSeries[],
  pageData: SearchAnalyticsRow[],
  queryData: SearchAnalyticsRow[],
): PageOpportunity[] {
  // ページデータをURLでインデックス
  const pageMap = new Map<string, SearchAnalyticsRow>();
  for (const row of pageData) {
    pageMap.set(row.keys[0], row);
  }

  // クエリデータをルアー名でマッチング
  const results: PageOpportunity[] = [];

  for (const lure of lureSeries) {
    const pageRow = pageMap.get(lure.url);
    if (!pageRow) continue; // GSCデータなし = インプレッションなし

    // このルアーに関連するクエリを抽出
    const lureName = lure.name.toLowerCase();
    const relatedQueries = queryData
      .filter(q => {
        const query = q.keys[0].toLowerCase();
        return query.includes(lureName) || lureName.includes(query);
      })
      .map(q => ({
        query: q.keys[0],
        clicks: q.clicks,
        impressions: q.impressions,
        ctr: q.ctr,
        position: q.position,
      }));

    // カテゴリ判定
    for (const q of relatedQueries) {
      if (q.position >= 11 && q.position <= 20 && q.impressions >= 10) {
        q.category = 'low-hanging' as const;
      } else if (q.position <= 5 && q.ctr < 0.03) {
        q.category = 'ctr-improve' as const;
      }
    }

    // 修飾語の機会を生成
    const modifierOpps: ModifierOpportunity[] = MODIFIERS.map(mod => ({
      keyword: `${lure.name} ${mod.keyword}`,
      modifier: mod.keyword,
      intent: mod.intent,
      revenue: mod.revenue,
    }));

    // 総合スコア計算
    // スコア = インプレッション × 位置ポテンシャル（上位ほど伸びしろ大）
    // 順位が低い(数値大) = 伸びしろ大、インプレッション多い = 需要大
    const positionPotential = Math.max(1, pageRow.position / 3); // 順位15位→5倍、3位→1倍
    const overallScore = pageRow.impressions * positionPotential;

    results.push({
      url: lure.url,
      lureName: lure.name,
      slug: lure.slug,
      manufacturerSlug: lure.manufacturer_slug,
      clicks: pageRow.clicks,
      impressions: pageRow.impressions,
      ctr: pageRow.ctr,
      position: pageRow.position,
      topQueries: relatedQueries.slice(0, 10),
      modifierOpportunities: modifierOpps,
      overallScore,
    });
  }

  // スコア降順ソート
  results.sort((a, b) => b.overallScore - a.overallScore);

  return results;
}

// ─── クエリ分類 ───────────────────────────────────────

interface ClassifiedQueries {
  lowHanging: QueryOpportunity[];    // 順位11-20 + 高インプレッション
  ctrImprove: QueryOpportunity[];    // 上位表示 + 低CTR
  contentGap: QueryOpportunity[];    // インプレッションあるが対応ページなし
  growing: QueryOpportunity[];       // 成長中のクエリ
}

function classifyQueries(
  queryData: SearchAnalyticsRow[],
  pageData: SearchAnalyticsRow[],
): ClassifiedQueries {
  const pageUrls = new Set(pageData.map(p => p.keys[0]));

  const lowHanging: QueryOpportunity[] = [];
  const ctrImprove: QueryOpportunity[] = [];
  const contentGap: QueryOpportunity[] = [];

  for (const q of queryData) {
    const opp: QueryOpportunity = {
      query: q.keys[0],
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: q.ctr,
      position: q.position,
    };

    // Low-hanging fruit: 2ページ目付近（順位8-30位）でインプレッションあり
    if (q.position >= 8 && q.impressions >= 2) {
      opp.category = 'low-hanging';
      // GSCデータは30日分なのでそのまま月間推定
      opp.estimatedMonthlyVolume = Math.round(q.impressions);
      opp.estimatedTrafficAt1 = Math.round((opp.estimatedMonthlyVolume || 0) * 0.30);
      opp.estimatedTrafficAt3 = Math.round((opp.estimatedMonthlyVolume || 0) * 0.10);
      lowHanging.push(opp);
    }

    // CTR改善: 上位表示（1-7位）だが低CTR
    if (q.position <= 7 && q.ctr < 0.05 && q.impressions >= 3) {
      opp.category = 'ctr-improve';
      ctrImprove.push(opp);
    }
  }

  // インプレッション降順ソート
  lowHanging.sort((a, b) => b.impressions - a.impressions);
  ctrImprove.sort((a, b) => b.impressions - a.impressions);

  return { lowHanging, ctrImprove, contentGap, growing: [] };
}

// ─── レポート生成 ──────────────────────────────────────

function generateReport(
  lureOpps: PageOpportunity[],
  classified: ClassifiedQueries,
  queryData: SearchAnalyticsRow[],
): string {
  const lines: string[] = [];
  const today = todayStr();

  lines.push(`# SEO Opportunity Report — ${today}`);
  lines.push('');
  lines.push(`生成日時: ${new Date().toISOString()}`);
  lines.push(`分析期間: ${daysAgo(30)} 〜 ${daysAgo(2)}`);
  lines.push(`GSCクエリ数: ${queryData.length}`);
  lines.push('');

  // ── サマリー ──
  lines.push('## サマリー');
  lines.push('');
  lines.push(`| 指標 | 値 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 分析対象ルアーページ | ${lureOpps.length} 件 |`);
  lines.push(`| Low-hanging fruit クエリ | ${classified.lowHanging.length} 件 |`);
  lines.push(`| CTR改善候補 | ${classified.ctrImprove.length} 件 |`);
  lines.push(`| Top 10 ルアーの合計インプレッション | ${lureOpps.slice(0, 10).reduce((s, l) => s + l.impressions, 0)} |`);
  lines.push('');

  // ── ルアー優先順位 TOP N ──
  const topLures = lureOpps.slice(0, Math.min(TOP_N, lureOpps.length));
  lines.push(`## ルアー優先順位 TOP ${topLures.length}`);
  lines.push('');
  lines.push('| # | ルアー名 | メーカー | Imp | Click | 順位 | CTR | スコア |');
  lines.push('|---|---------|---------|-----|-------|------|-----|--------|');
  topLures.forEach((l, i) => {
    lines.push(
      `| ${i + 1} | ${l.lureName} | ${l.manufacturerSlug} | ${l.impressions} | ${l.clicks} | ${l.position.toFixed(1)} | ${(l.ctr * 100).toFixed(1)}% | ${l.overallScore.toFixed(0)} |`
    );
  });
  lines.push('');

  // ── 各ルアーの詳細（Top 20） ──
  lines.push('## 上位ルアー詳細');
  lines.push('');
  const detailLures = lureOpps.slice(0, 20);
  for (const l of detailLures) {
    lines.push(`### ${l.lureName} (${l.manufacturerSlug})`);
    lines.push(`- URL: ${l.url}`);
    lines.push(`- インプレッション: ${l.impressions} / クリック: ${l.clicks}`);
    lines.push(`- 平均順位: ${l.position.toFixed(1)} / CTR: ${(l.ctr * 100).toFixed(2)}%`);
    lines.push(`- スコア: ${l.overallScore.toFixed(0)}`);
    lines.push('');

    if (l.topQueries.length > 0) {
      lines.push('関連クエリ:');
      for (const q of l.topQueries) {
        const tag = q.category ? ` [${q.category}]` : '';
        lines.push(`  - 「${q.query}」 imp:${q.impressions} click:${q.clicks} pos:${q.position.toFixed(1)}${tag}`);
      }
      lines.push('');
    }

    lines.push('修飾語キーワード候補:');
    for (const m of l.modifierOpportunities) {
      lines.push(`  - 「${m.keyword}」 (${m.intent}, 収益性:${m.revenue})`);
    }
    lines.push('');
  }

  // ── Low-hanging fruit ──
  if (classified.lowHanging.length > 0) {
    lines.push('## Low-hanging Fruit（順位11-20位）');
    lines.push('');
    lines.push('少しの最適化で1ページ目に上がれるクエリ:');
    lines.push('');
    lines.push('| # | クエリ | Imp | Click | 順位 | 月間Vol推定 | 1位時PV |');
    lines.push('|---|-------|-----|-------|------|-----------|--------|');
    classified.lowHanging.slice(0, 30).forEach((q, i) => {
      lines.push(
        `| ${i + 1} | ${q.query} | ${q.impressions} | ${q.clicks} | ${q.position.toFixed(1)} | ${q.estimatedMonthlyVolume || '-'} | ${q.estimatedTrafficAt1 || '-'} |`
      );
    });
    lines.push('');
  }

  // ── CTR改善候補 ──
  if (classified.ctrImprove.length > 0) {
    lines.push('## CTR改善候補（上位表示 × 低CTR）');
    lines.push('');
    lines.push('title/description改善で即効果が見込めるクエリ:');
    lines.push('');
    lines.push('| # | クエリ | Imp | Click | 順位 | CTR |');
    lines.push('|---|-------|-----|-------|------|-----|');
    classified.ctrImprove.slice(0, 20).forEach((q, i) => {
      lines.push(
        `| ${i + 1} | ${q.query} | ${q.impressions} | ${q.clicks} | ${q.position.toFixed(1)} | ${(q.ctr * 100).toFixed(1)}% |`
      );
    });
    lines.push('');
  }

  // ── 推奨アクション（具体的・実行可能なアクション自動抽出） ──
  lines.push('## 推奨アクション');
  lines.push('');

  // クエリパターン分析で自動分類
  const rankingQueries = classified.lowHanging.filter(q =>
    /おすすめ|ランキング|最強|人気|比較/.test(q.query)
  );
  const makerQueries = classified.lowHanging.filter(q =>
    /一覧|メーカー|ルアー$/.test(q.query) && !/おすすめ|ランキング/.test(q.query)
  );
  const productQueries = classified.lowHanging.filter(q =>
    !rankingQueries.includes(q) && !makerQueries.includes(q)
  );

  if (rankingQueries.length > 0) {
    lines.push(`### 1. ランキングページ強化（${rankingQueries.length}件）`);
    lines.push('対応ページ: `/ranking/` 配下のカテゴリページ');
    lines.push('');
    for (const q of rankingQueries.slice(0, 5)) {
      lines.push(`- 「${q.query}」(imp:${q.impressions}, pos:${q.position.toFixed(1)}) → ランキングページのdescription/内部リンク強化`);
    }
    lines.push('');
  }

  if (makerQueries.length > 0) {
    lines.push(`### 2. メーカーページ強化（${makerQueries.length}件）`);
    lines.push('対応ページ: `/メーカースラッグ/` 配下');
    lines.push('');
    for (const q of makerQueries.slice(0, 5)) {
      lines.push(`- 「${q.query}」(imp:${q.impressions}, pos:${q.position.toFixed(1)}) → メーカーページの内部リンク・コンテンツ強化`);
    }
    lines.push('');
  }

  if (productQueries.length > 0) {
    lines.push(`### 3. 個別ルアーページ強化（${productQueries.length}件）`);
    lines.push('対応: Supabase description更新 or テンプレート改善');
    lines.push('');
    for (const q of productQueries.slice(0, 10)) {
      lines.push(`- 「${q.query}」(imp:${q.impressions}, pos:${q.position.toFixed(1)})`);
    }
    lines.push('');
  }

  if (classified.ctrImprove.length > 0) {
    lines.push(`### 4. CTR改善: 上位表示 × 低CTR（${classified.ctrImprove.length}件）`);
    lines.push('titleに検索クエリの語を含め、descriptionに具体数値を追加:');
    lines.push('');
    for (const q of classified.ctrImprove.slice(0, 10)) {
      const action = q.position <= 3
        ? 'title/description最優先で改善'
        : 'description改善 + 内部リンク追加';
      lines.push(`- 「${q.query}」(imp:${q.impressions}, pos:${q.position.toFixed(1)}, CTR:${(q.ctr * 100).toFixed(1)}%) → ${action}`);
    }
    lines.push('');
  }

  // 前週比較データがあれば新出/消失クエリも
  lines.push('### 5. 自動化チェックリスト');
  lines.push('- [ ] Low-hanging fruit上位5件のtitle/descriptionを確認');
  lines.push('- [ ] CTR改善上位5件のmeta descriptionに検索語を追加');
  lines.push('- [ ] 新出ランキング系クエリに対応するカテゴリページの存在確認');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Opportunity Finder ===');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 認証
  const token = await getAccessToken();
  log('Google認証OK');

  // Phase 1: DISCOVER
  const { queryData, pageData } = await discoverOpportunities(token);

  // ルアーシリーズ取得
  log('Supabaseからルアーシリーズ取得中...');
  const lureSeries = await fetchAllLureSeries();
  log(`  ルアーシリーズ数: ${lureSeries.length}`);

  // Phase 3: SCORE & RANK
  log('Phase 3: ESTIMATE — スコアリング中...');
  const lureOpps = scoreLureOpportunities(lureSeries, pageData, queryData);
  log(`  GSCデータがあるルアー: ${lureOpps.length} 件`);

  // クエリ分類
  const classified = classifyQueries(queryData, pageData);
  log(`  Low-hanging fruit: ${classified.lowHanging.length} 件`);
  log(`  CTR改善候補: ${classified.ctrImprove.length} 件`);

  // Phase 2: ASSESS (--competition フラグ時のみ)
  if (DO_COMPETITION) {
    log('Phase 2: ASSESS — allintitle競合チェック中...');
    const topLures = lureOpps.slice(0, Math.min(TOP_N, 20)); // allintitleは20件まで
    for (const lure of topLures) {
      // ルアー名単体のallintitle
      const count = await checkAllintitle(lure.lureName);
      logV(`  allintitle:${lure.lureName} → ${count}件`);
      lure.topQueries.forEach(q => {
        if (!q.allintitleCount) q.allintitleCount = count;
      });

      // 修飾語キーワードのallintitle（収益性highのみ）
      for (const mod of lure.modifierOpportunities) {
        if (mod.revenue === 'high') {
          mod.allintitleCount = await checkAllintitle(mod.keyword);
          logV(`  allintitle:${mod.keyword} → ${mod.allintitleCount}件`);
          await sleep(2000); // Googleブロック回避
        }
      }

      await sleep(2000);
    }
  }

  // レポート生成
  log('レポート生成中...');
  const report = generateReport(lureOpps, classified, queryData);
  const today = todayStr();

  // JSON出力
  const jsonOutput = {
    date: today,
    timestamp: new Date().toISOString(),
    analysisRange: { start: daysAgo(30), end: daysAgo(2) },
    summary: {
      totalQueries: queryData.length,
      totalPages: pageData.length,
      analyzedLures: lureOpps.length,
      lowHangingFruit: classified.lowHanging.length,
      ctrImproveCandidates: classified.ctrImprove.length,
    },
    topLures: lureOpps.slice(0, TOP_N),
    lowHangingFruit: classified.lowHanging.slice(0, 50),
    ctrImprove: classified.ctrImprove.slice(0, 30),
  };

  const jsonPath = path.join(DATA_DIR, `opportunities-${today}.json`);
  const mdPath = path.join(DATA_DIR, `opportunities-${today}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  fs.writeFileSync(mdPath, report);

  log(`出力: ${jsonPath}`);
  log(`出力: ${mdPath}`);

  // コンソールサマリー
  console.log('\n' + '='.repeat(60));
  console.log('SEO OPPORTUNITY SUMMARY');
  console.log('='.repeat(60));
  console.log(`分析対象ルアー: ${lureOpps.length} 件`);
  console.log(`Low-hanging fruit: ${classified.lowHanging.length} 件`);
  console.log(`CTR改善候補: ${classified.ctrImprove.length} 件`);
  console.log('');

  if (lureOpps.length > 0) {
    console.log('── Top 10 ルアー ──');
    lureOpps.slice(0, 10).forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.lureName} (${l.manufacturerSlug}) — imp:${l.impressions} click:${l.clicks} pos:${l.position.toFixed(1)} score:${l.overallScore.toFixed(0)}`);
    });
    console.log('');
  }

  if (classified.lowHanging.length > 0) {
    console.log('── Low-hanging Fruit Top 10 ──');
    classified.lowHanging.slice(0, 10).forEach((q, i) => {
      console.log(`  ${i + 1}. 「${q.query}」 — imp:${q.impressions} pos:${q.position.toFixed(1)} → 1位時月間${q.estimatedTrafficAt1}PV`);
    });
  }

  console.log('\n詳細は ' + mdPath + ' を参照');
}

main().catch(e => { console.error(e); process.exit(1); });
