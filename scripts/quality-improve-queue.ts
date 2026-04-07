#!/usr/bin/env npx tsx
/**
 * 品質改善キュー
 *
 * quality_scores テーブルから improve バンド（50-69）かつ description が
 * 短い/null/英語のみのページを抽出し、Claude Haiku で日本語description を
 * 自動生成して Supabase に書き戻す。
 *
 * 安全策:
 *   - 1日の上限: MAX_DAILY 件（暴走防止、デフォルト50件）
 *   - dry-run必須: --apply フラグなしは候補表示のみ
 *   - バックアップ: logs/quality/improve-backup-{date}.json に元データ保存
 *   - 既存descriptionが80字以上ある場合はスキップ（保護）
 *   - action_log に記録
 *
 * Usage:
 *   npx tsx scripts/quality-improve-queue.ts                    # dry-run、20件まで
 *   npx tsx scripts/quality-improve-queue.ts --limit 50         # dry-run、50件まで
 *   npx tsx scripts/quality-improve-queue.ts --apply --limit 10 # 実書き込み10件
 *   npx tsx scripts/quality-improve-queue.ts --apply --limit 50 # 実書き込み50件（上限）
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'ops', 'db', 'agents.db');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'logs', 'quality');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const LIMIT_ARG_INDEX = process.argv.findIndex(a => a === '--limit');
const LIMIT = LIMIT_ARG_INDEX >= 0 ? parseInt(process.argv[LIMIT_ARG_INDEX + 1] || '20') : 20;
const MAX_DAILY = 50; // 安全上限

const TODAY = new Date().toISOString().slice(0, 10);
const EFFECTIVE_LIMIT = Math.min(LIMIT, MAX_DAILY);

const HAIKU_MODEL = 'claude-haiku-4-5';
const PARALLEL = 5; // 並列リクエスト数

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [quality-improve] ${msg}`);
}

interface ImproveTarget {
  manufacturer_slug: string;
  slug: string;
  score: number;
  reasons: string;
  // 後で埋まる
  manufacturer?: string;
  name?: string;
  type?: string | null;
  target_fish?: string[] | null;
  current_description?: string | null;
  generated_description?: string;
  status?: 'success' | 'skipped' | 'failed';
  error?: string;
}

async function fetchImproveTargets(): Promise<ImproveTarget[]> {
  const db = new DatabaseSync(DB_PATH);
  const stmt = db.prepare(`
    SELECT manufacturer_slug, slug, score, reasons
    FROM quality_scores
    WHERE date = ? AND band = 'improve'
      AND s_description < 5
    ORDER BY score ASC
    LIMIT ?
  `);
  const rows = stmt.all(TODAY, EFFECTIVE_LIMIT) as ImproveTarget[];
  db.close();
  return rows;
}

async function enrichWithSupabaseData(supabase: any, targets: ImproveTarget[]): Promise<void> {
  // 各ターゲットの DB データを取得（既存description, name, etc.）
  for (const t of targets) {
    const { data } = await supabase
      .from('lures')
      .select('manufacturer, name, type, target_fish, description')
      .eq('manufacturer_slug', t.manufacturer_slug)
      .eq('slug', t.slug)
      .limit(1);
    if (data && data[0]) {
      t.manufacturer = data[0].manufacturer;
      t.name = data[0].name;
      t.type = data[0].type;
      t.target_fish = data[0].target_fish;
      t.current_description = data[0].description;
    }
  }
}

function buildPrompt(t: ImproveTarget): string {
  const fish = (t.target_fish || []).join('・') || '指定なし';
  const currentDesc = t.current_description?.trim() || '(なし)';
  return `釣具メーカー「${t.manufacturer}」のルアー「${t.name}」の商品説明文を150〜200字で書いてください。

【既存情報】
- 商品名: ${t.name}
- メーカー: ${t.manufacturer}
- タイプ: ${t.type || '不明'}
- 対象魚: ${fish}
- 現在の説明文: ${currentDesc}

【書く際のルール】
- 150〜200字（必須、超過厳禁）
- 釣り人目線、自然な日本語
- 具体的なルアー特徴と使い方を簡潔に伝える
- 事実ベース、誇張表現は使わない
- 禁止ワード: 爆釣、激アツ、マスト、ヤバい、間違いなし、神ルアー、最強

【出力形式】
説明文のみを出力。前置き・後置き・装飾なし。`;
}

async function generateDescription(client: Anthropic, t: ImproveTarget): Promise<void> {
  if (!t.name) {
    t.status = 'skipped';
    t.error = 'no name in supabase';
    return;
  }
  if (t.current_description && t.current_description.length >= 80) {
    t.status = 'skipped';
    t.error = `existing description ${t.current_description.length} chars (>= 80)`;
    return;
  }
  try {
    const res = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: buildPrompt(t) }],
    });
    const text = res.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
      .trim();
    if (!text || text.length < 80) {
      t.status = 'failed';
      t.error = `generated too short: ${text.length}字`;
      return;
    }
    if (text.length > 250) {
      t.status = 'failed';
      t.error = `generated too long: ${text.length}字`;
      return;
    }
    t.generated_description = text;
    t.status = 'success';
  } catch (e: any) {
    t.status = 'failed';
    t.error = e.message || String(e);
  }
}

async function processInParallel(client: Anthropic, targets: ImproveTarget[]): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < targets.length) {
      const idx = i++;
      const t = targets[idx];
      log(`[${idx + 1}/${targets.length}] generating for ${t.manufacturer_slug}/${t.slug}`);
      await generateDescription(client, t);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
}

async function applyToSupabase(supabase: any, targets: ImproveTarget[]): Promise<number> {
  let updated = 0;
  for (const t of targets) {
    if (t.status !== 'success' || !t.generated_description) continue;
    // lures テーブルの全行（カラー×ウェイト）を一括更新
    const { error } = await supabase
      .from('lures')
      .update({ description: t.generated_description })
      .eq('manufacturer_slug', t.manufacturer_slug)
      .eq('slug', t.slug);
    if (error) {
      log(`⚠️  Update failed for ${t.manufacturer_slug}/${t.slug}: ${error.message}`);
      t.status = 'failed';
      t.error = error.message;
    } else {
      updated++;
    }
  }
  return updated;
}

function recordActionLog(updated: number): void {
  if (updated === 0) return;
  const db = new DatabaseSync(DB_PATH);
  const stmt = db.prepare(`
    INSERT INTO action_log (date, action_type, description, expected_impact, verdict)
    VALUES (?, 'fix', ?, ?, 'pending')
  `);
  stmt.run(
    TODAY,
    `品質改善: description自動補完 ${updated}件 (Haiku)`,
    'improveバンドのページ品質スコア向上',
  );
  db.close();
}

async function main() {
  log(`=== Quality Improve Queue ===`);
  log(`APPLY=${APPLY} LIMIT=${LIMIT} EFFECTIVE_LIMIT=${EFFECTIVE_LIMIT} MAX_DAILY=${MAX_DAILY}`);

  if (LIMIT > MAX_DAILY) {
    log(`⚠️  LIMIT(${LIMIT}) > MAX_DAILY(${MAX_DAILY}) → ${MAX_DAILY}件に制限`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    log('❌ ANTHROPIC_API_KEY が .env にありません');
    process.exit(1);
  }
  const supabase = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const targets = await fetchImproveTargets();
  log(`improve バンドかつ description不備: ${targets.length}件`);
  if (targets.length === 0) {
    log('対象なし。終了。');
    return;
  }

  log('Supabaseから既存データを取得...');
  await enrichWithSupabaseData(supabase, targets);

  log('\n=== 対象リスト（先頭10件） ===');
  for (const t of targets.slice(0, 10)) {
    log(`  [${t.score}] ${t.manufacturer_slug}/${t.slug} | ${t.name?.slice(0, 30) || '(no name)'} | desc=${t.current_description?.length || 0}字`);
  }
  if (targets.length > 10) log(`  ...他 ${targets.length - 10} 件`);

  if (DRY_RUN) {
    log('\nDRY_RUN: --apply を付けると Haiku 呼び出し+書き戻しを実行します');
    return;
  }

  // バックアップ
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `improve-backup-${TODAY}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2));
  log(`Backup saved: ${backupPath}`);

  log(`\n=== Haiku 生成開始（並列${PARALLEL}本）===`);
  const startTime = Date.now();
  await processInParallel(claude, targets);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`生成完了: ${elapsed}秒`);

  // 結果集計
  const success = targets.filter(t => t.status === 'success').length;
  const skipped = targets.filter(t => t.status === 'skipped').length;
  const failed = targets.filter(t => t.status === 'failed').length;
  log(`成功: ${success}, スキップ: ${skipped}, 失敗: ${failed}`);

  // 失敗詳細
  if (failed > 0) {
    log('失敗内訳:');
    for (const t of targets.filter(t => t.status === 'failed')) {
      log(`  ${t.manufacturer_slug}/${t.slug}: ${t.error}`);
    }
  }

  // Supabase書き戻し
  log('\n=== Supabase書き戻し ===');
  const updated = await applyToSupabase(supabase, targets);
  log(`更新済み: ${updated}件`);

  // バックアップ更新（生成結果を含む）
  fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2));

  // action_log記録
  recordActionLog(updated);

  log(`\n=== 完了 ===`);
  log(`次回 quality-score.ts 実行で再評価される（改善後はokバンドへ昇格）`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
