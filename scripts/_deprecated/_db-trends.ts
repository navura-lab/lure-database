import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function fetchAll(sb: any) {
  const results: any[] = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data } = await sb.from('lures')
      .select('type, manufacturer, manufacturer_slug, target_fish, price, weight, is_limited')
      .range(offset, offset + batchSize - 1);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  return results;
}

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const all = await fetchAll(sb);
  console.log(`Total records: ${all.length}`);

  const typeMap = new Map<string, number>();
  for (const l of all) typeMap.set(l.type || 'unknown', (typeMap.get(l.type || 'unknown') || 0) + 1);
  console.log('\n=== タイプ別 TOP 20 ===');
  [...typeMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([t,c]) => console.log(`  ${t}: ${c} (${(c/all.length*100).toFixed(1)}%)`));

  const mfrMap = new Map<string, number>();
  for (const l of all) mfrMap.set(l.manufacturer || '?', (mfrMap.get(l.manufacturer || '?') || 0) + 1);
  console.log('\n=== メーカー別 TOP 20 ===');
  [...mfrMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([m,c]) => console.log(`  ${m}: ${c} (${(c/all.length*100).toFixed(1)}%)`));

  const fishMap = new Map<string, number>();
  for (const l of all) {
    if (l.target_fish) for (const f of l.target_fish) fishMap.set(f, (fishMap.get(f) || 0) + 1);
  }
  console.log('\n=== 対象魚別 TOP 20 ===');
  [...fishMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([f,c]) => console.log(`  ${f}: ${c}`));

  const prices = all.filter(l => l.price > 0).map(l => l.price);
  const avg = prices.reduce((s,p) => s+p, 0) / prices.length;
  const sorted = [...prices].sort((a,b) => a-b);
  console.log(`\n=== 価格統計 ===`);
  console.log(`  平均: ¥${Math.round(avg)}, 中央値: ¥${sorted[Math.floor(sorted.length/2)]}`);
  console.log(`  最安: ¥${sorted[0]}, 最高: ¥${sorted[sorted.length-1]}`);

  console.log(`\n=== サマリー ===`);
  console.log(`  総レコード: ${all.length}, メーカー: ${mfrMap.size}, タイプ: ${typeMap.size}, 魚種: ${fishMap.size}`);
  console.log(`  限定品: ${all.filter(l => l.is_limited).length}`);
}
main().catch(console.error);
