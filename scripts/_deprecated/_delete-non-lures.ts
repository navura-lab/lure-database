import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 明確にルアーでないもの
const toDelete = [
  { manufacturer_slug: '6th-sense', slug: 'the-marina-speckled-senses', reason: '帽子' },
  { manufacturer_slug: '6th-sense', slug: '6th-sense-pro-fishing-shears-red', reason: 'ハサミ' },
  { manufacturer_slug: '6th-sense', slug: 'marina-fishdown-jacket', reason: 'ジャケット' },
  { manufacturer_slug: 'googan-baits', slug: 'green-series-micro-ultra-light-spinning-rod', reason: 'ロッド' },
  { manufacturer_slug: 'googan-baits', slug: 'turbulent-topwater-bundle', reason: 'バンドル' },
  { manufacturer_slug: 'googan-baits', slug: 'grey-heather-hooded-long-sleeve', reason: 'アパレル' },
  { manufacturer_slug: 'googan-baits', slug: 'gold-series-lunker-weedless-wacky-hook', reason: 'フック' },
  { manufacturer_slug: 'spro', slug: 'spro-box-3700-deep-waterproof-no-dividers', reason: 'タックルボックス' },
  { manufacturer_slug: 'spro', slug: 'rat-50-replacement-tail', reason: '交換パーツ' },
];

async function main() {
  let totalDeleted = 0;

  for (const item of toDelete) {
    const { data, error } = await sb.from('lures')
      .delete()
      .eq('manufacturer_slug', item.manufacturer_slug)
      .eq('slug', item.slug)
      .select('id');

    if (error) {
      console.error(`❌ ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
    } else {
      const count = data?.length ?? 0;
      totalDeleted += count;
      console.log(`✅ ${item.manufacturer_slug}/${item.slug} (${item.reason}) → ${count}行削除`);
    }
  }

  console.log(`\n合計: ${totalDeleted}行削除`);
}

main();
