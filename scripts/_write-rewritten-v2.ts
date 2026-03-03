/**
 * リライト結果をSupabaseに書き戻すスクリプト v2
 * /tmp/rewritten-agent{1-7}.json を読み込み、slug単位でdescriptionを更新
 *
 * Usage:
 *   npx tsx scripts/_write-rewritten-v2.ts --dry-run   # 確認のみ
 *   npx tsx scripts/_write-rewritten-v2.ts              # 実行
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const isDryRun = process.argv.includes('--dry-run');
const pattern = process.argv.find(a => a.startsWith('--pattern='))?.split('=')[1] || 'rewritten-agent';

interface RewriteResult {
  slug: string;
  manufacturer_slug?: string;
  description: string;
}

async function main() {
  // エージェント出力ファイルを読み込み
  const allResults: RewriteResult[] = [];

  for (let i = 1; i <= 20; i++) {
    const path = `/tmp/${pattern}${i}.json`;
    if (!existsSync(path)) continue;

    try {
      const data: RewriteResult[] = JSON.parse(readFileSync(path, 'utf-8'));
      allResults.push(...data);
      console.log(`✅ ${path}: ${data.length} items`);
    } catch (err) {
      console.error(`❌ ${path}: parse error - ${err}`);
    }
  }

  if (allResults.length === 0) {
    console.log('No results found. Check that agent output files exist.');
    return;
  }

  console.log(`\nTotal: ${allResults.length} items`);

  // 文字数チェック
  let tooShort = 0, tooLong = 0, good = 0;
  for (const r of allResults) {
    if (!r.description || r.description.length < 80) {
      tooShort++;
      console.warn(`  ⚠️ Too short: ${r.slug} (${r.description?.length ?? 0} chars)`);
    } else if (r.description.length > 300) {
      tooLong++;
      console.warn(`  ⚠️ Too long: ${r.slug} (${r.description.length} chars)`);
    } else {
      good++;
    }
  }

  console.log(`\nChar count check: ✅ ${good} good, ⚠️ ${tooShort} too short, ⚠️ ${tooLong} too long`);

  // 重複チェック
  const slugCounts = new Map<string, number>();
  for (const r of allResults) {
    slugCounts.set(r.slug, (slugCounts.get(r.slug) || 0) + 1);
  }
  const dupes = [...slugCounts.entries()].filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    console.warn(`\n⚠️ ${dupes.length} duplicate slugs (using last occurrence):`);
    for (const [slug, count] of dupes) {
      console.warn(`  ${slug}: ${count} entries`);
    }
  }

  // 重複排除（最後のものを採用）
  const deduped = new Map<string, RewriteResult>();
  for (const r of allResults) {
    deduped.set(r.slug, r);
  }

  const items = [...deduped.values()];
  console.log(`\nUnique items to update: ${items.length}`);

  // バックアップ保存
  const backupPath = `/Users/user/ウェブサイト/lure-database/scripts/_rewritten-all-${new Date().toISOString().slice(0,10)}.json`;
  writeFileSync(backupPath, JSON.stringify(items, null, 2));
  console.log(`Backup saved: ${backupPath}`);

  if (isDryRun) {
    console.log('\n🔍 DRY RUN — no changes written to Supabase');
    // サンプル表示
    console.log('\nSample rewrites:');
    for (const r of items.slice(0, 5)) {
      console.log(`  ${r.slug}: "${r.description.substring(0, 80)}..." (${r.description.length} chars)`);
    }
    return;
  }

  // Supabaseに書き戻し
  let updated = 0;
  let errors = 0;
  const errorList: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const { slug, description } = items[i];

    try {
      const { error } = await sb
        .from('lures')
        .update({ description })
        .eq('slug', slug);

      if (error) throw new Error(error.message);

      updated++;
      if ((i + 1) % 100 === 0) {
        console.log(`  Progress: ${i + 1}/${items.length} (${updated} updated, ${errors} errors)`);
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
