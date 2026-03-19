import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  // Zero Dragonの問題ページ確認
  const { data } = await sb.from('lures').select('*').eq('manufacturer_slug', 'zero-dragon');
  if (!data) return;
  
  // 非ルアー製品（アフターパーツ、ロッド等）を特定
  const nonLure = data.filter(l => 
    /アフターパーツ|パーツ|ロッド|rod|parts|キャスティングロッド|ジギングロッド|カバー|ケース/i.test(l.name || '')
  );
  console.log(`Zero Dragon total: ${data.length}`);
  console.log(`非ルアー疑い: ${nonLure.length}`);
  for (const l of nonLure) {
    console.log(`  ${l.slug} → ${l.name} [type:${l.type}]`);
  }
  
  // afutapatsuraundotaipukodokipa を確認
  const target = data.find(l => l.slug?.includes('afutapatsu'));
  if (target) {
    console.log(`\n=== 問題ページ ===`);
    console.log(`  slug: ${target.slug}`);
    console.log(`  name: ${target.name}`);
    console.log(`  type: ${target.type}`);
    console.log(`  desc: ${target.description?.slice(0, 200)}`);
    console.log(`  images: ${target.images?.[0]?.slice(-60)}`);
  }
}
main().catch(console.error);
