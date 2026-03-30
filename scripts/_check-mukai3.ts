import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug,name,images')
    .eq('manufacturer_slug','mukai');
  
  const slugMap = new Map<string, any>();
  data?.forEach(r => { if (!slugMap.has(r.slug)) slugMap.set(r.slug, r); });
  
  const total = slugMap.size;
  const noImg = [...slugMap.values()].filter(r => !r.images?.length);
  const mukaiFishingUrl = [...slugMap.values()].filter(r => r.images?.[0]?.includes('mukai-fishing.jp'));
  const r2Url = [...slugMap.values()].filter(r => r.images?.[0]?.includes('r2') || r.images?.[0]?.includes('cloudflare'));
  
  console.log(`総商品数: ${total}`);
  console.log(`画像なし: ${noImg.length}`);
  console.log(`mukai-fishing.jp URL: ${mukaiFishingUrl.length}`);
  console.log(`R2/Cloudflare URL: ${r2Url.length}`);
  
  // サンプル
  if (mukaiFishingUrl.length > 0) {
    console.log('\nmukai-fishing.jpのサンプル:');
    mukaiFishingUrl.slice(0,3).forEach(r => console.log(' ', r.slug, '|', r.images?.[0]));
  }
  if (noImg.length > 0) {
    console.log('\n画像なしサンプル:');
    noImg.slice(0,5).forEach(r => console.log(' ', r.slug, '|', r.name));
  }
}
main();
