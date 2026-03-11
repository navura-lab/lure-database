import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ===== SPRO: 削除対象 =====
const SPRO_DELETE = [
  'wicked-weather-wear-heavy-duty-bib-gray', 'depth-control-8x',
  'ball-bearing-swivel-2-welded-rings', 'g-box-250-duo-side', 'spro-fillet-knife-7',
  '2026-catalogs', 'rat-30-replacement-tail',
  'ball-bearing-swivels-2-welded-rings-and-coast-lock-snap',
  'sb60-fin-and-tail-set-wicked-perch', 'spro-skip-gap-shaky-head-round',
  'wicked-weather-wear-glove-closed-finger-gray', 'rat-25-replacement-tail',
  'spro-plasma-lighter', 'g-box-3700-deep-utility-case', 'spro-silicone-stopper',
  'prime-snap-mini', 'ball-bearing-swivel-with-split-rings', 'spro-tbx-25m-3600-dark',
  'spro-fish-ruler-10-x-50', 'slow-pitch-assist-fluorocarbon',
  'marsh-wear-pullover-green-camo', 'spro-dura-slick-finish-power-swivels',
  'cast-control-8x', 'spro-sun-visor-blue',
  'promo-goods-spro-boat-carpet-decal-black-and-green-20',
  'g-box-3200-deep-utility-case', 'terminal-box', 'g-box-3700-utility-case',
  'power-swivels-combo', 'spro-mustang-inflatable-pfd',
  'power-ball-bearing-with-coast-lock-2-welded-rings', 'spro-logo-hoodie-gray',
  'split-snap', 'prime-snap-hd', 'power-split-rings-black', 'spro-side-cutter-6',
  'spro-sun-hoodie-light-blue', 'spro-dura-tuff-aluminum-led-flashlight',
  'mesh-bait-pouch', 'spro-sun-hoodie-sea-green', 'three-way-swivel',
  'slow-pitch-assist-mono', 'g-box-double-slit-foam-case-3600',
  'wicked-weather-wear-light-jacket-gray', 'wicked-weather-wear-glove-split-finger-camo',
  'taru-swivel', 'spro-tbx-80l-3700d-dark', 'ultra-split-rings',
  'spro-beanie-black-with-patch', 'duo-lock-snaps-black',
];

// ===== SPRO: 再分類対象 =====
const SPRO_RECLASSIFY: Array<{slug: string; type: string; target_fish?: string[]}> = [
  { slug: 'cannon-ball-super-glow', type: 'メタルジグ' },
  { slug: 'carbon-blade-tg-1-2-oz', type: 'スピナーベイト' },
  { slug: 'little-john-md-50', type: 'クランクベイト' },
  { slug: 'power-drop-shot', type: 'ワーム' },
  { slug: 'fat-papa-walker-130', type: 'トップウォーター' },
  { slug: 'cj-flip', type: 'ラバージグ' },
  { slug: 'shimmy-flat-iwashi', type: 'メタルジグ' },
  { slug: 'shimmy-flat-bloody-mary', type: 'メタルジグ' },
  { slug: 'shimmy-flat-crushed-ice-pink', type: 'メタルジグ' },
  { slug: 'cannon-ball-peach-glow', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-crushed-ice-glow', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-180g-unrigged', type: 'メタルジグ' },
  { slug: 'shimmy-flat-tequila-sunrise-glow', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-crushed-ice', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-crushed-ice-pink', type: 'メタルジグ' },
  { slug: 'shimmy-flat-tequila-sunrise', type: 'メタルジグ' },
  { slug: 'pesce-100g', type: 'メタルジグ' },
  { slug: 'spin-john-80', type: 'スピンテールジグ' },
  { slug: 'shimmy-flat-tequila-sunrise-glow-unrigged', type: 'メタルジグ' },
  { slug: 'cannon-ball-tequila-sunrise', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-kt-special-unrigged', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-glow-squid-unrigged', type: 'メタルジグ' },
  { slug: 'shimmy-semi-long-bloody-mary', type: 'メタルジグ' },
  { slug: 'madeye-diver-85', type: 'クランクベイト' },
  { slug: 'shimmy-semi-long-iwashi', type: 'メタルジグ' },
  { slug: 'spro-25th-anniversary-falcon-140', type: 'クランクベイト' },
  { slug: 'little-john-md-type-r-50', type: 'クランクベイト' },
];

// ===== LUNKER CITY =====
const LC_DELETE = ['tungsten-flipping-weights', 'vgb-dropshot-nose-rig-hook', 'in-pursuit-of-giant-bass'];
const LC_RECLASSIFY: Array<{slug: string; type: string}> = [
  { slug: '4-5-shaker', type: 'ワーム' },
  { slug: '3-ribster', type: 'ワーム' },
  { slug: '4-5-ribster', type: 'ワーム' },
  { slug: 'ultralite-ball-painted', type: 'ジグヘッド' },
  { slug: '3-hellgie', type: 'ワーム' },
];

// ===== LUNKERHUNT =====
const LH_DELETE = ['assorted-stick-kit', 'a-r-s-blades', 'lts-waist-bag', 'lts-avid-messenger-bag'];
const LH_RECLASSIFY: Array<{slug: string; type: string; target_fish?: string[]}> = [
  { slug: 'hive-micro-relic', type: 'ワーム' },
  { slug: 'dragonfly', type: 'トップウォーター' },
  { slug: 'hive-hellgrammite', type: 'ワーム' },
  { slug: 'true-spin', type: 'スプーン' },
  { slug: 'fillet', type: 'バイブレーション' },
  { slug: 'big-eye', type: 'スイムベイト' },
  { slug: 'hive-micro-stash', type: 'ワーム' },
  { slug: 'bait-shifter-jigs', type: 'ジグヘッド' },
  { slug: 'hive-micro-typhon', type: 'ワーム' },
  { slug: 'hive-hover-shot', type: 'ワーム' },
  { slug: 'hive-versa-fish', type: 'ワーム' },
  { slug: 'mantle-pre-rigged-squid', type: 'ワーム', target_fish: ['ヒラメ', 'マゴチ', 'シーバス'] },
  { slug: 'glitch-blade', type: 'バイブレーション' },
  { slug: 'boshi-blade', type: 'バイブレーション' },
  { slug: 'hive-micro-manta', type: 'ワーム' },
  { slug: 'micro-tear-drop', type: 'ジグヘッド' },
];

// ===== MISSILE BAITS =====
const MB_DELETE = [
  'carolina-rig-baits-bundle', 'mini-skirts', 'john-crews-kids-eyewear',
  'lets-go-fishing-performance-camo-graphite',
  'aaron-lewis-ladies-american-as-it-gets-tank-top-military-green',
  'autism-awareness-fish-decal-and-bracelet', 'd-bomb-hundo-bulk-bundle',
  'striker-grey-hoody-small-only', 'missile-baits-blaze-orange-beanie',
  'missile-baits-wwjf-shirt', 'dont-tread-on-me-tee-black-gold',
  'striker-rain-bib', 'ishs-d-bomb-bundle',
];
const MB_RECLASSIFY: Array<{slug: string; type: string}> = [
  { slug: 'missile-baits-hover-missile', type: 'ジグヘッド' },
  { slug: 'missile-baits-warlock-head', type: 'ジグヘッド' },
  { slug: 'missile-baits-bomba-3-5', type: 'ワーム' },
];

async function main() {
  // Build master lists
  const allDeletes: Array<{manufacturer_slug: string; slug: string}> = [
    ...SPRO_DELETE.map(s => ({ manufacturer_slug: 'spro', slug: s })),
    ...LC_DELETE.map(s => ({ manufacturer_slug: 'lunker-city', slug: s })),
    ...LH_DELETE.map(s => ({ manufacturer_slug: 'lunkerhunt', slug: s })),
    ...MB_DELETE.map(s => ({ manufacturer_slug: 'missile-baits', slug: s })),
  ];

  const allReclassify: Array<{manufacturer_slug: string; slug: string; type: string; target_fish?: string[]}> = [
    ...SPRO_RECLASSIFY.map(r => ({ manufacturer_slug: 'spro', ...r })),
    ...LC_RECLASSIFY.map(r => ({ manufacturer_slug: 'lunker-city', ...r })),
    ...LH_RECLASSIFY.map(r => ({ manufacturer_slug: 'lunkerhunt', ...r })),
    ...MB_RECLASSIFY.map(r => ({ manufacturer_slug: 'missile-baits', ...r })),
  ];

  console.log(`=== 実行計画 ===`);
  console.log(`削除: ${allDeletes.length}商品`);
  console.log(`再分類: ${allReclassify.length}商品`);

  // === PHASE 1: DELETE ===
  console.log(`\n=== Phase 1: 削除 ===`);
  let totalDeleted = 0;
  let deleteErrors = 0;

  for (const item of allDeletes) {
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
  console.log(`  削除完了: ${allDeletes.length}商品, ${totalDeleted}行, エラー: ${deleteErrors}`);

  // === PHASE 2: RECLASSIFY ===
  console.log(`\n=== Phase 2: 再分類 ===`);
  let reclassified = 0;
  let reclassErrors = 0;

  for (const item of allReclassify) {
    const update: any = { type: item.type };
    if (item.target_fish) update.target_fish = item.target_fish;

    const { error, count } = await sb.from('lures')
      .update(update, { count: 'exact' })
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug);

    if (error) {
      console.error(`  ERROR: ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      reclassErrors++;
    } else if ((count || 0) === 0) {
      console.log(`  SKIP (0行): ${item.manufacturer_slug}/${item.slug}`);
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
    phase: 2,
    deleted: { products: allDeletes.length, rows: totalDeleted, errors: deleteErrors, items: allDeletes },
    reclassified: { products: allReclassify.length, rows: reclassified, errors: reclassErrors, items: allReclassify },
  };
  writeFileSync('scripts/_cleanup-2-backup-2026-03-09.json', JSON.stringify(backup, null, 2));
  console.log(`\nバックアップ: scripts/_cleanup-2-backup-2026-03-09.json`);
}

main();
