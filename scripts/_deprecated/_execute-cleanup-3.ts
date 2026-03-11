import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const TO_DELETE: Array<{manufacturer_slug: string; slug: string}> = [
  // berkley-us
  { manufacturer_slug: 'berkley-us', slug: 'walleye-rigs-indiana' },
  // googan-baits
  { manufacturer_slug: 'googan-baits', slug: 'harbor-heather-hooded-long-sleeve' },
  { manufacturer_slug: 'googan-baits', slug: 'googan-sling-pack' },
  // spro
  { manufacturer_slug: 'spro', slug: 'g-box-3500-deep-utility-case' },
  { manufacturer_slug: 'spro', slug: 'taru-swivel-with-interlock-snap' },
  { manufacturer_slug: 'spro', slug: 'secure-liquid-box-white-l430' },
  { manufacturer_slug: 'spro', slug: 'power-offset-wide-gap' },
  { manufacturer_slug: 'spro', slug: 'spro-box-3700-waterproof-black-green' },
  { manufacturer_slug: 'spro', slug: 'power-offset-neko' },
  { manufacturer_slug: 'spro', slug: 'spro-skip-gap-shaky-head-football' },
  { manufacturer_slug: 'spro', slug: 'g-box-double-slit-foam-case-3200' },
  { manufacturer_slug: 'spro', slug: 'spro-retro-foam-cap-navy' },
  { manufacturer_slug: 'spro', slug: 'g-case-3000' },
  { manufacturer_slug: 'spro', slug: 'spro-sun-hoodie-camo' },
  { manufacturer_slug: 'spro', slug: 'power-split-rings' },
  { manufacturer_slug: 'spro', slug: 'wicked-weather-wear-glove-closed-finger-camo' },
  { manufacturer_slug: 'spro', slug: 'g-box-3600-utility-case' },
  { manufacturer_slug: 'spro', slug: 'sb60-fin-and-tail-set-rainbow-trout' },
  { manufacturer_slug: 'spro', slug: 'spro-box-3500-waterproof-black-green' },
  { manufacturer_slug: 'spro', slug: 'wicked-weather-wear-heavy-duty-bib-camo' },
  { manufacturer_slug: 'spro', slug: 'spro-richardson-trucker-charcoal-black' },
  { manufacturer_slug: 'spro', slug: 'spro-fish-gripper-9' },
  { manufacturer_slug: 'spro', slug: 'power-offset-round-bend' },
  { manufacturer_slug: 'spro', slug: 'spro-reaper-black' },
  { manufacturer_slug: 'spro', slug: 'ball-bearing-swivels-with-2-welded-rings-dura-slick' },
  // xzone-lures
  { manufacturer_slug: 'xzone-lures', slug: 'round-drop-shot-weight' },
  { manufacturer_slug: 'xzone-lures', slug: 'rubber-t-stop' },
  { manufacturer_slug: 'xzone-lures', slug: 'tungsten-pagoda-nail-sinker' },
  { manufacturer_slug: 'xzone-lures', slug: 'wacky-rigging-o-rings' },
  { manufacturer_slug: 'xzone-lures', slug: 'lead-pagoda-nail-sinker' },
  { manufacturer_slug: 'xzone-lures', slug: 'smart-peg' },
  { manufacturer_slug: 'xzone-lures', slug: 'pencil-drop-shot-weight' },
  { manufacturer_slug: 'xzone-lures', slug: 'tungsten-wobble-head' },
  { manufacturer_slug: 'xzone-lures', slug: 'blade-spin-2-pack' },
];

const TO_RECLASSIFY: Array<{manufacturer_slug: string; slug: string; type: string}> = [
  // spro - メタルジグ
  { manufacturer_slug: 'spro', slug: 'shimmy-flat-barbie-pink-glow', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'pesce-40g', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'shimmy-semi-long-bloody-mary-glow', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'shimmy-semi-long-tequila-sunrise-glow', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'cannon-ball-keylime-pie', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'shimmy-semi-long-tequila-sunrise', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'pesce-120g', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'shimmy-flat-crushed-ice-glow', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'cannon-ball-bloody-mary', type: 'メタルジグ' },
  { manufacturer_slug: 'spro', slug: 'cannon-ball-blue', type: 'メタルジグ' },
  // spro - クランクベイト
  { manufacturer_slug: 'spro', slug: 'little-john-type-r-50', type: 'クランクベイト' },
  // xzone-lures
  { manufacturer_slug: 'xzone-lures', slug: 'gbo-13mm-4-pack', type: 'ワーム' },
];

async function main() {
  console.log(`=== 実行計画 ===`);
  console.log(`削除: ${TO_DELETE.length}商品`);
  console.log(`再分類: ${TO_RECLASSIFY.length}商品`);

  // DELETE
  let totalDeleted = 0;
  for (const item of TO_DELETE) {
    const { count } = await sb.from('lures')
      .delete({ count: 'exact' })
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug);
    totalDeleted += count || 0;
  }
  console.log(`削除完了: ${TO_DELETE.length}商品, ${totalDeleted}行`);

  // RECLASSIFY
  let totalReclass = 0;
  for (const item of TO_RECLASSIFY) {
    const { count } = await sb.from('lures')
      .update({ type: item.type }, { count: 'exact' })
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug);
    totalReclass += count || 0;
  }
  console.log(`再分類完了: ${TO_RECLASSIFY.length}商品, ${totalReclass}行`);

  // Save backup
  writeFileSync('scripts/_cleanup-3-backup-2026-03-09.json', JSON.stringify({
    executedAt: new Date().toISOString(),
    deleted: { products: TO_DELETE.length, rows: totalDeleted },
    reclassified: { products: TO_RECLASSIFY.length, rows: totalReclass },
  }, null, 2));

  // Final check
  const brands = ['6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];
  const {data} = await sb.from('lures')
    .select('slug, manufacturer_slug')
    .in('manufacturer_slug', brands)
    .eq('type', 'その他');
  const seen = new Set<string>();
  for (const r of data!) seen.add(r.manufacturer_slug + '/' + r.slug);
  console.log(`\n残りtype=その他: ${seen.size}件`);
  for (const k of seen) console.log(`  ${k}`);
}

main();
