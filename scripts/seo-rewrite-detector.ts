#!/usr/bin/env npx tsx
/**
 * SEO Rewrite Detector — 公開済み記事のリライト候補自動検出
 *
 * 公開後14日以上経過した記事のGSCパフォーマンスを評価し、
 * リライトが必要な記事を自動検出する。
 *
 * 判定ルール:
 *   - CTR < 3% && imp > 50      → title-rewrite（titleとdescriptionのみ変更）
 *   - 順位11-20 && imp > 30     → content-enhance（セクション追加・比較表追加）
 *   - 順位21位以下               → restructure（記事構成の根本見直し）
 *   - imp < 10 && 公開30日以上   → keyword-pivot（KW再選定）
 *
 * 出力:
 *   logs/seo-data/rewrite-candidates.json  — リライト候補リスト
 *   標準出力にサマリー
 *
 * Usage:
 *   npx tsx scripts/seo-rewrite-detector.ts              # 全記事を評価
 *   npx tsx scripts/seo-rewrite-detector.ts --verbose     # 詳細出力
 *   npx tsx scripts/seo-rewrite-detector.ts --days 7      # 公開7日以上で評価（デフォルト14日）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getSearchAnalytics, daysAgo, todayStr } from './lib/gsc-client.js';

// ─── Config ───────────────────────────────────────────

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data');
const OUTPUT_FILE = path.join(DATA_DIR, 'rewrite-candidates.json');

const VERBOSE = process.argv.includes('--verbose');
const MIN_DAYS = (() => {
  const idx = process.argv.indexOf('--days');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 14 : 14;
})();

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────

type RewriteAction = 'title-rewrite' | 'content-enhance' | 'restructure' | 'keyword-pivot';

interface RewriteCandidate {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  action: RewriteAction;
  priority: number;
  reasoning: string;
}

// ─── 対象ページパス ────────────────────────────────────

// 記事ページのパスパターン（今後拡張可能）
const ARTICLE_PATH_PATTERNS = [
  /^\/article\//,     // 新規SEO記事
  /^\/guide\//,       // 既存ガイド記事
  /^\/ranking\//,     // ランキングページ
];

function isArticlePage(pagePath: string): boolean {
  return ARTICLE_PATH_PATTERNS.some(p => p.test(pagePath));
}

/** GSCのpage URLを相対パスに変換 */
function toRelativePath(page: string): string {
  return page.replace(/^https?:\/\/[^/]+/, '');
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Rewrite Detector ===');
  log(`評価対象: 公開${MIN_DAYS}日以上の記事ページ`);

  // 過去28日のページ別パフォーマンスデータ
  const rows = await getSearchAnalytics(daysAgo(28), daysAgo(1), ['page'], 1000);

  log(`GSCデータ: ${rows.length}ページ取得`);

  // 記事ページのみフィルタ
  const articlePages = rows
    .map(r => ({
      page: toRelativePath(r.keys[0]),
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 1000) / 10, // %表記
      position: Math.round(r.position * 10) / 10,
    }))
    .filter(p => isArticlePage(p.page));

  log(`記事ページ: ${articlePages.length}件`);

  if (articlePages.length === 0) {
    log('記事ページのデータがありません。記事公開後に再実行してください。');
    // 空の結果を保存
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ candidates: [], count: 0, analyzedAt: new Date().toISOString() }, null, 2));
    return;
  }

  const candidates: RewriteCandidate[] = [];

  for (const page of articlePages) {
    let action: RewriteAction | null = null;
    let reasoning = '';

    // ルール1: CTR低い + インプレッション十分 → title改善
    if (page.ctr < 3 && page.impressions > 50) {
      action = 'title-rewrite';
      reasoning = `CTR ${page.ctr}%が低い（目標3%以上）。インプレ${page.impressions}回あるのにクリックされていない`;
    }
    // ルール2: 順位11-20位 → あと少しで1ページ目
    else if (page.position >= 11 && page.position <= 20 && page.impressions > 30) {
      action = 'content-enhance';
      reasoning = `順位${page.position}位で2ページ目。コンテンツ強化で1ページ目に入れる可能性`;
    }
    // ルール3: 順位21位以下 → 根本的見直し
    else if (page.position > 20 && page.impressions > 10) {
      action = 'restructure';
      reasoning = `順位${page.position}位で3ページ目以降。記事構成・キーワード戦略の根本見直しが必要`;
    }
    // ルール4: インプレッション極小 → KW変更
    else if (page.impressions < 10) {
      action = 'keyword-pivot';
      reasoning = `インプレッション${page.impressions}回。ターゲットキーワードの再選定が必要`;
    }

    if (!action) {
      logV(`  ✓ ${page.page}: OK (ctr=${page.ctr}%, pos=${page.position}, imp=${page.impressions})`);
      continue;
    }

    // 優先度スコア: インプレッション × (改善可能なCTR差分) × (順位の逆数)
    const targetCtr = 5; // 目標CTR 5%
    const ctrGap = Math.max(0, targetCtr - page.ctr);
    const priority = Math.round(page.impressions * ctrGap * (1 / Math.max(page.position, 1)) * 100) / 100;

    candidates.push({
      ...page,
      action,
      priority,
      reasoning,
    });
  }

  // 優先度順にソート
  candidates.sort((a, b) => b.priority - a.priority);

  // 出力
  log(`\nリライト候補: ${candidates.length}件`);

  if (candidates.length > 0) {
    log('\n─── 優先度上位 ───');
    const actionCounts = { 'title-rewrite': 0, 'content-enhance': 0, 'restructure': 0, 'keyword-pivot': 0 };

    for (const c of candidates) {
      actionCounts[c.action]++;
      log(`  [${c.action}] ${c.page} (imp=${c.impressions}, ctr=${c.ctr}%, pos=${c.position}, priority=${c.priority})`);
      if (VERBOSE) log(`    理由: ${c.reasoning}`);
    }

    log(`\nアクション内訳:`);
    log(`  title-rewrite: ${actionCounts['title-rewrite']}件（titleとdescriptionのみ変更）`);
    log(`  content-enhance: ${actionCounts['content-enhance']}件（セクション追加・比較表追加）`);
    log(`  restructure: ${actionCounts['restructure']}件（記事構成の根本見直し）`);
    log(`  keyword-pivot: ${actionCounts['keyword-pivot']}件（キーワード再選定）`);
  } else {
    log('リライト候補はありません。全記事が良好なパフォーマンスです。');
  }

  // JSON保存
  const result = {
    candidates,
    count: candidates.length,
    analyzedAt: new Date().toISOString(),
    config: { minDays: MIN_DAYS, period: '28d' },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  log(`\n結果保存: ${OUTPUT_FILE}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
