/**
 * リライト結果をSupabaseに書き戻すスクリプト
 * /tmp/rewrite-results/batch-*.json を読み込み、slug単位でdescriptionを更新
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RewriteResult {
  slug: string;
  description: string;
}

async function main() {
  const resultsDir = '/tmp/rewrite-results';
  const files = readdirSync(resultsDir)
    .filter(f => f.startsWith('batch-') && f.endsWith('.json'))
    .sort();

  console.log(`Found ${files.length} result files`);

  // 全結果を統合
  const allResults: RewriteResult[] = [];
  for (const file of files) {
    const data: RewriteResult[] = JSON.parse(readFileSync(`${resultsDir}/${file}`, 'utf-8'));
    allResults.push(...data);
    console.log(`  ${file}: ${data.length} items`);
  }

  console.log(`\nTotal: ${allResults.length} items to update`);

  // 文字数チェック
  const outOfRange = allResults.filter(r => r.description.length < 100 || r.description.length > 300);
  if (outOfRange.length > 0) {
    console.warn(`\n⚠️ ${outOfRange.length} items outside 100-300 char range:`);
    for (const r of outOfRange) {
      console.warn(`  ${r.slug}: ${r.description.length} chars`);
    }
  }

  // バックアップ保存
  const backupDir = '/Users/user/ウェブサイト/lure-database/scripts';
  const backupPath = `${backupDir}/_rewritten-all-${new Date().toISOString().slice(0,10)}.json`;
  writeFileSync(backupPath, JSON.stringify(allResults, null, 2));
  console.log(`\nBackup saved: ${backupPath}`);

  // Supabaseに書き戻し
  let updated = 0;
  let errors = 0;
  const errorList: string[] = [];

  for (let i = 0; i < allResults.length; i++) {
    const { slug, description } = allResults[i];

    try {
      const { error, count } = await sb
        .from('lures')
        .update({ description })
        .eq('slug', slug);

      if (error) {
        throw new Error(error.message);
      }

      updated++;
      if ((i + 1) % 100 === 0) {
        console.log(`  Progress: ${i + 1}/${allResults.length} (${updated} updated, ${errors} errors)`);
      }
    } catch (err) {
      errors++;
      const msg = `${slug}: ${err instanceof Error ? err.message : String(err)}`;
      errorList.push(msg);
      console.error(`  ERROR: ${msg}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Update complete`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Errors: ${errors}`);
  console.log(`========================================`);

  if (errorList.length > 0) {
    console.log(`\nError details:`);
    for (const e of errorList) {
      console.log(`  ${e}`);
    }
  }
}

main().catch(console.error);
