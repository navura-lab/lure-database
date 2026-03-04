/**
 * DSTYLE非ルアー商品クリーンアップ
 *
 * アパレル、バッグ、小物等の非ルアー商品をSupabaseから削除する。
 * 2026-03-04
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// ─── 削除対象slug一覧 ───
const NON_LURE_SLUGS = [
  // --- アパレル (13) ---
  '2021-dstyle-fishing-club-hoodie',
  '2021-dstyle-fishing-club-ls-t-shirts',
  'cool-sun-gaiter-ver001',
  'cool-sun-mask-bass-camo-ver001',
  'dstyle-%e3%82%b9%e3%82%bf%e3%83%b3%e3%83%80%e3%83%bc%e3%83%89%e3%82%b9%e3%82%a6%e3%82%a7%e3%83%83%e3%83%88%e3%83%a1%e3%83%83%e3%82%b7%e3%83%a5%e3%82%ad%e3%83%a3%e3%83%83%e3%83%97-standard-sweat-mesh',
  'dstyle-%e3%82%b9%e3%82%bf%e3%83%b3%e3%83%80%e3%83%bc%e3%83%89%e3%83%a1%e3%83%83%e3%82%b7%e3%83%a5%e3%82%ad%e3%83%a3%e3%83%83%e3%83%97-standard-mesh-caps',
  'dstyle-box-logo-%e3%83%ad%e3%83%b3%e3%82%b0t%e3%82%b7%e3%83%a3%e3%83%84',
  'dstyle-flat-bill-snap-back-cap',
  'dstyle-leather-logo-low-cap-strap-back',
  'dstyle-logo-dry-t-shirts',
  'dstyle%e3%80%80%e3%83%95%e3%83%bc%e3%83%87%e3%83%83%e3%83%89%e3%83%8d%e3%83%83%e3%82%af%e3%82%a6%e3%82%a9%e3%83%bc%e3%83%9e%e3%83%bc',
  'rib-knit-beanie',
  'sweatmeshcapver003',

  // --- バッグ・ケース (12) ---
  'dstyle-backpack-20l-crosstrek',
  'dstyle-foldable-bakkan-ver001',
  'dstyle-multi-clear-pouch-l',
  'dstyle-multi-clear-pouch-m',
  'dstyle-multi-wallet',
  'dstyle-sling-tackle-bag-ver002',
  'dstyle-sling-tackle-pouch',
  'dstyle-system-messenger-bag-ver001',
  'dstyle-system-shoulder-bag-ver001',
  'dstyle%e3%80%80bakkan',
  'dstylepaddedcase',
  'neoprene-multi-pouch-s',

  // --- 小物・アクセサリー (7) ---
  'dstyle-carabiner-pin-on-reel',
  'dstyle-cutting-logo-sticker',
  'dstyle-dry-mesh-measure',
  'dstyle-major-carpet-decal',
  'dstyle-packable-pet-bottle-holder',
  'dstyle-rod-tip-protector',
  'dstyle-soft-cooler-6l-kuura',

  // --- スペアパーツ (1) ---
  'flex-roler-168%e7%94%a8-%e3%82%b9%e3%83%9a%e3%82%a2%e3%83%86%e3%83%bc%e3%83%ab',
];

async function main() {
  console.log(`=== DSTYLE 非ルアー商品クリーンアップ ===`);
  console.log(`削除対象: ${NON_LURE_SLUGS.length} シリーズ`);
  console.log('');

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('*** DRY RUN モード ***\n');
  }

  let totalDeleted = 0;

  for (const slug of NON_LURE_SLUGS) {
    // まず対象行数を確認
    const { count, error: countErr } = await sb
      .from('lures')
      .select('*', { count: 'exact', head: true })
      .eq('manufacturer_slug', 'dstyle')
      .eq('slug', slug);

    if (countErr) {
      console.error(`  ❌ ${slug}: count error - ${countErr.message}`);
      continue;
    }

    if (!count || count === 0) {
      console.log(`  ⏭️  ${slug}: 0行（既に削除済み）`);
      continue;
    }

    if (dryRun) {
      console.log(`  🔍 ${slug}: ${count}行 → 削除予定`);
      totalDeleted += count;
      continue;
    }

    // 削除実行
    const { error: delErr } = await sb
      .from('lures')
      .delete()
      .eq('manufacturer_slug', 'dstyle')
      .eq('slug', slug);

    if (delErr) {
      console.error(`  ❌ ${slug}: delete error - ${delErr.message}`);
    } else {
      console.log(`  ✅ ${slug}: ${count}行削除`);
      totalDeleted += count;
    }
  }

  console.log('');
  console.log(`合計: ${totalDeleted}行${dryRun ? '削除予定' : '削除完了'}`);

  // 削除後の件数確認
  if (!dryRun) {
    const { count: remaining } = await sb
      .from('lures')
      .select('*', { count: 'exact', head: true })
      .eq('manufacturer_slug', 'dstyle');
    console.log(`DSTYLE残存行数: ${remaining}`);
  }
}

main().catch(console.error);
