import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 1. まずusachanjig-exの実データを確認
  const { data: usachan } = await sb.from('lures')
    .select('id, name, slug, type, target_fish, manufacturer_slug, weight, description')
    .eq('slug', 'usachanjig-ex')
    .limit(3);
  console.log('=== usachanjig-ex ===');
  console.log(JSON.stringify(usachan, null, 2));

  // 2. attic全商品のtype分布
  const { data: attic } = await sb.from('lures')
    .select('name, slug, type, target_fish')
    .eq('manufacturer_slug', 'attic');
  
  // slug単位でユニーク化
  const atticUnique = new Map<string, any>();
  for (const r of attic!) {
    if (!atticUnique.has(r.slug)) atticUnique.set(r.slug, r);
  }
  console.log('\n=== attic全商品 ===');
  for (const [slug, r] of atticUnique) {
    console.log(`${r.type}\t${r.target_fish}\t${r.name}`);
  }

  // 3. 全メーカーでtype="ミノー"かつ名前に"ジグ"が含まれるもの（明らかに怪しい）
  const { data: suspiciousJigMinnow } = await sb.from('lures')
    .select('name, slug, type, target_fish, manufacturer_slug')
    .eq('type', 'ミノー')
    .ilike('name', '%ジグ%');
  const uniqueJigMinnow = new Map<string, any>();
  for (const r of suspiciousJigMinnow!) {
    if (!uniqueJigMinnow.has(r.slug)) uniqueJigMinnow.set(r.slug, r);
  }
  console.log('\n=== type=ミノー & 名前にジグ ===');
  for (const [_, r] of uniqueJigMinnow) {
    console.log(`${r.manufacturer_slug}\t${r.name}\t${r.target_fish}`);
  }

  // 4. 全メーカーで同一slugなのにtypeが異なるケース（データ不整合）
  const { data: allLures } = await sb.from('lures')
    .select('slug, type, manufacturer_slug, name')
    .order('slug');
  
  const slugTypes = new Map<string, Set<string>>();
  const slugNames = new Map<string, string>();
  for (const r of allLures!) {
    if (!slugTypes.has(r.slug)) slugTypes.set(r.slug, new Set());
    slugTypes.get(r.slug)!.add(r.type);
    slugNames.set(r.slug, r.name);
  }
  console.log('\n=== 同一slugで複数タイプ（データ不整合）===');
  let inconsistentCount = 0;
  for (const [slug, types] of slugTypes) {
    if (types.size > 1) {
      console.log(`${slug}: ${[...types].join(', ')} (${slugNames.get(slug)})`);
      inconsistentCount++;
    }
  }
  console.log(`計: ${inconsistentCount}件`);

  // 5. メーカーごとのtype=その他の件数（パイプラインのtype判定漏れ）
  const { data: otherType } = await sb.from('lures')
    .select('slug, name, manufacturer_slug, type, target_fish')
    .eq('type', 'その他');
  const otherUnique = new Map<string, any>();
  for (const r of otherType!) {
    if (!otherUnique.has(r.slug)) otherUnique.set(r.slug, r);
  }
  const otherByMaker = new Map<string, number>();
  for (const [_, r] of otherUnique) {
    otherByMaker.set(r.manufacturer_slug, (otherByMaker.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log('\n=== "その他" メーカー別 ===');
  const sortedOther = [...otherByMaker.entries()].sort((a, b) => b[1] - a[1]);
  for (const [maker, count] of sortedOther) {
    console.log(`${maker}: ${count}`);
  }

  // 6. ランダムサンプリング: 各メーカーから5件ずつ抜き出して、type/target_fishを確認
  // (人間が目視確認する用)
  const makers = ['attic', 'dstyle', 'viva', 'pickup', 'pozidrive-garage', 'sawamura', 'flash-union', 'valleyhill', 'bottomup'];
  console.log('\n=== 小規模メーカー サンプリング ===');
  for (const maker of makers) {
    const { data: sample } = await sb.from('lures')
      .select('slug, name, type, target_fish')
      .eq('manufacturer_slug', maker)
      .limit(200);
    const uniqueSample = new Map<string, any>();
    for (const r of sample!) {
      if (!uniqueSample.has(r.slug)) uniqueSample.set(r.slug, r);
    }
    console.log(`\n--- ${maker} (${uniqueSample.size}商品) ---`);
    for (const [_, r] of uniqueSample) {
      console.log(`  ${r.type}\t${r.target_fish}\t${r.name}`);
    }
  }
}
main();
