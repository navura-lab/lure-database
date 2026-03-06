import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync } from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface ReclassifiedItem {
  slug: string;
  manufacturer_slug: string;
  new_type: string;
  new_target_fish: string[];
  old_type: string;
  old_target_fish: string[];
  changed: boolean;
  reason?: string;
}

async function main() {
  // 全バッチ結果を読み込み
  const allResults: ReclassifiedItem[] = [];
  const batchFiles = [
    '/tmp/reclassified-0-4.json',
    '/tmp/reclassified-5-9.json',
    '/tmp/reclassified-10-14.json',
    '/tmp/reclassified-15-19.json',
    '/tmp/reclassified-20-24.json',
    '/tmp/reclassified-25-28.json',
  ];

  for (const file of batchFiles) {
    if (!existsSync(file)) {
      console.error(`❌ ファイル未発見: ${file}`);
      continue;
    }
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    allResults.push(...data);
    console.log(`✅ ${file}: ${data.length}件`);
  }

  console.log(`\n合計: ${allResults.length}件`);

  // 変更あり・削除対象を分類
  const toUpdate = allResults.filter(r => r.changed && r.new_type !== 'DELETE');
  const toDelete = allResults.filter(r => r.new_type === 'DELETE');
  const unchanged = allResults.filter(r => !r.changed);

  console.log(`変更あり: ${toUpdate.length}件`);
  console.log(`削除対象: ${toDelete.length}件`);
  console.log(`変更なし: ${unchanged.length}件`);

  // バックアップ保存
  const backupPath = `scripts/_reclassified-all-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(backupPath, JSON.stringify(allResults, null, 2));
  console.log(`\nバックアップ: ${backupPath}`);

  // --- DRY RUN MODE ---
  if (process.argv.includes('--dry-run')) {
    console.log('\n=== DRY RUN ===');
    console.log('\n--- 変更一覧 ---');
    for (const r of toUpdate) {
      console.log(`${r.manufacturer_slug}/${r.slug}: ${r.old_type}→${r.new_type}, [${r.old_target_fish}]→[${r.new_target_fish}] | ${r.reason}`);
    }
    console.log('\n--- 削除対象 ---');
    for (const r of toDelete) {
      console.log(`${r.manufacturer_slug}/${r.slug}: ${r.reason}`);
    }
    return;
  }

  // --- 実行モード ---
  console.log('\n=== 書き込み開始 ===');

  // 1. type/target_fish の更新
  let updateSuccess = 0;
  let updateFailed = 0;
  for (const r of toUpdate) {
    const { error } = await sb.from('lures')
      .update({
        type: r.new_type,
        target_fish: r.new_target_fish,
      })
      .eq('slug', r.slug)
      .eq('manufacturer_slug', r.manufacturer_slug);

    if (error) {
      console.error(`❌ ${r.manufacturer_slug}/${r.slug}: ${error.message}`);
      updateFailed++;
    } else {
      updateSuccess++;
    }
  }
  console.log(`\n更新完了: ${updateSuccess}件成功, ${updateFailed}件失敗`);

  // 2. 非ルアー商品の削除
  if (toDelete.length > 0) {
    console.log('\n--- 非ルアー商品を削除中 ---');
    let deleteSuccess = 0;
    let deleteFailed = 0;
    for (const r of toDelete) {
      const { error } = await sb.from('lures')
        .delete()
        .eq('slug', r.slug)
        .eq('manufacturer_slug', r.manufacturer_slug);

      if (error) {
        console.error(`❌ DELETE ${r.manufacturer_slug}/${r.slug}: ${error.message}`);
        deleteFailed++;
      } else {
        deleteSuccess++;
        console.log(`🗑️  ${r.manufacturer_slug}/${r.slug} (${r.reason})`);
      }
    }
    console.log(`削除完了: ${deleteSuccess}件成功, ${deleteFailed}件失敗`);
  }

  console.log('\n=== 完了 ===');
}

main();
