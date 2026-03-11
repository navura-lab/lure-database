#!/usr/bin/env npx tsx
/**
 * SEO Competitor Analyzer — SERP上位ページの構造分析
 *
 * ターゲットクエリで上位表示されているページを取得・分析し、
 * CAST/LOGのページとの差分を特定する。
 *
 * データソース:
 *   1. Serper.dev API（2,500クエリ/月無料）
 *   2. fetch + cheerio でHTMLメタデータ抽出
 *
 * 出力:
 *   logs/seo-data/competitors/YYYY-MM-DD.json  — 競合分析データ
 *   logs/seo-data/competitors/YYYY-MM-DD.md    — 人間用レポート
 *
 * Usage:
 *   npx tsx scripts/seo-competitor-analyzer.ts                        # rank-trackerのTop10を分析
 *   npx tsx scripts/seo-competitor-analyzer.ts --query "ハグゴス"      # 特定クエリを分析
 *   npx tsx scripts/seo-competitor-analyzer.ts --page /littlejack/huggos/  # 特定ページの全クエリを分析
 *   npx tsx scripts/seo-competitor-analyzer.ts --limit 5              # 分析数制限
 *   npx tsx scripts/seo-competitor-analyzer.ts --verbose              # 詳細出力
 *
 * Cron: 毎週火曜 7:00 JST（週次レポート後）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { getSearchAnalytics, daysAgo, todayStr, sleep } from './lib/gsc-client.js';
import { searchWithSerper, isSerperConfigured } from './lib/serper.js';

// ─── Config ───────────────────────────────────────────

const DATA_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'competitors');
const RANKINGS_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'rankings');

const VERBOSE = process.argv.includes('--verbose');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 10 : 10;
})();

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

/** GSCの page キー（フルURL）を相対パスに正規化 */
function normalizePagePath(page: string): string {
  return page
    .replace(/^https?:\/\/[^/]+/, '')  // ドメイン部分を除去
    .replace(/^([^/])/, '/$1');        // 先頭スラッシュ保証
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────

interface SerpResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
}

interface PageMeta {
  url: string;
  title: string;
  description: string;
  h1: string[];
  h2: string[];
  wordCount: number;
  hasSchema: boolean;
  schemaTypes: string[];
  hasVideo: boolean;
  hasFaq: boolean;
  hasTable: boolean;
  imageCount: number;
  internalLinks: number;
  externalLinks: number;
  loadError?: string;
}

interface CompetitorAnalysis {
  query: string;
  ourPage: string;
  ourPosition: number;
  ourImpressions: number;
  analyzedAt: string;
  serp: SerpResult[];
  competitors: PageMeta[];
  ourMeta: PageMeta | null;
  gaps: string[];          // 我々に不足している要素
  recommendations: string[]; // 改善提案
}

// ─── Serper.dev 検索 ─────────────────────────────────

async function searchGoogle(query: string, num = 10): Promise<SerpResult[]> {
  if (!isSerperConfigured()) {
    log('⚠️ SERPER_API_KEY 未設定。SERP取得をスキップ');
    return [];
  }

  const results = await searchWithSerper(query, { num: Math.min(num, 10) });

  return results.map(r => ({
    position: r.position,
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    domain: r.domain,
  }));
}

// ─── HTML メタデータ抽出 ──────────────────────────────

async function extractPageMeta(url: string): Promise<PageMeta> {
  const meta: PageMeta = {
    url,
    title: '',
    description: '',
    h1: [],
    h2: [],
    wordCount: 0,
    hasSchema: false,
    schemaTypes: [],
    hasVideo: false,
    hasFaq: false,
    hasTable: false,
    imageCount: 0,
    internalLinks: 0,
    externalLinks: 0,
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
    meta.description = $('meta[name="description"]').attr('content')?.trim() || '';
    meta.h1 = $('h1').map((_, el) => $(el).text().trim()).get();
    meta.h2 = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 10);

    // テキスト量
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    meta.wordCount = bodyText.length; // 日本語なので文字数

    // 構造化データ（配列JSON-LDにも対応）
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
    meta.imageCount = $('img').length;

    // リンク
    const domain = new URL(url).hostname;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      try {
        const linkDomain = new URL(href, url).hostname;
        if (linkDomain === domain) meta.internalLinks++;
        else meta.externalLinks++;
      } catch {}
    });

  } catch (e: any) {
    meta.loadError = e.message;
  }

  return meta;
}

// ─── Gap Analysis ─────────────────────────────────────

function analyzeGaps(ourMeta: PageMeta | null, competitors: PageMeta[]): { gaps: string[]; recommendations: string[] } {
  const gaps: string[] = [];
  const recommendations: string[] = [];

  if (!ourMeta || competitors.length === 0) return { gaps, recommendations };

  // Title長さ比較
  const avgCompTitle = competitors.reduce((sum, c) => sum + c.title.length, 0) / competitors.length;
  if (ourMeta.title.length > avgCompTitle * 1.3) {
    gaps.push(`Titleが長い（${ourMeta.title.length}文字 vs 競合平均${Math.round(avgCompTitle)}文字）`);
    recommendations.push('Titleを50-60文字に短縮（メインキーワードを先頭に）');
  }

  // Description比較
  const avgCompDesc = competitors.reduce((sum, c) => sum + c.description.length, 0) / competitors.length;
  if (ourMeta.description.length < avgCompDesc * 0.5) {
    gaps.push(`Descriptionが短い（${ourMeta.description.length}文字 vs 競合平均${Math.round(avgCompDesc)}文字）`);
    recommendations.push('Meta descriptionを120-160文字に拡充');
  }

  // コンテンツ量
  const avgWordCount = competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length;
  if (ourMeta.wordCount < avgWordCount * 0.3) {
    gaps.push(`コンテンツ量が少ない（${ourMeta.wordCount}文字 vs 競合平均${Math.round(avgWordCount)}文字）`);
    recommendations.push('ページコンテンツを増量（使い方、インプレ情報等を追加）');
  }

  // 構造化データ
  const competitorSchemaTypes = new Set(competitors.flatMap(c => c.schemaTypes));
  if (!ourMeta.hasSchema && competitorSchemaTypes.size > 0) {
    gaps.push('構造化データなし（競合は使用中）');
    recommendations.push(`JSON-LDを追加（競合の使用タイプ: ${[...competitorSchemaTypes].join(', ')}）`);
  }

  // FAQ
  const faqRate = competitors.filter(c => c.hasFaq).length / competitors.length;
  if (faqRate > 0.3 && !ourMeta.hasFaq) {
    gaps.push(`FAQ未実装（競合の${Math.round(faqRate * 100)}%が実装）`);
    recommendations.push('FAQセクションを追加（よくある質問 3-5件）');
  }

  // Video
  const videoRate = competitors.filter(c => c.hasVideo).length / competitors.length;
  if (videoRate > 0.3 && !ourMeta.hasVideo) {
    gaps.push(`動画なし（競合の${Math.round(videoRate * 100)}%が掲載）`);
    recommendations.push('YouTube動画を埋め込み');
  }

  // 画像数
  const avgImages = competitors.reduce((sum, c) => sum + c.imageCount, 0) / competitors.length;
  if (ourMeta.imageCount < avgImages * 0.5) {
    gaps.push(`画像少ない（${ourMeta.imageCount}枚 vs 競合平均${Math.round(avgImages)}枚）`);
  }

  return { gaps, recommendations };
}

// ─── ターゲットクエリ選定 ──────────────────────────────

async function selectTargetQueries(): Promise<{ query: string; page: string; position: number; impressions: number }[]> {
  // --query 指定があればそれを使う
  const queryIdx = process.argv.indexOf('--query');
  if (queryIdx !== -1 && process.argv[queryIdx + 1]) {
    const query = process.argv[queryIdx + 1];
    return [{ query, page: '', position: 0, impressions: 0 }];
  }

  // --page 指定があればそのページの全クエリを分析
  const pageIdx = process.argv.indexOf('--page');
  if (pageIdx !== -1 && process.argv[pageIdx + 1]) {
    const targetPage = process.argv[pageIdx + 1];
    const endDate = daysAgo(2);
    const startDate = daysAgo(30);
    const rows = await getSearchAnalytics(startDate, endDate, ['query', 'page'], 1000, [
      { dimension: 'page', operator: 'contains', expression: targetPage },
    ]);
    return rows
      .map(r => ({ query: r.keys[0], page: normalizePagePath(r.keys[1]), position: r.position, impressions: r.impressions }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, LIMIT);
  }

  // デフォルト: rank-trackerのトレンドデータからTop機会を選択
  const trendsFile = path.join(RANKINGS_DIR, 'trends.json');
  if (fs.existsSync(trendsFile)) {
    const trends = JSON.parse(fs.readFileSync(trendsFile, 'utf-8'));
    return trends
      .filter((t: any) => t.currentPosition >= 2 && t.currentPosition <= 15)
      .slice(0, LIMIT)
      .map((t: any) => ({
        query: t.query,
        page: t.page,
        position: t.currentPosition,
        impressions: t.currentImpressions,
      }));
  }

  // フォールバック: GSCから直接取得
  const endDate = daysAgo(2);
  const startDate = daysAgo(30);
  const rows = await getSearchAnalytics(startDate, endDate, ['query', 'page'], 200);
  return rows
    .filter(r => r.position >= 2 && r.position <= 15 && r.impressions >= 2)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, LIMIT)
    .map(r => ({ query: r.keys[0], page: normalizePagePath(r.keys[1]), position: r.position, impressions: r.impressions }));
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Competitor Analyzer Start ===');

  const targets = await selectTargetQueries();
  if (targets.length === 0) {
    log('分析対象のクエリがありません');
    return;
  }
  log(`${targets.length}件のクエリを分析`);

  const analyses: CompetitorAnalysis[] = [];

  for (const target of targets) {
    log(`\n--- Analyzing: "${target.query}" (pos=${target.position.toFixed(1)}, imp=${target.impressions}) ---`);

    // SERP取得
    const serp = await searchGoogle(target.query, 10);
    logV(`SERP results: ${serp.length}`);

    if (serp.length === 0) {
      log('  SERP取得失敗（CSE APIキーを確認）');
      // SERP無しでも自サイトの分析は行う
    }

    // 上位3サイト（自サイト除外）の詳細取得
    const competitorUrls = serp
      .filter(s => !s.url.includes('lure-db.com'))
      .slice(0, 3);

    const competitors: PageMeta[] = [];
    for (const comp of competitorUrls) {
      logV(`  Fetching: ${comp.url}`);
      const meta = await extractPageMeta(comp.url);
      competitors.push(meta);
      await sleep(1000); // 丁寧にクロール
    }

    // 自サイトのメタデータ
    let ourMeta: PageMeta | null = null;
    if (target.page) {
      // target.page は既に正規化済み（相対パス）
      const ourUrl = `https://www.lure-db.com${target.page}`;
      logV(`  Fetching our page: ${ourUrl}`);
      ourMeta = await extractPageMeta(ourUrl);
    }

    // Gap分析
    const { gaps, recommendations } = analyzeGaps(ourMeta, competitors);

    analyses.push({
      query: target.query,
      ourPage: target.page,
      ourPosition: target.position,
      ourImpressions: target.impressions,
      analyzedAt: new Date().toISOString(),
      serp,
      competitors,
      ourMeta,
      gaps,
      recommendations,
    });

    // レート制限対策
    await sleep(2000);
  }

  // 保存
  const dateStr = todayStr();
  const jsonFile = path.join(DATA_DIR, `${dateStr}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(analyses, null, 2));
  log(`\nSaved analysis to ${jsonFile}`);

  // レポート生成
  const report = generateReport(analyses);
  const mdFile = path.join(DATA_DIR, `${dateStr}.md`);
  fs.writeFileSync(mdFile, report);
  log(`Report: ${mdFile}`);

  // サマリー
  log('\n=== Analysis Summary ===');
  for (const a of analyses) {
    log(`  "${a.query}" (pos=${a.ourPosition.toFixed(1)}): ${a.gaps.length} gaps, ${a.recommendations.length} recommendations`);
    for (const r of a.recommendations) {
      log(`    → ${r}`);
    }
  }
}

function generateReport(analyses: CompetitorAnalysis[]): string {
  const lines: string[] = [];
  lines.push(`# SEO Competitor Analysis — ${todayStr()}`);
  lines.push('');
  lines.push(`分析クエリ数: ${analyses.length}`);
  lines.push('');

  for (const a of analyses) {
    lines.push(`## 「${a.query}」 — 現在 ${a.ourPosition.toFixed(1)}位 (${a.ourImpressions} imp)`);
    lines.push('');

    if (a.serp.length > 0) {
      lines.push('### SERP Top 5');
      lines.push('| # | Title | Domain |');
      lines.push('|---|-------|--------|');
      for (const s of a.serp.slice(0, 5)) {
        lines.push(`| ${s.position} | ${s.title.substring(0, 50)} | ${s.domain} |`);
      }
      lines.push('');
    }

    if (a.gaps.length > 0) {
      lines.push('### Gap（不足要素）');
      for (const g of a.gaps) lines.push(`- ❌ ${g}`);
      lines.push('');
    }

    if (a.recommendations.length > 0) {
      lines.push('### 推奨アクション');
      for (const r of a.recommendations) lines.push(`- ✅ ${r}`);
      lines.push('');
    }

    if (a.ourMeta && a.competitors.length > 0) {
      lines.push('### 比較表');
      lines.push('| 指標 | CAST/LOG | 競合1 | 競合2 | 競合3 |');
      lines.push('|------|---------|-------|-------|-------|');

      const comp = a.competitors;
      lines.push(`| Title長 | ${a.ourMeta.title.length} | ${comp[0]?.title.length || '-'} | ${comp[1]?.title.length || '-'} | ${comp[2]?.title.length || '-'} |`);
      lines.push(`| Desc長 | ${a.ourMeta.description.length} | ${comp[0]?.description.length || '-'} | ${comp[1]?.description.length || '-'} | ${comp[2]?.description.length || '-'} |`);
      lines.push(`| コンテンツ量 | ${a.ourMeta.wordCount} | ${comp[0]?.wordCount || '-'} | ${comp[1]?.wordCount || '-'} | ${comp[2]?.wordCount || '-'} |`);
      lines.push(`| 画像数 | ${a.ourMeta.imageCount} | ${comp[0]?.imageCount || '-'} | ${comp[1]?.imageCount || '-'} | ${comp[2]?.imageCount || '-'} |`);
      lines.push(`| Schema | ${a.ourMeta.hasSchema ? '✅' : '❌'} | ${comp[0]?.hasSchema ? '✅' : '❌'} | ${comp[1]?.hasSchema ? '✅' : '❌'} | ${comp[2]?.hasSchema ? '✅' : '❌'} |`);
      lines.push(`| Video | ${a.ourMeta.hasVideo ? '✅' : '❌'} | ${comp[0]?.hasVideo ? '✅' : '❌'} | ${comp[1]?.hasVideo ? '✅' : '❌'} | ${comp[2]?.hasVideo ? '✅' : '❌'} |`);
      lines.push(`| FAQ | ${a.ourMeta.hasFaq ? '✅' : '❌'} | ${comp[0]?.hasFaq ? '✅' : '❌'} | ${comp[1]?.hasFaq ? '✅' : '❌'} | ${comp[2]?.hasFaq ? '✅' : '❌'} |`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
