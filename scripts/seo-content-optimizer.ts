#!/usr/bin/env npx tsx
/**
 * SEO Content Optimizer — AI駆動のタイトル・説明文最適化
 *
 * competitor-analyzerの結果を基に、各ページの最適なtitle/descriptionを
 * Claude Sonnetで生成し、DBに書き込む。
 *
 * フロー:
 *   1. 競合分析データ読み込み（competitors/YYYY-MM-DD.json）
 *   2. 各ページの現在のtitle/description取得（Supabase）
 *   3. 競合との差分＋GSCクエリデータを基にプロンプト生成
 *   4. Claude Sonnet APIでリライト生成
 *   5. DB書き込み（--apply時）
 *
 * 出力:
 *   logs/seo-data/optimizations/YYYY-MM-DD.json  — 最適化提案
 *   logs/seo-data/optimizations/YYYY-MM-DD.md    — 人間用レポート
 *
 * Usage:
 *   npx tsx scripts/seo-content-optimizer.ts                           # 提案生成のみ
 *   npx tsx scripts/seo-content-optimizer.ts --apply                   # DB書き込み
 *   npx tsx scripts/seo-content-optimizer.ts --page /littlejack/huggos/ # 特定ページ
 *   npx tsx scripts/seo-content-optimizer.ts --dry-run                 # プロンプト確認
 *   npx tsx scripts/seo-content-optimizer.ts --verbose
 *
 * Note: Claude API呼び出しにはANTHROPIC_API_KEYが必要
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { todayStr } from './lib/gsc-client.js';

// ─── Config ───────────────────────────────────────────

const COMPETITORS_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'competitors');
const OUTPUT_DIR = path.join(import.meta.dirname, '..', 'logs', 'seo-data', 'optimizations');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const APPLY = process.argv.includes('--apply');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const TARGET_PAGE = (() => {
  const idx = process.argv.indexOf('--page');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function logV(msg: string) { if (VERBOSE) log(msg); }

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Types ────────────────────────────────────────────

interface Optimization {
  page: string;
  query: string;
  currentPosition: number;
  currentTitle: string;
  currentDescription: string;
  suggestedTitle: string;
  suggestedDescription: string;
  reasoning: string;
  competitorTitles: string[];
  expectedImpact: string;
  applied: boolean;
}

// ─── Supabase ─────────────────────────────────────────

async function getLureByPath(pagePath: string): Promise<any | null> {
  // /manufacturer_slug/slug/ → manufacturer_slug, slug
  const parts = pagePath.replace(/^\/|\/$/g, '').split('/');
  if (parts.length !== 2) return null;

  const [manufacturerSlug, slug] = parts;

  const { data } = await sb
    .from('lures')
    .select('name, manufacturer, manufacturer_slug, slug, type, description, color_name, weight, length, price')
    .eq('manufacturer_slug', manufacturerSlug)
    .eq('slug', slug)
    .limit(1);

  return data?.[0] || null;
}

async function updateDescription(manufacturerSlug: string, slug: string, description: string): Promise<number> {
  const { data, error } = await sb
    .from('lures')
    .update({ description })
    .eq('manufacturer_slug', manufacturerSlug)
    .eq('slug', slug)
    .select('id');

  if (error) throw new Error(`DB update failed: ${error.message}`);
  return data?.length || 0;
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

// ─── Optimization Logic ──────────────────────────────

function buildOptimizationPrompt(
  lure: any,
  query: string,
  position: number,
  competitorTitles: string[],
  competitorDescriptions: string[],
  gaps: string[],
): string {
  return `あなたはSEO専門家です。以下のルアー商品ページのtitleタグとmeta descriptionを最適化してください。

## 現在の状態
- 検索クエリ: 「${query}」
- 現在の順位: ${position}位
- 商品名: ${lure.name}
- メーカー: ${lure.manufacturer}
- タイプ: ${lure.type || '不明'}
- 現在のdescription: ${lure.description || '（なし）'}

## 競合のtitle（上位3サイト）
${competitorTitles.map((t, i) => `${i + 1}位: ${t}`).join('\n')}

## 競合のdescription（上位3サイト）
${competitorDescriptions.map((d, i) => `${i + 1}位: ${d.substring(0, 160)}`).join('\n')}

## 検出されたGap
${gaps.map(g => `- ${g}`).join('\n')}

## 制約
- titleは50-60文字。メインキーワード「${query}」を先頭近くに配置
- descriptionは120-160文字。検索意図に合った具体的な情報を含める
- CAST/LOGはルアーデータベースサイト。スペック・カラー・価格情報が強み
- 「おすすめ」「最強」「ヤバい」等の根拠なしワードは禁止
- サイト名「CAST/LOG」はtitle末尾に「 | CAST/LOG」形式で付ける

## 出力形式（JSONのみ、説明不要）
\`\`\`json
{
  "title": "...",
  "description": "...",
  "reasoning": "変更理由を1-2文で"
}
\`\`\``;
}

// ─── Main ─────────────────────────────────────────────

async function main() {
  log('=== SEO Content Optimizer Start ===');

  // 最新の競合分析データを読み込み
  const files = fs.readdirSync(COMPETITORS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    log('競合分析データがありません。先に seo-competitor-analyzer.ts を実行してください。');
    return;
  }

  const latestFile = path.join(COMPETITORS_DIR, files[0]);
  log(`Using: ${files[0]}`);
  const analyses = JSON.parse(fs.readFileSync(latestFile, 'utf-8'));

  const optimizations: Optimization[] = [];

  for (const analysis of analyses) {
    // ourPage がフルURLの場合は相対パスに正規化
    const pagePath = analysis.ourPage.replace(/^https?:\/\/[^/]+/, '');
    if (TARGET_PAGE && pagePath !== TARGET_PAGE) continue;

    log(`\n--- Optimizing: "${analysis.query}" on ${pagePath} ---`);

    // DBからルアーデータ取得
    const lure = await getLureByPath(pagePath);
    if (!lure) {
      log(`  ⚠️ ルアーデータが見つかりません: ${analysis.ourPage}`);
      continue;
    }

    const competitorTitles = analysis.competitors.map((c: any) => c.title).filter(Boolean);
    const competitorDescriptions = analysis.competitors.map((c: any) => c.description).filter(Boolean);

    // 現在のtitleを構築（Astroテンプレートと同じロジック）
    const currentTitle = `${lure.name}（${lure.manufacturer}）スペック・カラー・価格 | CAST/LOG`;

    const prompt = buildOptimizationPrompt(
      lure,
      analysis.query,
      analysis.ourPosition,
      competitorTitles,
      competitorDescriptions,
      analysis.gaps || [],
    );

    if (DRY_RUN) {
      log('  [DRY RUN] Prompt:');
      console.log(prompt);
      continue;
    }

    // Claude APIで最適化
    try {
      const response = await callClaude(prompt);
      logV(`  Response: ${response}`);

      // JSONを抽出
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log('  ⚠️ JSONパース失敗');
        continue;
      }

      const suggestion = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      const optimization: Optimization = {
        page: pagePath,
        query: analysis.query,
        currentPosition: analysis.ourPosition,
        currentTitle,
        currentDescription: lure.description || '',
        suggestedTitle: suggestion.title,
        suggestedDescription: suggestion.description,
        reasoning: suggestion.reasoning,
        competitorTitles,
        expectedImpact: `順位${analysis.ourPosition.toFixed(1)}→1-3位を目指す`,
        applied: false,
      };

      optimizations.push(optimization);

      log(`  現在: ${currentTitle}`);
      log(`  提案: ${suggestion.title}`);
      log(`  理由: ${suggestion.reasoning}`);

    } catch (e: any) {
      log(`  ⚠️ 最適化失敗: ${e.message}`);
    }
  }

  if (DRY_RUN) return;

  // 保存
  const dateStr = todayStr();
  const jsonFile = path.join(OUTPUT_DIR, `${dateStr}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(optimizations, null, 2));
  log(`\nSaved ${optimizations.length} optimizations to ${jsonFile}`);

  // --apply: DB書き込み
  if (APPLY && optimizations.length > 0) {
    log('\n=== Applying optimizations to DB ===');
    for (const opt of optimizations) {
      if (!opt.suggestedDescription) continue;

      const parts = opt.page.replace(/^\/|\/$/g, '').split('/');
      if (parts.length !== 2) continue;

      const [mfgSlug, slug] = parts;
      try {
        const count = await updateDescription(mfgSlug, slug, opt.suggestedDescription);
        opt.applied = true;
        log(`  ✅ ${opt.page}: ${count}行更新`);
      } catch (e: any) {
        log(`  ❌ ${opt.page}: ${e.message}`);
      }
    }

    // 更新後に再保存
    fs.writeFileSync(jsonFile, JSON.stringify(optimizations, null, 2));
  }

  // レポート
  const report = generateReport(optimizations);
  const mdFile = path.join(OUTPUT_DIR, `${dateStr}.md`);
  fs.writeFileSync(mdFile, report);
  log(`Report: ${mdFile}`);

  log(`\n=== Done: ${optimizations.length} optimizations ===`);
}

function generateReport(optimizations: Optimization[]): string {
  const lines: string[] = [];
  lines.push(`# SEO Content Optimization — ${todayStr()}`);
  lines.push('');
  lines.push(`最適化提案数: ${optimizations.length}`);
  lines.push(`適用済み: ${optimizations.filter(o => o.applied).length}`);
  lines.push('');

  for (const opt of optimizations) {
    lines.push(`## ${opt.page} — 「${opt.query}」 (現在${opt.currentPosition.toFixed(1)}位)`);
    lines.push('');
    lines.push('### Title');
    lines.push(`- 現在: \`${opt.currentTitle}\``);
    lines.push(`- 提案: \`${opt.suggestedTitle}\``);
    lines.push('');
    lines.push('### Description');
    lines.push(`- 現在: ${opt.currentDescription.substring(0, 100)}...`);
    lines.push(`- 提案: ${opt.suggestedDescription}`);
    lines.push('');
    lines.push(`### 理由: ${opt.reasoning}`);
    lines.push(`### 状態: ${opt.applied ? '✅ 適用済み' : '⏳ 未適用'}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
