import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const allResults: Array<{
    slug: string;
    name: string;
    manufacturer_slug: string;
    description: string;
  }> = [];

  // 既存の結果ファイルを全て読み込み
  for (let i = 1; i <= 20; i++) {
    const path = `/tmp/rewrite-result-${i}.json`;
    if (!existsSync(path)) break;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    allResults.push(...data);
    console.log(`📖 ${path}: ${data.length}件`);
  }

  console.log(`\n合計: ${allResults.length}件`);

  // 品質検証
  const shorts = allResults.filter(r => r.description.length < 130);
  const longs = allResults.filter(r => r.description.length > 260);

  if (shorts.length > 0) {
    console.log(`\n⚠️ 130文字未満: ${shorts.length}件`);
    shorts.forEach(s => console.log(`  ${s.manufacturer_slug}/${s.slug}: ${s.description.length}文字`));
  }
  if (longs.length > 0) {
    console.log(`\n⚠️ 260文字超: ${longs.length}件`);
    longs.forEach(l => console.log(`  ${l.manufacturer_slug}/${l.slug}: ${l.description.length}文字`));
  }

  // DB書き込み
  console.log('\nSupabaseに書き込み中...');
  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of allResults) {
    const { data, error } = await sb
      .from('lures')
      .update({ description: item.description })
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug)
      .select('id');

    if (error) {
      console.error(`❌ ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      errors++;
    } else if (!data || data.length === 0) {
      // DBにない（削除済み）→スキップ
      skipped++;
    } else {
      success++;
    }
  }

  console.log(`\n✅ 書き込み成功: ${success}件`);
  if (skipped > 0) console.log(`⏭️ スキップ（DB不在）: ${skipped}件`);
  if (errors > 0) console.log(`❌ エラー: ${errors}件`);

  // バックアップ
  const backupPath = `scripts/_rewritten-batch1-11-${new Date().toISOString().split('T')[0]}.json`;
  const { writeFileSync } = await import('fs');
  writeFileSync(backupPath, JSON.stringify(allResults, null, 2));
  console.log(`\n💾 バックアップ: ${backupPath}`);
}

main();
