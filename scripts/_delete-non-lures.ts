/**
 * 非ルアー製品をDBから削除する
 * 2026-03-22: ユーザー目視 + 機械検出で確認済みの19件
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const NON_LURES = [
  // dreemup ロッド 13件
  { maker: 'dreemup', slug: 'dreem-con-three-62l', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-81sf', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-80mh', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-56ul', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-810h-ra', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-96hh', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-88h', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-710mh-ra', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'dreem-con-three-72l', reason: 'ロッド' },
  { maker: 'dreemup', slug: '86sf-ra-keyaki', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'oceanic-times-s72m', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'oceanic-times-76h', reason: 'ロッド' },
  { maker: 'dreemup', slug: 'oceanic-times-b74h-solid', reason: 'ロッド' },
  // dranckrazy ロッド 3件
  { maker: 'dranckrazy', slug: 'infinity-black-unchain', reason: 'ロッド' },
  { maker: 'dranckrazy', slug: 'infinity-black-cutlass', reason: 'ロッド' },
  { maker: 'dranckrazy', slug: 'infinity-black-flicker', reason: 'ロッド' },
  // itocraft 非ルアー 2件
  { maker: 'itocraft', slug: 'wd-shoes', reason: 'ウェーディングシューズ' },
  { maker: 'itocraft', slug: 'goods', reason: 'リールカスタムパーツ' },
  // valleyhill ライン 1件
  { maker: 'valleyhill', slug: 'headhunter-srv', reason: 'PEライン' },
];

// shimano カラー行の非ルアー混入（行単位削除）
const SHIMANO_BAD_COLORS = [
  'ソアレ BB', 'ソアレ XR', 'サイトレーザー EX エステル 240m',
  // 'スケールブースト' は正規のカラー名。削除対象外
  'オシアジガー MX4 PE', 'グラップラー 8 PE', 'オシア 8 PE',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`=== 非ルアー削除 ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // 1. slug単位の削除（19件）
  let deletedRows = 0;
  for (const item of NON_LURES) {
    const { data: existing } = await sb
      .from('lures')
      .select('id')
      .eq('manufacturer_slug', item.maker)
      .eq('slug', item.slug);

    const count = existing?.length || 0;
    console.log(`${item.maker}/${item.slug}: ${count}行 (${item.reason})`);

    if (count > 0 && !dryRun) {
      const { error } = await sb
        .from('lures')
        .delete()
        .eq('manufacturer_slug', item.maker)
        .eq('slug', item.slug);

      if (error) {
        console.error(`  ❌ 削除失敗: ${error.message}`);
      } else {
        console.log(`  ✅ ${count}行 削除`);
        deletedRows += count;
      }
    }
  }

  // 2. shimano カラー行単位の削除
  console.log('\n--- shimano カラー行削除 ---');
  for (const colorName of SHIMANO_BAD_COLORS) {
    const { data: existing } = await sb
      .from('lures')
      .select('id, slug, color_name')
      .eq('manufacturer_slug', 'shimano')
      .eq('color_name', colorName);

    const count = existing?.length || 0;
    if (count > 0) {
      console.log(`shimano / color="${colorName}": ${count}行`);
      if (!dryRun) {
        const { error } = await sb
          .from('lures')
          .delete()
          .eq('manufacturer_slug', 'shimano')
          .eq('color_name', colorName);

        if (error) {
          console.error(`  ❌ 削除失敗: ${error.message}`);
        } else {
          console.log(`  ✅ ${count}行 削除`);
          deletedRows += count;
        }
      }
    }
  }

  console.log(`\n合計削除: ${deletedRows}行`);
  if (dryRun) console.log('(DRY RUN — 実際には削除していません。--dry-run を外して再実行してください)');
}

main().catch(console.error);
