import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 追加の非ルアーアイテム
const toDelete = [
  { manufacturer_slug: '6th-sense', slug: '6-customs-crappie-special-70-medium-light-moderate-fast-spinning', reason: 'ロッド' },
  { manufacturer_slug: '6th-sense', slug: 'sense-it', reason: 'Tシャツ' },
  { manufacturer_slug: '6th-sense', slug: 'the-show-raised-6', reason: '帽子' },
  { manufacturer_slug: 'spro', slug: 'g-box-3200-slit-foam-case', reason: 'タックルケース' },
  { manufacturer_slug: 'z-man', slug: 'ez-skirt', reason: '交換用スカート' },
  { manufacturer_slug: 'z-man', slug: 'banded-skirtz', reason: '交換用スカート' },
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
