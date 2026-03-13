#!/usr/bin/env npx tsx
/**
 * ブログインプレッション収集スクリプト
 *
 * ルアー名 + 「インプレ」でGoogle検索し、関連ブログ記事のURL・タイトルを収集。
 * 各ルアー詳細ページに「インプレ記事まとめ」セクションとして表示するためのデータ収集。
 *
 * Serper.dev API を使用（無料枠: 2,500クエリ/月）。
 * ※ Google CSE APIは新規受付停止（2027年終了）のためSerperに移行。
 *
 * 前提:
 *   SERPER_API_KEY=xxxxx             (Serper.dev APIキー)
 *
 * Usage:
 *   npx tsx scripts/blog-impression-collector.ts --dry-run        # 対象一覧表示
 *   npx tsx scripts/blog-impression-collector.ts --limit 50       # 上位50ルアーを収集
 *   npx tsx scripts/blog-impression-collector.ts --lure ハグゴス   # 特定ルアー
 *   npx tsx scripts/blog-impression-collector.ts --verbose         # 詳細出力
 *
 * クォータ: 2,500クエリ/月（無料枠）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { searchWithSerper, isSerperConfigured } from './lib/serper.js';

// ─── Config ───────────────────────────────────────────

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'impression-data');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 50 : 50;
})();
const LURE_FILTER = (() => {
  const idx = process.argv.indexOf('--lure');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// 自サイトは除外、ショッピングサイトも除外
const EXCLUDED_DOMAINS = [
  'castlog.xyz',
  'lure-db.com',
  'amazon.co.jp',
  'rakuten.co.jp',
  'shopping.yahoo.co.jp',
  'naturum.co.jp',
  'casting.co.jp',
];

// ─── Helper ───────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function todayStr() { return new Date().toISOString().split('T')[0]; }

// ─── Serper.dev 検索 ─────────────────────────────────

interface BlogArticle {
  title: string;
  url: string;
  snippet: string;
  displayLink: string;
  datePublished?: string;
}

async function searchBlogImpressions(lureName: string): Promise<BlogArticle[]> {
  const query = `${lureName} インプレ`;
  const excludeQuery = EXCLUDED_DOMAINS.map(d => `-site:${d}`).join(' ');
  const fullQuery = `${query} ${excludeQuery}`;

  const results = await searchWithSerper(fullQuery, { num: 10 });

  return results.map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    displayLink: r.domain,
    datePublished: r.date || undefined,
  }));
}

// ─── Supabase ─────────────────────────────────────────

interface LureTarget {
  name: string;
  slug: string;
  manufacturer_slug: string;
}

async function fetchLureTargets(): Promise<LureTarget[]> {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  const seen = new Map<string, LureTarget>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('name, slug, manufacturer_slug')
      .range(from, from + pageSize - 1);

    if (error) { log(`Supabase error: ${JSON.stringify(error)}`); break; }
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (!r.slug || !r.manufacturer_slug || !r.name) continue;
      const key = `${r.manufacturer_slug}/${r.slug}`;
      if (!seen.has(key)) {
        seen.set(key, { name: r.name, slug: r.slug, manufacturer_slug: r.manufacturer_slug });
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return [...seen.values()];
}

// ─── 優先順位（opportunity scoreベース） ──────────────

function prioritizeLures(lures: LureTarget[]): LureTarget[] {
  const today = todayStr();
  const oppFile = path.join(import.meta.dirname, '..', 'logs', 'seo-data', `opportunities-${today}.json`);

  let oppScores = new Map<string, number>();
  if (fs.existsSync(oppFile)) {
    try {
      const oppData = JSON.parse(fs.readFileSync(oppFile, 'utf8'));
      for (const lure of oppData.topLures || []) {
        const key = `${lure.manufacturerSlug}/${lure.slug}`;
        oppScores.set(key, lure.overallScore || 0);
      }
    } catch { /* skip */ }
  }

  return lures.sort((a, b) => {
    const scoreA = oppScores.get(`${a.manufacturer_slug}/${a.slug}`) || 0;
    const scoreB = oppScores.get(`${b.manufacturer_slug}/${b.slug}`) || 0;
    return scoreB - scoreA;
  });
}

// ─── 既存データ確認 ──────────────────────────────────

function loadExistingData(): Set<string> {
  const existing = new Set<string>();
  if (!fs.existsSync(DATA_DIR)) return existing;

  for (const file of fs.readdirSync(DATA_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.slug && entry.manufacturerSlug) {
            existing.add(`${entry.manufacturerSlug}/${entry.slug}`);
          }
        }
      }
    } catch { /* skip */ }
  }

  return existing;
}

// ─── Main ─────────────────────────────────────────────

interface LureImpressions {
  lureName: string;
  slug: string;
  manufacturerSlug: string;
  searchQuery: string;
  articles: BlogArticle[];
  collectedAt: string;
}

async function main() {
  log('=== Blog Impression Collector ===');

  if (!isSerperConfigured()) {
    console.error('\n❌ Serper.dev API が設定されていません。');
    console.error('\n設定手順:');
    console.error('  1. https://serper.dev/ でアカウント作成（無料枠 2,500クエリ/月）');
    console.error('  2. APIキーを取得 → .env に SERPER_API_KEY=xxxxx');
    if (!DRY_RUN) process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ルアー取得
  log('ルアーシリーズ取得中...');
  let lures = await fetchLureTargets();

  if (LURE_FILTER) {
    lures = lures.filter(l => l.name.includes(LURE_FILTER));
  }

  log(`  対象ルアー: ${lures.length} シリーズ`);

  // 優先順位付け
  lures = prioritizeLures(lures);

  // 既存データ確認
  const existing = loadExistingData();
  const uncollected = lures.filter(l => !existing.has(`${l.manufacturer_slug}/${l.slug}`));
  log(`  未収集: ${uncollected.length} / 収集済み: ${existing.size}`);

  const targets = uncollected.slice(0, LIMIT);
  log(`  今回の処理対象: ${targets.length} ルアー`);

  if (DRY_RUN) {
    console.log('\n── 処理対象ルアー（dry-run） ──');
    targets.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.name} (${l.manufacturer_slug})`);
    });
    console.log(`\nクォータ消費予定: ${targets.length} / 100 クエリ`);
    return;
  }

  if (!isSerperConfigured()) return;

  // 収集実行
  const results: LureImpressions[] = [];
  let errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const lure = targets[i];
    const searchQuery = `${lure.name} インプレ`;

    try {
      log(`[${i + 1}/${targets.length}] 検索: 「${searchQuery}」`);
      const articles = await searchBlogImpressions(lure.name);

      results.push({
        lureName: lure.name,
        slug: lure.slug,
        manufacturerSlug: lure.manufacturer_slug,
        searchQuery,
        articles,
        collectedAt: new Date().toISOString(),
      });

      logV(`  → ${articles.length}件の記事取得`);
      if (VERBOSE && articles.length > 0) {
        articles.slice(0, 3).forEach(a => {
          logV(`    📝 ${a.title} (${a.displayLink})`);
        });
      }

      await sleep(1500); // レート制限対策

    } catch (e: any) {
      errors++;
      log(`  ❌ エラー: ${e.message}`);

      if (e.message.includes('rateLimitExceeded') || e.message.includes('quotaExceeded')) {
        log('⚠️ APIクォータ超過。明日再実行してください。');
        break;
      }

      await sleep(3000);
    }
  }

  // 保存
  const today = todayStr();
  const outputPath = path.join(DATA_DIR, `impressions-${today}.json`);

  let allResults = results;
  if (fs.existsSync(outputPath)) {
    const existingToday = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    if (Array.isArray(existingToday)) {
      const newKeys = new Set(results.map(r => `${r.manufacturerSlug}/${r.slug}`));
      const merged = existingToday.filter((r: any) => !newKeys.has(`${r.manufacturerSlug}/${r.slug}`));
      allResults = [...merged, ...results];
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));

  // サマリー
  console.log('\n' + '='.repeat(50));
  console.log('BLOG IMPRESSION COLLECTION SUMMARY');
  console.log('='.repeat(50));
  console.log(`処理: ${results.length} ルアー`);
  console.log(`取得記事数: ${results.reduce((s, r) => s + r.articles.length, 0)}`);
  console.log(`エラー: ${errors}`);
  console.log(`出力: ${outputPath}`);

  // 記事が多いルアーTop 10
  const sorted = [...results].sort((a, b) => b.articles.length - a.articles.length);
  if (sorted.length > 0) {
    console.log('\n── インプレ記事数 Top 10 ──');
    sorted.slice(0, 10).forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.lureName} — ${l.articles.length}件`);
      if (l.articles[0]) console.log(`     代表: ${l.articles[0].title}`);
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
