/**
 * DSTYLE タイプ誤分類修正
 * ワームに分類されているハードベイトを正しいタイプに変更する
 * 2026-03-04
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const TYPE_FIXES: Array<{ slugs: string[]; newType: string; reason: string }> = [
  {
    slugs: ['dblow-shad-58sp', 'dblow-shad-62sp'],
    newType: 'ミノー',
    reason: 'シャッドプラグ（ハードベイト）',
  },
  {
    slugs: ['ichirin-55f-tsubomi', 'ichirin-70f'],
    newType: 'ミノー',
    reason: 'フローティングプラグ（ハードベイト）',
  },
  {
    slugs: ['tn-typed-ss', 'tn50-typed-rs', 'tn50-typed-ss', 'tn60-typed-rs'],
    newType: 'バイブレーション',
    reason: 'リップレスクランクベイト（TN TypeD）',
  },
  {
    slugs: ['flex-roler-168f-inspired-by-virola'],
    newType: 'スイムベイト',
    reason: 'ジョイントスイムベイト',
  },
];

async function main() {
  console.log('=== DSTYLE タイプ誤分類修正 ===\n');

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('*** DRY RUN ***\n');

  let totalUpdated = 0;

  for (const fix of TYPE_FIXES) {
    for (const slug of fix.slugs) {
      // 現在のtype確認
      const { data: current, error: selErr } = await sb
        .from('lures')
        .select('type')
        .eq('manufacturer_slug', 'dstyle')
        .eq('slug', slug)
        .limit(1);

      if (selErr) {
        console.error(`  ❌ ${slug}: select error - ${selErr.message}`);
        continue;
      }
      if (!current || current.length === 0) {
        console.log(`  ⏭️  ${slug}: 存在しない`);
        continue;
      }

      const oldType = current[0].type;
      if (oldType === fix.newType) {
        console.log(`  ⏭️  ${slug}: 既に ${fix.newType}`);
        continue;
      }

      if (dryRun) {
        console.log(`  🔍 ${slug}: ${oldType} → ${fix.newType} (${fix.reason})`);
        totalUpdated++;
        continue;
      }

      const { error: updErr, count } = await sb
        .from('lures')
        .update({ type: fix.newType })
        .eq('manufacturer_slug', 'dstyle')
        .eq('slug', slug);

      if (updErr) {
        console.error(`  ❌ ${slug}: update error - ${updErr.message}`);
      } else {
        console.log(`  ✅ ${slug}: ${oldType} → ${fix.newType} (${fix.reason})`);
        totalUpdated++;
      }
    }
  }

  console.log(`\n合計: ${totalUpdated}件${dryRun ? '更新予定' : '更新完了'}`);
}

main().catch(console.error);
