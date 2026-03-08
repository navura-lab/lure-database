// scripts/rewrite-descriptions.ts
// パイプライン後の説明文リライト一括スクリプト
// 使い方:
//   npx tsx scripts/rewrite-descriptions.ts                    # 全US英語説明文をリライト
//   npx tsx scripts/rewrite-descriptions.ts --maker strike-king # 特定メーカーのみ
//   npx tsx scripts/rewrite-descriptions.ts --dry-run           # 対象確認のみ（書き込みなし）
//   npx tsx scripts/rewrite-descriptions.ts --check             # 英語残りチェックのみ

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 英語テキスト判定（ASCII比率70%以上）
function isEnglish(text: string): boolean {
  if (!text || text.length < 20) return false;
  let ascii = 0;
  for (const c of text) {
    if (c.charCodeAt(0) < 128) ascii++;
  }
  return ascii / text.length > 0.7;
}

// CLI引数パース
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const makerIdx = args.indexOf('--maker');
const targetMaker = makerIdx !== -1 ? args[makerIdx + 1] : null;

// US系メーカー（regions.tsで一元管理）
import { US_MAKERS as US_MAKERS_SET } from './lib/regions.js';
const US_MAKER_LIST = [...US_MAKERS_SET];
const makers = targetMaker ? [targetMaker] : US_MAKER_LIST;

async function main() {
  console.log('=== 説明文リライトチェック ===\n');

  // 1. 英語説明文の検出
  const allTargets: Array<{
    slug: string;
    name: string;
    manufacturer_slug: string;
    type: string;
    target_fish: string[];
    description: string;
  }> = [];

  for (const maker of makers) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, name, description, type, target_fish')
      .eq('manufacturer_slug', maker);

    if (error) {
      console.error(`❌ ${maker}: ${error.message}`);
      continue;
    }

    // slug単位で重複排除
    const unique = new Map<string, (typeof data)[0]>();
    for (const r of data || []) {
      if (!unique.has(r.slug)) unique.set(r.slug, r);
    }

    const engItems = [...unique.values()].filter((r) => isEnglish(r.description || ''));

    console.log(`${maker}: ${unique.size}商品中、英語のまま=${engItems.length}件`);
    for (const item of engItems) {
      allTargets.push({ ...item, manufacturer_slug: maker });
    }
  }

  console.log(`\n合計リライト対象: ${allTargets.length}件`);

  if (allTargets.length === 0) {
    console.log('✅ 英語説明文なし。リライト不要。');
    return;
  }

  if (checkOnly) {
    console.log('\n--check モード: 対象一覧');
    for (const item of allTargets) {
      console.log(`  ${item.manufacturer_slug}/${item.slug}: ${item.description.substring(0, 50)}...`);
    }
    return;
  }

  if (dryRun) {
    console.log('\n--dry-run モード: 書き込みは行いません');
  }

  // 2. バッチ分割（10件ずつ）
  const batches: typeof allTargets[] = [];
  for (let i = 0; i < allTargets.length; i += 10) {
    batches.push(allTargets.slice(i, i + 10));
  }
  console.log(`\n${batches.length}バッチに分割`);

  // 3. バッチファイル書き出し
  for (let i = 0; i < batches.length; i++) {
    const path = `/tmp/rewrite-batch-${i + 1}.json`;
    writeFileSync(path, JSON.stringify(batches[i], null, 2));
    console.log(`  ${path}: ${batches[i].length}件`);
  }

  // 4. プロンプトテンプレート生成
  const promptTemplate = readFileSync(
    resolve(__dirname, 'prompts/rewrite-ja.md'),
    'utf-8',
  );

  // 5. 各バッチ用の指示ファイル生成
  for (let i = 0; i < batches.length; i++) {
    const prompt = promptTemplate
      .replace('{{INPUT_FILE}}', `/tmp/rewrite-batch-${i + 1}.json`)
      .replace('{{OUTPUT_FILE}}', `/tmp/rewrite-result-${i + 1}.json`);
    writeFileSync(`/tmp/rewrite-prompt-${i + 1}.md`, prompt);
  }

  console.log(`\n✅ 準備完了。以下をClaude Codeで実行:`);
  console.log('─'.repeat(50));
  console.log(`バッチ数: ${batches.length}`);
  console.log(`入力: /tmp/rewrite-batch-{1..${batches.length}}.json`);
  console.log(`出力: /tmp/rewrite-result-{1..${batches.length}}.json`);
  console.log(`プロンプト: /tmp/rewrite-prompt-{1..${batches.length}}.md`);
  console.log('─'.repeat(50));
  console.log('\nSonnetサブエージェントで並列実行後、以下で書き込み:');
  console.log(`  npx tsx scripts/rewrite-descriptions.ts --apply`);

  // --apply モード: 結果ファイルを検証してDB書き込み
  if (args.includes('--apply')) {
    await applyRewrites(batches.length);
  }
}

async function applyRewrites(batchCount: number) {
  console.log('\n=== リライト結果の適用 ===\n');

  const allResults: Array<{
    slug: string;
    name: string;
    manufacturer_slug: string;
    description: string;
  }> = [];

  // 結果ファイル読み込み
  for (let i = 1; i <= batchCount; i++) {
    const path = `/tmp/rewrite-result-${i}.json`;
    if (!existsSync(path)) {
      console.error(`❌ ${path} が見つかりません。リライト未完了？`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    allResults.push(...data);
  }

  console.log(`読み込み: ${allResults.length}件`);

  // 品質検証
  const shorts = allResults.filter((r) => r.description.length < 150);
  const longs = allResults.filter((r) => r.description.length > 250);
  const stillEng = allResults.filter((r) => isEnglish(r.description));

  if (shorts.length > 0) {
    console.error(`\n⚠️  150文字未満: ${shorts.length}件`);
    for (const s of shorts) {
      console.error(`  ${s.manufacturer_slug}/${s.slug}: ${s.description.length}文字`);
    }
  }
  if (longs.length > 0) {
    console.error(`\n⚠️  250文字超: ${longs.length}件`);
    for (const l of longs) {
      console.error(`  ${l.manufacturer_slug}/${l.slug}: ${l.description.length}文字`);
    }
  }
  if (stillEng.length > 0) {
    console.error(`\n❌ まだ英語のまま: ${stillEng.length}件`);
    for (const e of stillEng) {
      console.error(`  ${e.manufacturer_slug}/${e.slug}: ${e.description.substring(0, 50)}...`);
    }
    console.error('\n英語のままの説明文があります。再リライトしてください。');
    process.exit(1);
  }

  if (shorts.length > 0) {
    console.log('\n150文字未満がありますが続行しますか？（Ctrl+Cで中断）');
    // 自動続行（150に近い場合は許容）
  }

  if (dryRun) {
    console.log('\n--dry-run: DB書き込みはスキップ');
    return;
  }

  // DB書き込み
  console.log('\nSupabaseに書き込み中...');
  let success = 0;
  let errors = 0;

  for (const item of allResults) {
    const { error } = await sb
      .from('lures')
      .update({ description: item.description })
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug);

    if (error) {
      console.error(`❌ ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      errors++;
    } else {
      success++;
    }
  }

  console.log(`\n完了: ${success}成功, ${errors}エラー / ${allResults.length}件`);

  // バックアップ保存
  const date = new Date().toISOString().split('T')[0];
  const backupPath = resolve(__dirname, `_rewritten-all-${date}.json`);
  writeFileSync(backupPath, JSON.stringify(allResults, null, 2));
  console.log(`バックアップ: ${backupPath}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
