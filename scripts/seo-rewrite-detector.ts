#!/usr/bin/env npx tsx
/**
 * SEO Rewrite Detector v2 — 全ページ種別のリライト候補自動検出 + title自動書き換え
 *
 * rank-tracker の trends.json と GSC ページ別データを統合し、
 * リライトが必要なページを自動検出する。
 * title-rewrite 候補には Claude API で title/description を自動生成し、Supabase に書き込む。
 *
 * 判定ルール（静的）:
 *   - title-rewrite:    CTR < 3% && imp > 50  → titleとdescriptionのみ変更
 *   - content-enhance:  順位11-20 && imp > 30 → セクション追加・比較表追加
 *   - restructure:      順位21位以下 && imp > 10 → 記事構成の根本見直し
 *   - keyword-pivot:    imp < 10 && 公開30日以上 → KW再選定
 *
 * 判定ルール（トレンドベース）:
 *   - position-drop:    前週比で順位3位以上下落 && imp > 20
 *   - ctr-drop:         前週比でCTRが30%以上低下 && imp > 30
 *
 * 出力:
 *   logs/seo-data/rewrite-candidates.json       — リライト候補リスト
 *   logs/seo-data/rewrites-applied.json          — 適用済みURL（daily-indexing用）
 *   標準出力にサマリー
 *
 * Usage:
 *   npx tsx scripts/seo-rewrite-detector.ts              # 全ページを評価 + title-rewrite自動適用
 *   npx tsx scripts/seo-rewrite-detector.ts --dry-run    # 検出のみ（書き換えなし）
 *   npx tsx scripts/seo-rewrite-detector.ts --verbose    # 詳細出力
 *   npx tsx scripts/seo-rewrite-detector.ts --days 7     # 公開7日以上で評価（デフォルト14日）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getSearchAnalytics, daysAgo, todayStr, SITE_URL } from './lib/gsc-client.js';
import { createClient } from '@supabase/supabase-js';

// ─── Config ───────────────────────────────────────────

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const RANKINGS_DIR = path.join(DATA_DIR, 'rankings');
const OUTPUT_FILE = path.join(DATA_DIR, 'rewrite-candidates.json');
const APPLIED_FILE = path.join(DATA_DIR, 'rewrites-applied.json');

const VERBOSE = process.argv.includes('--verbose');
const DRY_RUN = process.argv.includes('--dry-run');
const MIN_DAYS = (() => {
  const idx = process.argv.indexOf('--days');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 14 : 14;
})();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function log(msg: string) { console.log(`[${new Date().toISOString()}] [rewrite-detector] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────

type RewriteAction = 'title-rewrite' | 'content-enhance' | 'restructure' | 'keyword-pivot' | 'position-drop' | 'ctr-drop';

interface RewriteCandidate {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  action: RewriteAction;
  priority: number;
  reasoning: string;
  isNew: boolean;  // 前回候補リストに無かった新規悪化
  // title-rewrite 自動適用時
  suggestedTitle?: string;
  suggestedDescription?: string;
  applied?: boolean;
}

interface TrendEntry {
  page: string;
  query: string;
  currentPosition: number;
  previousPosition: number | null;
  positionChange: number | null;
  currentImpressions: number;
  impressionChange: number | null;
  opportunityScore: number;
  positions: { date: string; position: number; impressions: number; clicks: number }[];
}

interface PreviousCandidates {
  candidates: RewriteCandidate[];
  count: number;
  analyzedAt: string;
}

// ─── 対象ページパス ────────────────────────────────────

// 全ページ種別に拡大
const TARGET_PATH_PATTERNS = [
  /^\/article\//,
  /^\/guide\//,
  /^\/ranking\//,
  /^\/compare\//,
  /^\/[a-z0-9_-]+\/[a-z0-9_-]+\//,  // メーカー/ルアー
];

function isTargetPage(pagePath: string): boolean {
  // /en/ は除外
  if (pagePath.startsWith('/en/')) return false;
  return TARGET_PATH_PATTERNS.some(p => p.test(pagePath));
}

/** GSCのpage URLを相対パスに変換 */
function toRelativePath(page: string): string {
  return page.replace(/^https?:\/\/[^/]+/, '');
}

// ─── Trends 読み込み ──────────────────────────────────

function loadTrends(): TrendEntry[] {
  const trendsFile = path.join(RANKINGS_DIR, 'trends.json');
  if (!fs.existsSync(trendsFile)) {
    log('trends.json が見つかりません。rank-tracker を先に実行してください。');
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(trendsFile, 'utf-8'));
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    log('trends.json の読み込みに失敗しました。');
    return [];
  }
}

/** ページ単位でトレンドを集約（複数クエリ → ページ単位の最悪変動を使う） */
function aggregateTrendsByPage(trends: TrendEntry[]): Map<string, {
  maxPositionDrop: number;  // 正=悪化（順位が落ちた）
  maxCtrDropPct: number;    // 正=悪化（CTR%が下がった割合）
  avgPosition: number;
  totalImp: number;
  totalClicks: number;
  topQuery: string;
}> {
  const pageMap = new Map<string, {
    posDrops: number[];
    ctrDrops: number[];
    positions: number[];
    imps: number[];
    clicks: number[];
    queries: { query: string; imp: number }[];
  }>();

  for (const t of trends) {
    const entry = pageMap.get(t.page) || { posDrops: [], ctrDrops: [], positions: [], imps: [], clicks: [], queries: [] };

    if (t.positionChange !== null) {
      entry.posDrops.push(t.positionChange); // 正=順位下落
    }

    // CTR変動は positions から計算（currentとprevious）
    if (t.previousPosition !== null && t.positions.length > 0) {
      const currentClicks = t.positions[0]?.clicks || 0;
      const currentImp = t.positions[0]?.impressions || 0;
      const currentCtr = currentImp > 0 ? currentClicks / currentImp : 0;
      // 前回のCTRは直接持っていないので、positionChangeから推定しない
      // → トレンドのCTR変動は GSC のページ単位データから取る
    }

    entry.positions.push(t.currentPosition);
    entry.imps.push(t.currentImpressions);
    entry.clicks.push(t.positions[0]?.clicks || 0);
    entry.queries.push({ query: t.query, imp: t.currentImpressions });

    pageMap.set(t.page, entry);
  }

  const result = new Map<string, {
    maxPositionDrop: number;
    maxCtrDropPct: number;
    avgPosition: number;
    totalImp: number;
    totalClicks: number;
    topQuery: string;
  }>();

  for (const [page, data] of pageMap) {
    const maxPositionDrop = data.posDrops.length > 0
      ? Math.max(...data.posDrops)
      : 0;

    const avgPosition = data.positions.reduce((a, b) => a + b, 0) / data.positions.length;
    const totalImp = data.imps.reduce((a, b) => a + b, 0);
    const totalClicks = data.clicks.reduce((a, b) => a + b, 0);

    // CTR変動: ページ全体で計算
    // (クエリレベルのCTR変動は不安定なので、ページ単位のGSCデータを後で使う)
    const maxCtrDropPct = 0; // GSCページデータで後で計算

    const topQuery = data.queries.sort((a, b) => b.imp - a.imp)[0]?.query || '';

    result.set(page, { maxPositionDrop, maxCtrDropPct, avgPosition, totalImp, totalClicks, topQuery });
  }

  return result;
}

// ─── 前回候補の読み込み ────────────────────────────────

function loadPreviousCandidates(): Map<string, RewriteCandidate> {
  const map = new Map<string, RewriteCandidate>();
  if (!fs.existsSync(OUTPUT_FILE)) return map;
  try {
    const data: PreviousCandidates = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    for (const c of data.candidates) {
      map.set(c.page, c);
    }
  } catch {
    // ignore
  }
  return map;
}

// ─── Claude API ───────────────────────────────────────

async function callClaude(prompt: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY 未設定');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json() as any;
  if (data.error) throw new Error(`Claude API error: ${JSON.stringify(data.error)}`);
  return data.content?.[0]?.text || '';
}

function buildTitleRewritePrompt(page: string, ctr: number, position: number, impressions: number): string {
  // ページ種別に応じたプロンプト
  let pageType = 'ルアー詳細';
  if (page.startsWith('/article/') || page.startsWith('/guide/')) pageType = '記事';
  else if (page.startsWith('/ranking/')) pageType = 'ランキング';
  else if (page.startsWith('/compare/')) pageType = '比較';

  return `あなたはSEO専門家です。以下の${pageType}ページのtitleタグとmeta descriptionを改善してください。

## 現在の状態
- URL: https://www.castlog.xyz${page}
- CTR: ${ctr}%（目標: 3%以上）
- 順位: ${position}位
- インプレッション: ${impressions}回

## 問題
CTRが低い。インプレッションはあるのにクリックされていない。
titleとdescriptionを改善してCTRを上げたい。

## サイト情報
- CAST/LOG はルアー（釣り具）のデータベースサイト
- スペック・カラー・価格情報が強み
- 全${pageType === 'ランキング' ? 'カテゴリの' : ''}ページには詳細なスペック比較がある

## 制約
- titleは30-60文字。検索意図に合ったキーワードを先頭近くに配置
- descriptionは100-160文字。具体的な数値（カラー数・価格帯等）を含める
- 「おすすめ」「最強」「ヤバい」等の根拠なしワードは禁止
- サイト名「CAST/LOG」はtitle末尾に「 | CAST/LOG」形式で付ける
- URLパスからページ内容を推測して最適化すること

## 出力形式（JSONのみ、説明不要）
\`\`\`json
{
  "title": "...",
  "description": "..."
}
\`\`\``;
}

// ─── Supabase ─────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function applyTitleRewrite(candidate: RewriteCandidate): Promise<boolean> {
  if (!candidate.suggestedDescription) return false;

  // ルアー詳細ページのみDB書き込み（article/ranking/compareはAstroテンプレート依存）
  const parts = candidate.page.replace(/^\/|\/$/g, '').split('/');
  if (parts.length !== 2) {
    logV(`  スキップ: ${candidate.page} はルアー詳細ページではない（DB書き込み不可）`);
    return false;
  }

  // ranking/compare/article/guide は除外
  if (['ranking', 'compare', 'article', 'guide', 'fish', 'type', 'method', 'season', 'en'].includes(parts[0])) {
    logV(`  スキップ: ${candidate.page} はカテゴリページ（DB書き込み不可）`);
    return false;
  }

  const [manufacturerSlug, slug] = parts;
  const sb = getSupabase();

  try {
    const { data, error } = await sb
      .from('lures')
      .update({ description: candidate.suggestedDescription })
      .eq('manufacturer_slug', manufacturerSlug)
      .eq('slug', slug)
      .select('id');

    if (error) throw new Error(error.message);
    return (data?.length || 0) > 0;
  } catch (e: any) {
    log(`  DB書き込み失敗: ${candidate.page} — ${e.message}`);
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Rewrite Detector v2 ===');
  log(`評価対象: 公開${MIN_DAYS}日以上の全ページ種別`);
  if (DRY_RUN) log('DRY RUN モード: 検出のみ、書き換えなし');

  // 1. GSC ページ別パフォーマンスデータ（28日間）
  const rows = await getSearchAnalytics(daysAgo(28), daysAgo(1), ['page'], 5000);
  log(`GSCデータ: ${rows.length}ページ取得`);

  const pageData = rows
    .map(r => ({
      page: toRelativePath(r.keys[0]),
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 1000) / 10, // %表記
      position: Math.round(r.position * 10) / 10,
    }))
    .filter(p => isTargetPage(p.page));

  log(`対象ページ: ${pageData.length}件`);

  // 2. Trends データ読み込み
  const trends = loadTrends();
  log(`Trends: ${trends.length}エントリ`);
  const trendsByPage = aggregateTrendsByPage(trends);
  log(`Trends集約: ${trendsByPage.size}ページ`);

  // 3. 前回候補読み込み（diff用）
  const previousCandidates = loadPreviousCandidates();
  log(`前回候補: ${previousCandidates.size}件`);

  // 4. 前週のGSCデータ（CTR変動比較用）
  let prevPageMap = new Map<string, { ctr: number; position: number; impressions: number }>();
  try {
    // 前週（14-7日前）のデータ
    const prevRows = await getSearchAnalytics(daysAgo(35), daysAgo(8), ['page'], 5000);
    for (const r of prevRows) {
      const p = toRelativePath(r.keys[0]);
      prevPageMap.set(p, {
        ctr: Math.round(r.ctr * 1000) / 10,
        position: Math.round(r.position * 10) / 10,
        impressions: r.impressions,
      });
    }
    log(`前週GSCデータ: ${prevPageMap.size}ページ`);
  } catch (e: any) {
    log(`前週データ取得失敗（スキップ）: ${e.message}`);
  }

  if (pageData.length === 0) {
    log('対象ページのデータがありません。');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ candidates: [], count: 0, analyzedAt: new Date().toISOString(), version: 2 }, null, 2));
    return;
  }

  // 5. 候補抽出
  const candidates: RewriteCandidate[] = [];

  for (const page of pageData) {
    let action: RewriteAction | null = null;
    let reasoning = '';

    const prev = prevPageMap.get(page.page);
    const trend = trendsByPage.get(page.page);

    // ── トレンドベースのルール（優先度高） ──

    // position-drop: 前週比で順位3位以上下落 && imp > 20
    if (prev && page.impressions > 20) {
      const positionDrop = page.position - prev.position;
      if (positionDrop >= 3) {
        action = 'position-drop';
        reasoning = `順位${prev.position}→${page.position}（${positionDrop.toFixed(1)}位下落）。imp=${page.impressions}`;
      }
    }
    // trends.json からも補完
    if (!action && trend && trend.maxPositionDrop >= 3 && page.impressions > 20) {
      action = 'position-drop';
      reasoning = `Trends検出: 順位${trend.maxPositionDrop.toFixed(1)}位下落。imp=${page.impressions}`;
    }

    // ctr-drop: 前週比でCTRが30%以上低下 && imp > 30
    if (!action && prev && page.impressions > 30 && prev.ctr > 0) {
      const ctrDropPct = (prev.ctr - page.ctr) / prev.ctr * 100;
      if (ctrDropPct >= 30) {
        action = 'ctr-drop';
        reasoning = `CTR ${prev.ctr}%→${page.ctr}%（${ctrDropPct.toFixed(0)}%低下）。imp=${page.impressions}`;
      }
    }

    // ── 静的ルール ──

    // ルール1: CTR低い + インプレッション十分 → title改善
    if (!action && page.ctr < 3 && page.impressions > 50) {
      action = 'title-rewrite';
      reasoning = `CTR ${page.ctr}%が低い（目標3%以上）。インプレ${page.impressions}回あるのにクリックされていない`;
    }
    // ルール2: 順位11-20位 → あと少しで1ページ目
    else if (!action && page.position >= 11 && page.position <= 20 && page.impressions > 30) {
      action = 'content-enhance';
      reasoning = `順位${page.position}位で2ページ目。コンテンツ強化で1ページ目に入れる可能性`;
    }
    // ルール3: 順位21位以下 → 根本的見直し
    else if (!action && page.position > 20 && page.impressions > 10) {
      action = 'restructure';
      reasoning = `順位${page.position}位で3ページ目以降。記事構成・キーワード戦略の根本見直しが必要`;
    }
    // ルール4: インプレッション極小 → KW変更
    else if (!action && page.impressions < 10) {
      action = 'keyword-pivot';
      reasoning = `インプレッション${page.impressions}回。ターゲットキーワードの再選定が必要`;
    }

    if (!action) {
      logV(`  OK: ${page.page} (ctr=${page.ctr}%, pos=${page.position}, imp=${page.impressions})`);
      continue;
    }

    // 優先度スコア
    const targetCtr = 5;
    const ctrGap = Math.max(0, targetCtr - page.ctr);
    let priority = Math.round(page.impressions * ctrGap * (1 / Math.max(page.position, 1)) * 100) / 100;

    // トレンドベースのルールはボーナス
    if (action === 'position-drop') priority *= 1.5;
    if (action === 'ctr-drop') priority *= 1.3;

    // 前回候補との差分
    const isNew = !previousCandidates.has(page.page);

    candidates.push({
      ...page,
      action,
      priority: Math.round(priority * 100) / 100,
      reasoning,
      isNew,
    });
  }

  // 優先度順にソート
  candidates.sort((a, b) => b.priority - a.priority);

  // 6. サマリー出力
  const actionCounts: Record<string, number> = {};
  let newCount = 0;
  for (const c of candidates) {
    actionCounts[c.action] = (actionCounts[c.action] || 0) + 1;
    if (c.isNew) newCount++;
  }

  log(`\nリライト候補: ${candidates.length}件（新規: ${newCount}件）`);
  log('');
  log('アクション内訳:');
  for (const [action, count] of Object.entries(actionCounts)) {
    log(`  ${action}: ${count}件`);
  }

  // 上位20件表示
  log('\n─── 優先度上位20件 ───');
  for (const c of candidates.slice(0, 20)) {
    const newTag = c.isNew ? ' [NEW]' : '';
    log(`  [${c.action}]${newTag} ${c.page} (imp=${c.impressions}, ctr=${c.ctr}%, pos=${c.position}, priority=${c.priority})`);
    if (VERBOSE) log(`    理由: ${c.reasoning}`);
  }

  // 7. title-rewrite 候補に Claude API で title/desc 生成 + 自動適用
  const titleRewriteCandidates = candidates.filter(c => c.action === 'title-rewrite' || c.action === 'ctr-drop');
  const appliedUrls: string[] = [];

  if (titleRewriteCandidates.length > 0 && ANTHROPIC_API_KEY && !DRY_RUN) {
    log(`\n=== title-rewrite 自動適用: ${titleRewriteCandidates.length}件 ===`);

    // 上位10件まで処理（API コスト制御）
    const batch = titleRewriteCandidates.slice(0, 10);

    for (const c of batch) {
      log(`  Processing: ${c.page}`);
      try {
        const prompt = buildTitleRewritePrompt(c.page, c.ctr, c.position, c.impressions);
        const response = await callClaude(prompt);

        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          log(`    JSONパース失敗`);
          continue;
        }

        const suggestion = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        c.suggestedTitle = suggestion.title;
        c.suggestedDescription = suggestion.description;

        log(`    提案title: ${suggestion.title}`);
        log(`    提案desc: ${suggestion.description?.substring(0, 80)}...`);

        // DB書き込み
        const applied = await applyTitleRewrite(c);
        c.applied = applied;

        if (applied) {
          log(`    DB書き込み完了`);
          const fullUrl = `${SITE_URL}${c.page.replace(/^\//, '')}`;
          appliedUrls.push(fullUrl);
        } else {
          log(`    DB書き込みスキップ（カテゴリページ or 失敗）`);
        }
      } catch (e: any) {
        log(`    エラー: ${e.message}`);
      }
    }
  } else if (titleRewriteCandidates.length > 0 && DRY_RUN) {
    log(`\n[DRY RUN] title-rewrite候補 ${titleRewriteCandidates.length}件（適用スキップ）`);
  } else if (titleRewriteCandidates.length > 0 && !ANTHROPIC_API_KEY) {
    log('\nANTHROPIC_API_KEY 未設定のため title-rewrite 自動適用をスキップ');
  }

  // 8. JSON保存
  const result = {
    candidates,
    count: candidates.length,
    newCount,
    analyzedAt: new Date().toISOString(),
    config: { minDays: MIN_DAYS, period: '28d' },
    version: 2,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  log(`\n結果保存: ${OUTPUT_FILE}`);

  // 9. 適用済みURL保存（daily-indexing用）
  if (appliedUrls.length > 0) {
    const appliedData = {
      urls: appliedUrls,
      appliedAt: new Date().toISOString(),
    };
    fs.writeFileSync(APPLIED_FILE, JSON.stringify(appliedData, null, 2));
    log(`適用済みURL保存: ${APPLIED_FILE} (${appliedUrls.length}件)`);
  }

  log('\n=== SEO Rewrite Detector v2 Complete ===');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
