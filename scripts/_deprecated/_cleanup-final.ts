import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 削除: 交換テール、ジグヘッド単体、スイベル
  const toDelete = [
    { slug: 'trace-replacement-tail-shad-sense' },
    { slug: 'trace-5-replacement-tail-cajun-gill' },
    { slug: 'trace-replacement-tail-fire-perch' },
    { slug: 'crappie-jig-heads-multi-pack-silver-shad' },
    { slug: 'ned-rig-football-head-matte-black' },
    { slug: 'dome-jighead-matte-black' },
    { slug: 'gyro-premium-swivels' },
  ];

  let totalDeleted = 0;
  for (const item of toDelete) {
    const { count } = await sb.from('lures')
      .delete({ count: 'exact' })
      .eq('manufacturer_slug', '6th-sense')
      .eq('slug', item.slug);
    totalDeleted += count || 0;
  }
  console.log(`削除: ${toDelete.length}商品, ${totalDeleted}行`);

  // Party Prop Matte Minnow: ワーム→トップウォーター
  const { count } = await sb.from('lures')
    .update({ type: 'トップウォーター' }, { count: 'exact' })
    .eq('manufacturer_slug', '6th-sense')
    .eq('slug', 'party-prop-matte-minnow');
  console.log(`Party Prop Matte Minnow → トップウォーター: ${count}行`);

  // 非ルアー X Zone items that slipped through
  const xzoneDelete = [
    'x-zone-proven-success-full-back-black',  // 帽子
    'x-zone-target-tee-block-logo-heather-charcoal',  // T-shirt
    'x-zone-pro-series-bait-bag-16-x-13',  // バッグ
  ];
  let xDel = 0;
  for (const slug of xzoneDelete) {
    const { count } = await sb.from('lures')
      .delete({ count: 'exact' })
      .eq('manufacturer_slug', 'xzone-lures')
      .eq('slug', slug);
    xDel += count || 0;
  }
  console.log(`X Zone非ルアー削除: ${xzoneDelete.length}商品, ${xDel}行`);
}
main();
