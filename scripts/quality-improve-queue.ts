#!/usr/bin/env npx tsx
/**
 * 品質改善キュー
 *
 * quality_scores テーブルから improve バンド（50-69）かつ description が
 * 短い/null/英語のみのページを抽出し、Claude Haiku で日本語description を
 * 自動生成して Supabase に書き戻す。
 *
 * 安全策:
 *   - 1日の上限: 50件（暴走防止）
 *   - dry-run必須: --dry-run で対象リスト表示のみ
 *   - 実行前にバックアップ: scripts/_quality-improve-backup-{date}.json
 *   - 既存descriptionが30字以上ある場合は触らない（保護）
 *
 * Usage:
 *   npx tsx scripts/quality-improve-queue.ts --dry-run         # 候補一覧表示
 *   npx tsx scripts/quality-improve-queue.ts --limit 10        # 10件改善
 *   npx tsx scripts/quality-improve-queue.ts --apply --limit 50 # 実書き込み
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'ops', 'db', 'agents.db');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'logs', 'quality');

const DRY_RUN = !process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit'));
const LIMIT = LIMIT_ARG ? parseInt(process.argv[process.argv.indexOf(LIMIT_ARG) + 1] || '10') : 10;
const MAX_DAILY = 50; // 安全上限

const TODAY = new Date().toISOString().slice(0, 10);

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [quality-improve] ${msg}`);
}

interface ImproveTarget {
  manufacturer_slug: string;
  slug: string;
  score: number;
  reasons: string;
}

async function fetchImproveTargets(): Promise<ImproveTarget[]> {
  const db = new DatabaseSync(DB_PATH);
  const stmt = db.prepare(`
    SELECT manufacturer_slug, slug, score, reasons
    FROM quality_scores
    WHERE date = ? AND band = 'improve'
      AND (s_description < 5 OR s_description IS NULL)
    ORDER BY score ASC
    LIMIT ?
  `);
  const rows = stmt.all(TODAY, Math.min(LIMIT, MAX_DAILY)) as ImproveTarget[];
  db.close();
  return rows;
}

async function main() {
  log(`=== Quality Improve Queue ===`);
  log(`DRY_RUN=${DRY_RUN} LIMIT=${LIMIT} MAX_DAILY=${MAX_DAILY}`);

  if (LIMIT > MAX_DAILY) {
    log(`⚠️  LIMIT(${LIMIT}) > MAX_DAILY(${MAX_DAILY}) → ${MAX_DAILY}件に制限`);
  }

  const targets = await fetchImproveTargets();
  log(`improve バンドかつ description不備: ${targets.length}件`);

  if (targets.length === 0) {
    log('対象なし。終了。');
    return;
  }

  log('\n=== 対象リスト ===');
  for (const t of targets.slice(0, 20)) {
    log(`  [${t.score}] ${t.manufacturer_slug}/${t.slug}`);
  }
  if (targets.length > 20) log(`  ...他 ${targets.length - 20} 件`);

  if (DRY_RUN) {
    log('\nDRY_RUN: 実書き込みはスキップ。--apply で実行できます。');
    log('注: Claude Haiku 呼び出しはまだ未実装。実装が完了したら --apply で実行可能になります。');
    return;
  }

  // ⚠️ TODO: ここに Claude Haiku 呼び出しを実装
  // 1. 各targetの現在の description, name, type, manufacturer, target_fish を Supabase から取得
  // 2. プロンプト構築（短く・自然な日本語、150-200字、ルアーの特徴を伝える）
  // 3. Claude Haiku API 呼び出し（並列5本程度）
  // 4. 結果を _quality-improve-backup-{date}.json に保存
  // 5. Supabase の lures テーブルの description を一括更新
  // 6. action_log に記録
  log('⚠️  Claude Haiku呼び出しは未実装。実装後に有効化してください。');
  log('   実装パス: scripts/quality-improve-queue.ts の "TODO" コメント部分');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
