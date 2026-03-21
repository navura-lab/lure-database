import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // bysportly
  const { data: d1 } = await sb.from('lures').select('slug, name, images, manufacturer_slug, source_url').eq('slug', 'bysportly').limit(3);
  console.log('=== bysportly ===');
  for (const r of d1 || []) {
    console.log(`  images: ${JSON.stringify(r.images)}`);
    console.log(`  source: ${r.source_url}`);
  }
  
  // shimmy-flat
  const { data: d2 } = await sb.from('lures').select('slug, name, color_name, images').eq('slug', 'shimmy-flat').limit(5);
  console.log('\n=== shimmy-flat ===');
  for (const r of d2 || []) {
    console.log(`  ${r.color_name}: ${r.images?.[0]?.slice(-60) || 'NONE'}`);
  }
  
  // 画像URLが実際にアクセス可能か確認
  if (d1?.[0]?.images?.[0]) {
    const res = await fetch(d1[0].images[0], { method: 'HEAD' });
    console.log(`\nbysportly image status: ${res.status} ${res.url.slice(-60)}`);
  }
  if (d2?.[0]?.images?.[0]) {
    const res = await fetch(d2[0].images[0], { method: 'HEAD' });
    console.log(`shimmy-flat image status: ${res.status} ${res.url.slice(-60)}`);
  }
  
  // 全体の画像なし統計
  let noImg = 0;
  let total = 0;
  let offset = 0;
  const badMakers = new Map<string, number>();
  while (true) {
    const { data } = await sb.from('lures').select('manufacturer_slug, images').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      total++;
      if (!r.images || r.images.length === 0 || r.images[0] === null) {
        noImg++;
        badMakers.set(r.manufacturer_slug, (badMakers.get(r.manufacturer_slug) || 0) + 1);
      }
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`\n=== 画像なし統計 ===`);
  console.log(`Total: ${total}, No image: ${noImg} (${(noImg/total*100).toFixed(1)}%)`);
  console.log('Top 10 makers with missing images:');
  [...badMakers.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10).forEach(([m, c]) => console.log(`  ${m}: ${c}`));
}
main().catch(console.error);
