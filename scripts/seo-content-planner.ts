#!/usr/bin/env npx tsx
/**
 * SEO Content Planner — 記事ブループリント自動生成
 *
 * GSCデータ + Serper SERP分析 + Supabase DBデータから
 * SEO記事のブループリント（設計図）を自動生成する。
 *
 * Phase 1: KW選定（GSCから高インプレ・低CTRクエリ抽出）
 * Phase 2: 競合SERP分析（Serper.dev → Cheerio構造抽出）
 * Phase 3: DBデータ集計（対象カテゴリのルアーデータ）
 * Phase 4: ブループリントJSON出力
 *
 * 出力:
 *   logs/seo-data/blueprints/{slug}.json  — 個別ブループリント
 *   logs/seo-data/blueprints/summary.md   — 一覧レポート
 *
 * Usage:
 *   npx tsx scripts/seo-content-planner.ts                  # KW分析のみ（Serper不使用）
 *   npx tsx scripts/seo-content-planner.ts --analyze        # SERP分析 + DB集計 + ブループリント出力
 *   npx tsx scripts/seo-content-planner.ts --analyze --count 5   # 上位5件を分析
 *   npx tsx scripts/seo-content-planner.ts --verbose        # 詳細出力
 *
 * Serper消費: --analyze 時のみ、1テーマ1クエリ（月20-40クエリ想定）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { getSearchAnalytics, daysAgo, todayStr, sleep } from './lib/gsc-client.js';
import { searchWithSerper, isSerperConfigured } from './lib/serper.js';

// ─── Config ───────────────────────────────────────────

const BLUEPRINTS_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'blueprints');
const VERBOSE = process.argv.includes('--verbose');
const DO_ANALYZE = process.argv.includes('--analyze');
const COUNT = (() => {
  const idx = process.argv.indexOf('--count');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 10 : 10;
})();

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

fs.mkdirSync(BLUEPRINTS_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────

type ArticleType = 'color-guide' | 'review-analysis' | 'selection-guide' | 'howto';

interface ArticleTheme {
  slug: string;
  type: ArticleType;
  mainKeyword: string;
  subKeywords: string[];
  totalImpressions: number;
  avgPosition: number;
  avgCtr: number;
  /** 優先度スコア（高いほど優先） */
  priorityScore: number;
  /** 関連GSCクエリ */
  queries: { query: string; impressions: number; position: number; ctr: number }[];
}

interface CompetitorPage {
  url: string;
  title: string;
  h1: string[];
  h2: string[];
  wordCount: number;
  hasTable: boolean;
  hasFaq: boolean;
  hasVideo: boolean;
  hasSchema: boolean;
  schemaTypes: string[];
  loadError?: string;
}

interface DbData {
  totalSeries: number;
  totalColors: number;
  priceRange: { min: number; max: number };
  weightRange: { min: number; max: number };
  topSeries: { name: string; manufacturer: string; colorCount: number; slug: string }[];
  makerBreakdown: { name: string; count: number }[];
}

interface ArticleBlueprint {
  slug: string;
  templateType: ArticleType;
  mainKeyword: string;
  subKeywords: string[];
  searchVolume: number;
  competitorAnalysis: CompetitorPage[];
  dbData: DbData;
  recommendedStructure: {
    title: string;
    h1: string;
    sections: { heading: string; purpose: string }[];
    targetWordCount: number;
    faqTopics: string[];
  };
  generatedAt: string;
}

// ─── Phase 1: KW選定 ─────────────────────────────────

/** クエリの意図を分類 */
function classifyQueryIntent(query: string): ArticleType | null {
  // カラーガイド: 「{商品名} カラー」「{商品名} おすすめカラー」
  if (/カラー|color/i.test(query)) return 'color-guide';

  // レビュー分析: 「{商品名} インプレ」「{商品名} レビュー」「{商品名} 評価」
  if (/インプレ|レビュー|評価|review|impression/i.test(query)) return 'review-analysis';

  // 使い方: 「{タイプ} 使い方」「{タイプ} アクション」「{タイプ} テクニック」
  if (/使い方|アクション|テクニック|釣り方|howto/i.test(query)) return 'howto';

  // 選び方: 「{魚種} ルアー 選び方」「{魚種} {タイプ} おすすめ」
  if (/選び方|おすすめ|最強|人気|ランキング|比較/i.test(query)) return 'selection-guide';

  return null;
}

/** クエリからスラッグを生成 */
function queryToSlug(query: string): string {
  return query
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF-]/g, '')
    .toLowerCase()
    .slice(0, 60);
}

async function discoverThemes(): Promise<ArticleTheme[]> {
  log('Phase 1: GSCからキーワード取得...');

  // 過去28日の全クエリデータ（上位500件）
  const rows = await getSearchAnalytics(daysAgo(28), daysAgo(1), ['query'], 500);

  log(`  GSCクエリ: ${rows.length}件取得`);

  // クエリを意図別に分類
  const classified = new Map<string, {
    type: ArticleType;
    queries: typeof rows;
  }>();

  for (const row of rows) {
    const query = row.keys[0];
    const intent = classifyQueryIntent(query);
    if (!intent) continue;

    // 同じ意図のクエリをグルーピング
    // まずはメインキーワードとして個別に扱う
    const key = `${intent}:${query}`;
    if (!classified.has(key)) {
      classified.set(key, { type: intent, queries: [] });
    }
    classified.get(key)!.queries.push(row);
  }

  // テーマ候補を作成
  const themes: ArticleTheme[] = [];

  for (const [key, data] of classified) {
    const totalImp = data.queries.reduce((s, q) => s + q.impressions, 0);
    const avgPos = data.queries.reduce((s, q) => s + q.position * q.impressions, 0) / totalImp;
    const avgCtr = data.queries.reduce((s, q) => s + q.ctr * q.impressions, 0) / totalImp;
    const mainQuery = data.queries[0].keys[0];

    // 優先度スコア: インプレッション × (1 - CTR) × (1/順位) — CTRが低い＝改善余地大
    const priorityScore = totalImp * Math.max(0, 1 - avgCtr / 0.05) * (1 / Math.max(avgPos, 1));

    themes.push({
      slug: queryToSlug(mainQuery),
      type: data.type,
      mainKeyword: mainQuery,
      subKeywords: data.queries.slice(1).map(q => q.keys[0]),
      totalImpressions: totalImp,
      avgPosition: Math.round(avgPos * 10) / 10,
      avgCtr: Math.round(avgCtr * 1000) / 10,
      priorityScore: Math.round(priorityScore * 100) / 100,
      queries: data.queries.map(q => ({
        query: q.keys[0],
        impressions: q.impressions,
        position: Math.round(q.position * 10) / 10,
        ctr: Math.round(q.ctr * 1000) / 10,
      })),
    });
  }

  // 優先度順にソート
  themes.sort((a, b) => b.priorityScore - a.priorityScore);

  log(`  テーマ候補: ${themes.length}件`);
  log(`  内訳: color-guide=${themes.filter(t => t.type === 'color-guide').length}, review=${themes.filter(t => t.type === 'review-analysis').length}, selection=${themes.filter(t => t.type === 'selection-guide').length}, howto=${themes.filter(t => t.type === 'howto').length}`);

  return themes;
}

// ─── Phase 2: 競合SERP分析 ────────────────────────────

async function extractPageMeta(url: string): Promise<CompetitorPage> {
  const meta: CompetitorPage = {
    url,
    title: '',
    h1: [],
    h2: [],
    wordCount: 0,
    hasTable: false,
    hasFaq: false,
    hasVideo: false,
    hasSchema: false,
    schemaTypes: [],
  };

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'ja,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      meta.loadError = `HTTP ${res.status}`;
      return meta;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    meta.title = $('title').text().trim();
    meta.h1 = $('h1').map((_, el) => $(el).text().trim()).get();
    meta.h2 = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 15);

    // 文字数（日本語）
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    meta.wordCount = bodyText.length;

    // 構造化データ
    const schemas = $('script[type="application/ld+json"]');
    if (schemas.length > 0) {
      meta.hasSchema = true;
      schemas.each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}');
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            const type = item['@type'];
            if (type) meta.schemaTypes.push(Array.isArray(type) ? type.join(',') : type);
          }
        } catch {}
      });
    }

    // コンテンツ要素
    meta.hasVideo = $('iframe[src*="youtube"], iframe[src*="vimeo"], video').length > 0;
    meta.hasFaq = $('[itemtype*="FAQPage"], .faq, #faq, [class*="faq"]').length > 0
      || html.includes('FAQPage');
    meta.hasTable = $('table').length > 0;

  } catch (e: any) {
    meta.loadError = e.message;
  }

  return meta;
}

async function analyzeSERP(keyword: string): Promise<CompetitorPage[]> {
  if (!isSerperConfigured()) {
    log('  ⚠️ SERPER_API_KEY未設定。SERP分析スキップ');
    return [];
  }

  logV(`  Serper検索: "${keyword}"`);
  const results = await searchWithSerper(keyword, { num: 5 });

  // 自サイトを除外し、上位3件を分析
  const competitors = results
    .filter(r => !r.link.includes('lure-db.com'))
    .slice(0, 3);

  const pages: CompetitorPage[] = [];
  for (const comp of competitors) {
    logV(`  分析中: ${comp.link}`);
    const meta = await extractPageMeta(comp.link);
    pages.push(meta);
    await sleep(1000); // ポリット間隔
  }

  return pages;
}

// ─── Phase 3: DBデータ集計 ─────────────────────────────

async function fetchDbData(theme: ArticleTheme): Promise<DbData> {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  // テーマのメインキーワードからフィルタ条件を推定
  const keyword = theme.mainKeyword;

  // ルアーの基本集計（全件取得は重いのでタイプ/魚種でフィルタ）
  let query = sb.from('lures').select('slug,name,manufacturer,manufacturer_slug,type,target_fish,price,color_name,weight');

  // キーワードからタイプ名を推定してフィルタ
  const typeNames = ['ミノー', 'クランクベイト', 'シャッド', 'バイブレーション', 'メタルバイブレーション',
    'ペンシルベイト', 'シンキングペンシル', 'ポッパー', 'トップウォーター', 'スイムベイト',
    'ビッグベイト', 'フロッグ', 'スピナーベイト', 'チャターベイト', 'メタルジグ',
    'スプーン', 'ワーム', 'ラバージグ', 'ジグヘッド', 'エギ', 'タイラバ'];

  const matchedType = typeNames.find(t => keyword.includes(t));
  if (matchedType) {
    query = query.eq('type', matchedType);
  }

  const { data, error } = await query.limit(2000);
  if (error || !data) {
    log(`  DB取得エラー: ${error?.message || 'no data'}`);
    return { totalSeries: 0, totalColors: 0, priceRange: { min: 0, max: 0 }, weightRange: { min: 0, max: 0 }, topSeries: [], makerBreakdown: [] };
  }

  // シリーズ単位に集約
  const seriesMap = new Map<string, {
    name: string;
    manufacturer: string;
    slug: string;
    colors: Set<string>;
    prices: number[];
    weights: number[];
  }>();

  for (const lure of data) {
    if (!lure.slug) continue;
    if (!seriesMap.has(lure.slug)) {
      seriesMap.set(lure.slug, {
        name: lure.name,
        manufacturer: lure.manufacturer,
        slug: lure.slug,
        colors: new Set(),
        prices: [],
        weights: [],
      });
    }
    const s = seriesMap.get(lure.slug)!;
    if (lure.color_name) s.colors.add(lure.color_name);
    if (lure.price && lure.price > 0) s.prices.push(lure.price);
    if (lure.weight && lure.weight > 0) s.weights.push(lure.weight);
  }

  const allPrices = [...seriesMap.values()].flatMap(s => s.prices);
  const allWeights = [...seriesMap.values()].flatMap(s => s.weights);

  // メーカー別集計
  const makerCount = new Map<string, number>();
  for (const s of seriesMap.values()) {
    makerCount.set(s.manufacturer, (makerCount.get(s.manufacturer) || 0) + 1);
  }

  // カラー数順にトップシリーズ
  const topSeries = [...seriesMap.values()]
    .map(s => ({ name: s.name, manufacturer: s.manufacturer, colorCount: s.colors.size, slug: s.slug }))
    .sort((a, b) => b.colorCount - a.colorCount)
    .slice(0, 20);

  return {
    totalSeries: seriesMap.size,
    totalColors: data.length,
    priceRange: {
      min: allPrices.length > 0 ? Math.min(...allPrices) : 0,
      max: allPrices.length > 0 ? Math.max(...allPrices) : 0,
    },
    weightRange: {
      min: allWeights.length > 0 ? Math.min(...allWeights) : 0,
      max: allWeights.length > 0 ? Math.max(...allWeights) : 0,
    },
    topSeries,
    makerBreakdown: [...makerCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

// ─── Phase 4: ブループリント生成 ──────────────────────

function generateRecommendedStructure(theme: ArticleTheme, competitors: CompetitorPage[], dbData: DbData) {
  // 競合の平均文字数を基に目標文字数を設定
  const avgWordCount = competitors.length > 0
    ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length)
    : 5000;
  const targetWordCount = Math.max(4000, Math.min(8000, Math.round(avgWordCount * 1.2)));

  // 競合のH2からよく使われる見出しパターンを抽出
  const allH2s = competitors.flatMap(c => c.h2);

  // テンプレートタイプ別の推奨構成
  let sections: { heading: string; purpose: string }[];
  let faqTopics: string[];
  let title: string;
  let h1: string;

  switch (theme.type) {
    case 'color-guide':
      title = `${theme.mainKeyword}ガイド`;
      h1 = `${theme.mainKeyword}を徹底分析`;
      sections = [
        { heading: 'カラーラインナップ概要', purpose: '全カラー数・系統分布を紹介' },
        { heading: 'シーン別おすすめカラー', purpose: '状況に応じたカラー選びを解説' },
        { heading: 'カラーチャート分析', purpose: 'ナチュラル系/チャート系/クリア系の分布' },
        { heading: '限定カラー・廃盤カラー情報', purpose: '入手困難カラーの情報' },
        { heading: 'まとめ', purpose: '結論と選び方の要約' },
      ];
      faqTopics = [
        '人気カラーは何か',
        'カラー選びの基本は',
        '限定カラーの入手方法',
      ];
      break;

    case 'review-analysis':
      title = `${theme.mainKeyword}分析`;
      h1 = `${theme.mainKeyword}をデータで分析`;
      sections = [
        { heading: '基本スペック', purpose: 'サイズ・重量・価格の一覧' },
        { heading: '同カテゴリ比較', purpose: '競合製品との比較表' },
        { heading: 'カラー展開の特徴', purpose: 'カラーラインナップの分析' },
        { heading: 'スペック分析', purpose: '重量バリエーション・価格帯の評価' },
        { heading: '使いどころ', purpose: '推奨シーン・ターゲット・フィールド' },
        { heading: 'まとめ', purpose: '総合評価と選び方' },
      ];
      faqTopics = [
        '価格帯はどれくらいか',
        '類似製品との違い',
        'おすすめのカラーは',
      ];
      break;

    case 'selection-guide':
      title = `${theme.mainKeyword}`;
      h1 = `${theme.mainKeyword}ガイド`;
      sections = [
        { heading: '選び方の3つのポイント', purpose: 'サイズ・重量・カラーの選定基準' },
        { heading: '価格帯別おすすめ', purpose: '予算別の推奨商品' },
        { heading: 'メーカー別特徴', purpose: '主要メーカーの製品傾向' },
        { heading: 'シーズン別の選び方', purpose: '季節に応じた選び方' },
        { heading: '注目シリーズ', purpose: 'データベースから厳選したトップ10' },
        { heading: 'まとめ', purpose: '結論と推奨の組み合わせ' },
      ];
      faqTopics = [
        '初心者にはどれがおすすめか',
        '価格帯はどれくらいか',
        '何種類持てばいいか',
      ];
      break;

    case 'howto':
      title = `${theme.mainKeyword}完全ガイド`;
      h1 = `${theme.mainKeyword}完全ガイド`;
      sections = [
        { heading: '基本概要', purpose: 'ルアータイプの特性と用途' },
        { heading: '基本アクション', purpose: 'リトリーブ・ジャーク・フォール等の解説' },
        { heading: 'シーン別テクニック', purpose: 'フィールド別の使い分け' },
        { heading: 'タックルセッティング', purpose: '推奨ロッド・リール・ライン' },
        { heading: 'おすすめルアー', purpose: 'データベースからの推奨商品' },
        { heading: 'まとめ', purpose: '上達のためのポイント' },
      ];
      faqTopics = [
        '初心者でも使えるか',
        'どんなロッドが向いているか',
        '最適なシーズンは',
      ];
      break;
  }

  // 競合のH2で頻出するトピックがあれば追加候補として提案
  if (allH2s.length > 0) {
    const ourHeadings = new Set(sections.map(s => s.heading));
    const competitorTopics = allH2s
      .filter(h => !ourHeadings.has(h) && h.length > 3 && h.length < 30)
      .slice(0, 5);
    if (competitorTopics.length > 0) {
      logV(`  競合で頻出するH2: ${competitorTopics.join(', ')}`);
    }
  }

  // titleを30文字以内に
  if (title.length > 30) title = title.slice(0, 28) + '…';
  if (h1.length > 28) h1 = h1.slice(0, 26) + '…';

  return { title, h1, sections, targetWordCount, faqTopics };
}

// ─── レポート出力 ─────────────────────────────────────

function writeReport(themes: ArticleTheme[], blueprints: ArticleBlueprint[]) {
  const today = todayStr();

  // サマリーMarkdown
  const lines: string[] = [
    `# SEO Content Planner レポート（${today}）`,
    '',
    `テーマ候補: ${themes.length}件（上位${COUNT}件を分析）`,
    '',
    '## テーマ一覧（優先度順）',
    '',
    '| # | タイプ | メインKW | imp | 順位 | CTR | スコア |',
    '|---|--------|---------|-----|------|-----|--------|',
  ];

  for (let i = 0; i < Math.min(themes.length, 30); i++) {
    const t = themes[i];
    const analyzed = blueprints.find(b => b.slug === t.slug) ? '✅' : '';
    lines.push(`| ${i + 1}${analyzed} | ${t.type} | ${t.mainKeyword} | ${t.totalImpressions} | ${t.avgPosition} | ${t.avgCtr}% | ${t.priorityScore} |`);
  }

  if (blueprints.length > 0) {
    lines.push('', '## ブループリント詳細', '');

    for (const bp of blueprints) {
      lines.push(`### ${bp.mainKeyword}（${bp.templateType}）`);
      lines.push('');
      lines.push(`- 推奨title: ${bp.recommendedStructure.title}`);
      lines.push(`- 推奨H1: ${bp.recommendedStructure.h1}`);
      lines.push(`- 目標文字数: ${bp.recommendedStructure.targetWordCount}文字`);
      lines.push(`- DBデータ: ${bp.dbData.totalSeries}シリーズ、価格${bp.dbData.priceRange.min}-${bp.dbData.priceRange.max}円`);
      lines.push('');
      lines.push('推奨構成:');
      for (const s of bp.recommendedStructure.sections) {
        lines.push(`  - ${s.heading}（${s.purpose}）`);
      }
      lines.push('');

      if (bp.competitorAnalysis.length > 0) {
        lines.push('競合分析:');
        for (const c of bp.competitorAnalysis) {
          lines.push(`  - ${c.title}（${c.wordCount}文字、H2=${c.h2.length}個、表=${c.hasTable}、FAQ=${c.hasFaq}）`);
        }
        lines.push('');
      }
    }
  }

  const reportPath = path.join(BLUEPRINTS_DIR, 'summary.md');
  fs.writeFileSync(reportPath, lines.join('\n'));
  log(`レポート保存: ${reportPath}`);
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Content Planner ===');

  // Phase 1: KW選定
  const themes = await discoverThemes();

  if (themes.length === 0) {
    log('記事テーマ候補が見つかりませんでした。');
    return;
  }

  // 上位N件を表示
  log(`\n上位${Math.min(themes.length, COUNT)}件のテーマ候補:`);
  for (let i = 0; i < Math.min(themes.length, COUNT); i++) {
    const t = themes[i];
    log(`  ${i + 1}. [${t.type}] "${t.mainKeyword}" (imp=${t.totalImpressions}, pos=${t.avgPosition}, ctr=${t.avgCtr}%, score=${t.priorityScore})`);
  }

  const blueprints: ArticleBlueprint[] = [];

  if (DO_ANALYZE) {
    // Phase 2-4: 上位N件を詳細分析
    const targets = themes.slice(0, COUNT);

    for (const theme of targets) {
      log(`\n─── 分析: "${theme.mainKeyword}" (${theme.type}) ───`);

      // Phase 2: SERP分析
      const competitors = await analyzeSERP(theme.mainKeyword);
      log(`  競合: ${competitors.length}件分析`);

      // Phase 3: DBデータ
      const dbData = await fetchDbData(theme);
      log(`  DB: ${dbData.totalSeries}シリーズ、${dbData.totalColors}カラー`);

      // Phase 4: ブループリント生成
      const recommended = generateRecommendedStructure(theme, competitors, dbData);

      const blueprint: ArticleBlueprint = {
        slug: theme.slug,
        templateType: theme.type,
        mainKeyword: theme.mainKeyword,
        subKeywords: theme.subKeywords,
        searchVolume: theme.totalImpressions,
        competitorAnalysis: competitors,
        dbData,
        recommendedStructure: recommended,
        generatedAt: new Date().toISOString(),
      };

      blueprints.push(blueprint);

      // 個別JSON保存
      const bpPath = path.join(BLUEPRINTS_DIR, `${theme.slug}.json`);
      fs.writeFileSync(bpPath, JSON.stringify(blueprint, null, 2));
      logV(`  ブループリント保存: ${bpPath}`);

      await sleep(2000); // API間隔
    }
  }

  // レポート出力
  writeReport(themes, blueprints);

  log(`\n完了。テーマ${themes.length}件、ブループリント${blueprints.length}件生成`);
  if (!DO_ANALYZE && themes.length > 0) {
    log('\n--analyze オプションでSERP分析 + ブループリント生成を実行できます');
    log(`例: npx tsx scripts/seo-content-planner.ts --analyze --count ${Math.min(themes.length, 5)}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
