import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. usachanjig-exの確認（ユーザー指摘の具体例）
  const { data: usachan } = await sb.from('lures')
    .select('slug, name, type, target_fish, manufacturer_slug')
    .eq('slug', 'usachanjig-ex')
    .limit(1);
  console.log('=== usachanjig-ex（ユーザー指摘例）===');
  console.log(JSON.stringify(usachan?.[0], null, 2));

  // 2. attic全体の確認
  const { data: attic } = await sb.from('lures')
    .select('slug, name, type, target_fish')
    .eq('manufacturer_slug', 'attic')
    .limit(200);
  const atticUnique = new Map<string, any>();
  for (const r of attic!) {
    if (!atticUnique.has(r.slug)) atticUnique.set(r.slug, r);
  }
  console.log('\n=== attic（修正後）===');
  for (const [_, r] of atticUnique) {
    console.log(`  ${r.type}\t${r.target_fish}\t${r.name}`);
  }

  // 3. pickup全体の確認
  const { data: pickup } = await sb.from('lures')
    .select('slug, name, type, target_fish')
    .eq('manufacturer_slug', 'pickup')
    .limit(500);
  const pickupUnique = new Map<string, any>();
  for (const r of pickup!) {
    if (!pickupUnique.has(r.slug)) pickupUnique.set(r.slug, r);
  }
  console.log('\n=== pickup（修正後）===');
  for (const [_, r] of pickupUnique) {
    console.log(`  ${r.type}\t${r.target_fish}\t${r.name}`);
  }

  // 4. 残りの「その他」件数
  const { data: otherRemaining } = await sb.from('lures')
    .select('slug, manufacturer_slug')
    .eq('type', 'その他')
    .limit(5000);
  const otherCount = new Map<string, Set<string>>();
  for (const r of otherRemaining!) {
    if (!otherCount.has(r.manufacturer_slug)) otherCount.set(r.manufacturer_slug, new Set());
    otherCount.get(r.manufacturer_slug)!.add(r.slug);
  }
  console.log('\n=== 残りの「その他」===');
  let total = 0;
  const sorted = [...otherCount.entries()].sort((a, b) => b[1].size - a[1].size);
  for (const [maker, slugs] of sorted) {
    console.log(`  ${maker}: ${slugs.size}`);
    total += slugs.size;
  }
  console.log(`  合計: ${total}件`);

  // 5. 衣類・非ルアー商品の残存確認
  const { data: clothing } = await sb.from('lures')
    .select('slug, name, manufacturer_slug')
    .or('name.ilike.%パーカ%,name.ilike.%Tシャツ%,name.ilike.%チェストライト%,name.ilike.%ステッカー%')
    .limit(20);
  console.log('\n=== 衣類/非ルアーの残存確認 ===');
  if (clothing?.length === 0) {
    console.log('  ✅ 衣類・非ルアー商品はすべて削除済み');
  } else {
    for (const r of clothing!) {
      console.log(`  ⚠️ ${r.manufacturer_slug}/${r.slug}: ${r.name}`);
    }
  }
}

main();
