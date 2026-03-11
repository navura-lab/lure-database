import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// 未分類38件の手動判定
const MANUAL_DELETE = [
  { manufacturer_slug: '6th-sense', slug: 'bluegill-and-sunfish-hook', reason: 'フック' },
  { manufacturer_slug: 'berkley-us', slug: 'fusion19-med-shank-ewg-treble', reason: 'トレブルフック' },
  { manufacturer_slug: 'berkley-us', slug: 'prospec-chrome', reason: '釣り糸' },
  { manufacturer_slug: 'berkley-us', slug: 'trout-dough-molding-multipack', reason: 'エサ（ドウ）' },
  { manufacturer_slug: 'berkley-us', slug: 'aluminum-fish-ruler', reason: 'フィッシュルーラー' },
  { manufacturer_slug: 'berkley-us', slug: 'fusion19-weedless-wide-gap', reason: 'フック' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-x-mtn-dew-polo', reason: 'アパレル' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-3700-casket-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'gold-series-weighted-dart-hook', reason: 'フック' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-weight-stops', reason: 'ウェイトストッパー' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-3600-casket-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-x-bass-mafia-3700-coffin-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-x-bass-mafia-3600-coffin-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'tungsten-flippin-weights', reason: 'シンカー' },
  { manufacturer_slug: 'googan-baits', slug: 'weighted-dart-hook', reason: 'フック' },
  { manufacturer_slug: 'googan-baits', slug: 'aqua-bait-hydrilla-polo', reason: 'アパレル' },
  { manufacturer_slug: 'googan-baits', slug: 'bass-mafia-coffin-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-3600-casket-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-groove-belt', reason: 'ベルト' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-x-bass-mafia-1800-coffin-2-0', reason: 'タックルボックス' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-x-mtn-dew-32-oz-stainless-water-bottle', reason: 'ウォーターボトル' },
  { manufacturer_slug: 'googan-baits', slug: 'tungsten-putty', reason: 'タングステンパテ' },
  { manufacturer_slug: 'googan-baits', slug: 'medium-googan-squad-tackle-toter', reason: 'タックルバッグ' },
  { manufacturer_slug: 'googan-baits', slug: 'surf-crappie-overload-polo', reason: 'アパレル' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-squad-7-fillet-knife', reason: 'フィレナイフ' },
  { manufacturer_slug: 'googan-baits', slug: 'weighted-saucy-hook', reason: 'フック' },
  { manufacturer_slug: 'lunker-city', slug: '3d-fish-eyes-bulk', reason: '交換用アイ' },
  { manufacturer_slug: 'lunker-city', slug: 'standard-offset-hooks', reason: 'フック' },
];

const MANUAL_RECLASSIFY = [
  { manufacturer_slug: 'berkley-us', slug: 'finisher', type: 'ワーム', target_fish: ['ブラックバス'] },
  { manufacturer_slug: 'berkley-us', slug: 'spy', type: 'ワーム', target_fish: ['ブラックバス'] },
  { manufacturer_slug: 'berkley-us', slug: 'krej', type: 'クランクベイト', target_fish: ['ブラックバス'] },
  { manufacturer_slug: 'googan-baits', slug: 'clickbait', type: 'チャターベイト', target_fish: ['ブラックバス'] },
  { manufacturer_slug: 'googan-baits', slug: 'saucy-slimmer', type: 'スイムベイト', target_fish: ['ブラックバス'] },
  { manufacturer_slug: 'livetarget', slug: 'sardine-twitchbait', type: 'ミノー', target_fish: ['シーバス', 'ヒラメ'] },
  { manufacturer_slug: 'livetarget', slug: 'yellow-perch-jointed-bait-deep-dive', type: 'クランクベイト', target_fish: ['ウォールアイ', 'ブラックバス'] },
  { manufacturer_slug: 'livetarget', slug: 'rainbow-smelt-banana-bait-deep-dive', type: 'クランクベイト', target_fish: ['ウォールアイ', 'トラウト'] },
  { manufacturer_slug: 'lunker-city', slug: '5-5-freaky-fish', type: 'ワーム', target_fish: ['ブラックバス'] },
  { manufacturer_slug: 'lunker-city', slug: '4-5-freaky-fish', type: 'ワーム', target_fish: ['ブラックバス'] },
];

async function main() {
  // Load auto-classified results
  const classified = JSON.parse(readFileSync('/tmp/classify-result.json', 'utf-8'));

  // Merge all deletes
  const allDeletes = [
    ...classified.toDelete.map((r: any) => ({ manufacturer_slug: r.manufacturer_slug, slug: r.slug })),
    ...MANUAL_DELETE.map(r => ({ manufacturer_slug: r.manufacturer_slug, slug: r.slug })),
  ];

  // Merge all reclassifications
  const allReclassify = [
    ...classified.toReclassify.map((r: any) => ({
      manufacturer_slug: r.manufacturer_slug,
      slug: r.slug,
      type: r.type,
      target_fish: r.target_fish,
    })),
    ...MANUAL_RECLASSIFY,
  ];

  console.log(`=== 実行計画 ===`);
  console.log(`削除: ${allDeletes.length}商品`);
  console.log(`再分類: ${allReclassify.length}商品`);

  // === PHASE 1: DELETE ===
  console.log(`\n=== Phase 1: 削除 ===`);
  let totalDeleted = 0;
  let deleteErrors = 0;

  // Process in batches of 20
  for (let i = 0; i < allDeletes.length; i += 20) {
    const batch = allDeletes.slice(i, i + 20);
    for (const item of batch) {
      const { error, count } = await sb.from('lures')
        .delete({ count: 'exact' })
        .eq('manufacturer_slug', item.manufacturer_slug)
        .eq('slug', item.slug);

      if (error) {
        console.error(`  ERROR: ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
        deleteErrors++;
      } else {
        totalDeleted += count || 0;
      }
    }
    process.stdout.write(`  削除進捗: ${Math.min(i + 20, allDeletes.length)}/${allDeletes.length} (${totalDeleted}行)\r`);
  }
  console.log(`\n  削除完了: ${allDeletes.length}商品, ${totalDeleted}行, エラー: ${deleteErrors}`);

  // === PHASE 2: RECLASSIFY ===
  console.log(`\n=== Phase 2: 再分類 ===`);
  let reclassified = 0;
  let reclassErrors = 0;

  for (const item of allReclassify) {
    const update: any = { type: item.type };
    if (item.target_fish) {
      update.target_fish = item.target_fish;
    }

    const { error, count } = await sb.from('lures')
      .update(update, { count: 'exact' })
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug);

    if (error) {
      console.error(`  ERROR: ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      reclassErrors++;
    } else {
      reclassified += count || 0;
    }
  }
  console.log(`  再分類完了: ${allReclassify.length}商品, ${reclassified}行更新, エラー: ${reclassErrors}`);

  // === SUMMARY ===
  console.log(`\n=== 最終サマリー ===`);
  console.log(`削除: ${allDeletes.length}商品, ${totalDeleted}行`);
  console.log(`再分類: ${allReclassify.length}商品, ${reclassified}行`);
  console.log(`エラー: 削除${deleteErrors} / 再分類${reclassErrors}`);

  // Save backup
  const backup = {
    executedAt: new Date().toISOString(),
    deleted: { products: allDeletes.length, rows: totalDeleted, errors: deleteErrors },
    reclassified: { products: allReclassify.length, rows: reclassified, errors: reclassErrors, items: allReclassify },
  };
  writeFileSync(`scripts/_cleanup-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2));
  console.log(`\nバックアップ: scripts/_cleanup-backup-${new Date().toISOString().slice(0,10)}.json`);
}

main();
