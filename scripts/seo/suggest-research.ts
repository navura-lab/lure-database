#!/usr/bin/env npx tsx
/**
 * サジェスト収集スクリプト（SEOパイプライン Phase1）
 *
 * Supabaseから上位ルアーを取得し、Google Suggestで
 * 各ルアーのKWパターンへのサジェストを収集してJSONに保存する。
 *
 * Usage:
 *   npx tsx scripts/seo/suggest-research.ts              # デフォルト100件
 *   npx tsx scripts/seo/suggest-research.ts --limit 50   # 件数指定
 *   npx tsx scripts/seo/suggest-research.ts --limit 0    # 全件（時間がかかる）
 *
 * 出力: data/seo/keyword-research.json
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectSuggestions } from '../../src/lib/seo-pipeline/1-research/suggest-collector.js';
import { generateKeywordPatterns } from '../../src/lib/seo-pipeline/1-research/keyword-patterns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, '../../data/seo/keyword-research.json');
const DELAY_MS = 500; // レート制限: 1リクエスト/500ms

// --- CLI引数パース ---
const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 100;

interface LureRow {
  slug: string;
  name: string;
  type: string;
  target_fish: string[] | null;
  manufacturer: string;
}

interface KeywordEntry {
  query: string;
  suggestions: string[];
}

interface LureResult {
  slug: string;
  name: string;
  manufacturer: string;
  type: string;
  target_fish: string[];
  keywords: KeywordEntry[];
  collectedAt: string;
}

interface ResearchOutput {
  generatedAt: string;
  totalLures: number;
  totalQueries: number;
  totalSuggestions: number;
  lures: LureResult[];
}

async function main() {
  const sb = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  console.log(`=== CAST/LOG サジェスト収集 (Phase1) ===`);
  console.log(`対象: ${LIMIT === 0 ? '全件' : `上位${LIMIT}件`} | レート制限: ${DELAY_MS}ms/req\n`);

  // --- Supabaseからルアー取得（価格順上位 = 高単価・有名ルアー優先） ---
  let query = sb
    .from('lures')
    .select('slug, name, type, target_fish, manufacturer')
    .not('name', 'is', null)
    .order('price', { ascending: false });

  if (LIMIT > 0) {
    query = query.limit(LIMIT);
  }

  const { data: lures, error } = await query;
  if (error) {
    console.error('Supabase取得エラー:', error.message);
    process.exit(1);
  }

  console.log(`取得件数: ${lures.length}件\n`);

  // --- 既存データのロード（増分更新対応） ---
  let existing: ResearchOutput | null = null;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as ResearchOutput;
      console.log(`既存データ: ${existing.lures.length}件 → 差分のみ収集\n`);
    } catch {
      console.warn('既存JSONの読み込み失敗。フルスキャン実行。\n');
    }
  }

  const existingSlugSet = new Set(existing?.lures.map(l => l.slug) ?? []);
  const targets = (lures as LureRow[]).filter(l => !existingSlugSet.has(l.slug));
  console.log(`新規対象: ${targets.length}件\n`);

  // --- サジェスト収集 ---
  const newResults: LureResult[] = [];
  let totalQueries = 0;
  let totalSuggestions = 0;

  for (let i = 0; i < targets.length; i++) {
    const lure = targets[i];
    const patterns = generateKeywordPatterns({
      name: lure.name,
      type: lure.type,
      target_fish: lure.target_fish,
    });

    const keywords: KeywordEntry[] = [];

    for (const pattern of patterns) {
      const suggestions = await collectSuggestions(pattern);
      keywords.push({ query: pattern, suggestions });
      totalQueries++;
      totalSuggestions += suggestions.length;

      // レート制限
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    newResults.push({
      slug: lure.slug,
      name: lure.name,
      manufacturer: lure.manufacturer,
      type: lure.type,
      target_fish: lure.target_fish ?? [],
      keywords,
      collectedAt: new Date().toISOString(),
    });

    // 進捗表示
    const progress = `[${i + 1}/${targets.length}]`;
    const found = keywords.reduce((s, k) => s + k.suggestions.length, 0);
    console.log(`${progress} ${lure.name} — ${patterns.length}クエリ, ${found}サジェスト`);
  }

  // --- 既存データとマージ ---
  const mergedLures = [
    ...(existing?.lures ?? []),
    ...newResults,
  ];

  const output: ResearchOutput = {
    generatedAt: new Date().toISOString(),
    totalLures: mergedLures.length,
    totalQueries: (existing ? (existing.totalQueries ?? 0) : 0) + totalQueries,
    totalSuggestions: (existing ? (existing.totalSuggestions ?? 0) : 0) + totalSuggestions,
    lures: mergedLures,
  };

  // --- 保存 ---
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n=== 完了 ===`);
  console.log(`保存先: ${OUTPUT_PATH}`);
  console.log(`ルアー数: ${output.totalLures}`);
  console.log(`クエリ数: ${output.totalQueries}`);
  console.log(`サジェスト総数: ${output.totalSuggestions}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
