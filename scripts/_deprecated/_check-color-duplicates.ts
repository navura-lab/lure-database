import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 6th-senseの全slugを取得
  let allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('lures')
      .select('slug, name, description')
      .eq('manufacturer_slug', '6th-sense')
      .order('slug')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // ユニークslug
  const seen = new Map<string, any>();
  for (const r of allData) {
    if (!seen.has(r.slug)) seen.set(r.slug, r);
  }

  // slug からベース名を抽出（最後のカラー名部分を除去して同一製品を検出）
  const baseGroups = new Map<string, string[]>();
  for (const [slug, r] of seen) {
    // descriptionが同一のものをグルーピング
    const descKey = (r.description || '').substring(0, 100);
    if (!baseGroups.has(descKey)) baseGroups.set(descKey, []);
    baseGroups.get(descKey)!.push(slug);
  }

  // 同一descriptionで2つ以上のslugがあるケースを抽出
  const duplicateGroups = [...baseGroups.entries()]
    .filter(([, slugs]) => slugs.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`6th-sense ユニークslug数: ${seen.size}`);
  console.log(`同一description（先頭100文字）で3+slugがあるグループ: ${duplicateGroups.length}`);
  console.log(`そのグループのslug合計: ${duplicateGroups.reduce((s, [,g]) => s + g.length, 0)}`);

  console.log('\n=== Top 10 重複グループ ===');
  for (const [desc, slugs] of duplicateGroups.slice(0, 10)) {
    console.log(`\n--- ${slugs.length}ページが同一description ---`);
    console.log(`desc: ${desc.substring(0, 80)}...`);
    for (const slug of slugs.slice(0, 5)) {
      console.log(`  ${slug}`);
    }
    if (slugs.length > 5) console.log(`  ... +${slugs.length - 5}件`);
  }

  // 全メーカーで同様のチェック
  console.log('\n\n=== 全メーカー: 同一descriptionグループ数 ===');
  let allSlugs: any[] = [];
  offset = 0;
  while (true) {
    const { data } = await sb.from('lures')
      .select('manufacturer_slug, slug, description')
      .order('manufacturer_slug')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allSlugs.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const uniqueSlugs = new Map<string, any>();
  for (const r of allSlugs) {
    const k = r.manufacturer_slug + '/' + r.slug;
    if (!uniqueSlugs.has(k)) uniqueSlugs.set(k, r);
  }

  const allDescGroups = new Map<string, string[]>();
  for (const [key, r] of uniqueSlugs) {
    const descKey = r.manufacturer_slug + '|' + (r.description || '').substring(0, 100);
    if (!allDescGroups.has(descKey)) allDescGroups.set(descKey, []);
    allDescGroups.get(descKey)!.push(key);
  }

  const allDuplicates = [...allDescGroups.entries()]
    .filter(([, slugs]) => slugs.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  let totalDupPages = 0;
  for (const [, slugs] of allDuplicates) {
    totalDupPages += slugs.length;
  }

  console.log(`同一description（先頭100文字）で2+slugがあるグループ: ${allDuplicates.length}`);
  console.log(`そのグループのslug合計: ${totalDupPages}`);
  console.log(`ユニークslug総数: ${uniqueSlugs.size}`);
  console.log(`→ 重複疑い率: ${(totalDupPages / uniqueSlugs.size * 100).toFixed(1)}%`);
}
main();
