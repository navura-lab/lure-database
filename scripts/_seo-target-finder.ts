#!/usr/bin/env npx tsx
/**
 * SEO Target Finder — GSCデータからリライト優先度の高いルアーページを特定
 *
 * 出力: 検索ボリューム × 伸びしろでスコアリングした上位30件
 */

import 'dotenv/config';
import { getSearchAnalytics, daysAgo, SITE_URL } from './lib/gsc-client.js';

// CTRポテンシャル（順位帯別の期待改善幅）
function ctrPotential(position: number): number {
  if (position <= 1) return 0.05; // 既に1位 → 防衛のみ
  if (position <= 3) return 0.25; // 2-3位 → 1位取れば大幅UP
  if (position <= 7) return 0.15; // 4-7位 → ★最優先
  if (position <= 10) return 0.08; // 8-10位 → 1ページ目ギリギリ
  if (position <= 20) return 0.03; // 11-20位 → 大幅改修必要
  return 0.01; // 21位以下
}

async function main() {
  console.log('=== SEO Target Finder ===');
  console.log(`期間: 過去28日間\n`);

  // ルアー詳細ページのみ取得（/メーカー/slug/ パターン）
  const startDate = daysAgo(30); // GSC遅延考慮
  const endDate = daysAgo(2);

  // ページ別データ取得
  const pageData = await getSearchAnalytics(startDate, endDate, ['page'], 5000);

  // ルアー詳細ページのみフィルタ（/xxx/yyy/ パターン、/en/ 除外）
  const lurePages = pageData.filter(row => {
    const path = row.keys[0].replace(SITE_URL.replace(/\/$/, ''), '');
    // /en/ 除外
    if (path.startsWith('/en/')) return false;
    // /type/ /fish/ /ranking/ /compare/ /article/ /guide/ /search /maker/ /new/ /season/ /method/ 除外
    if (/^\/(type|fish|ranking|compare|article|guide|search|maker|new|season|method|api)\b/.test(path)) return false;
    // トップページ除外
    if (path === '/' || path === '') return false;
    // /メーカー/slug/ パターンにマッチ（2階層）
    const parts = path.replace(/^\/|\/$/g, '').split('/');
    return parts.length === 2;
  });

  // スコアリング
  const scored = lurePages.map(row => {
    const path = row.keys[0].replace(SITE_URL.replace(/\/$/, ''), '');
    const score = row.impressions * ctrPotential(row.position);
    const category = row.position <= 3 ? 'DEFEND' :
                     row.position <= 10 ? 'REWRITE' :
                     row.position <= 20 ? 'REWRITE_HARD' : 'CREATE_OR_OVERHAUL';
    return {
      path,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: (row.ctr * 100).toFixed(1) + '%',
      position: row.position.toFixed(1),
      score: Math.round(score),
      category,
    };
  }).sort((a, b) => b.score - a.score);

  // 上位30件を出力
  console.log('─── REWRITE候補（position 4-10、スコア上位） ───');
  const rewrites = scored.filter(s => s.category === 'REWRITE').slice(0, 15);
  for (const [i, s] of rewrites.entries()) {
    console.log(`${i + 1}. ${s.path}`);
    console.log(`   imp:${s.impressions} clicks:${s.clicks} CTR:${s.ctr} pos:${s.position} score:${s.score}`);
  }

  console.log('\n─── REWRITE_HARD候補（position 11-20） ───');
  const hard = scored.filter(s => s.category === 'REWRITE_HARD').slice(0, 10);
  for (const [i, s] of hard.entries()) {
    console.log(`${i + 1}. ${s.path}`);
    console.log(`   imp:${s.impressions} clicks:${s.clicks} CTR:${s.ctr} pos:${s.position} score:${s.score}`);
  }

  console.log('\n─── DEFEND候補（position 1-3） ───');
  const defend = scored.filter(s => s.category === 'DEFEND').slice(0, 10);
  for (const [i, s] of defend.entries()) {
    console.log(`${i + 1}. ${s.path}`);
    console.log(`   imp:${s.impressions} clicks:${s.clicks} CTR:${s.ctr} pos:${s.position} score:${s.score}`);
  }

  // ページ×クエリデータも取得（上位REWRITE候補のクエリを把握）
  if (rewrites.length > 0) {
    const topTarget = rewrites[0];
    console.log(`\n─── #1ターゲット ${topTarget.path} のクエリ詳細 ───`);

    const queryData = await getSearchAnalytics(startDate, endDate, ['page', 'query'], 1000, [
      { dimension: 'page', operator: 'contains', expression: topTarget.path.replace(/^\/|\/$/g, '') },
    ]);

    const queries = queryData
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10);

    for (const q of queries) {
      console.log(`  「${q.keys[1]}」 imp:${q.impressions} clicks:${q.clicks} pos:${q.position.toFixed(1)}`);
    }
  }

  console.log(`\n合計: ルアーページ ${lurePages.length}件, REWRITE ${rewrites.length}件, DEFEND ${defend.length}件`);
}

main().catch(console.error);
