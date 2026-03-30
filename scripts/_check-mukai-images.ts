import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug,name,image_url,source_url')
    .eq('manufacturer_slug','mukai');
  
  const noImage = data?.filter(r => !r.image_url || r.image_url === '') || [];
  const hasImage = data?.filter(r => r.image_url && r.image_url !== '') || [];
  
  // ユニークslug
  const slugMap = new Map<string, any>();
  data?.forEach(r => {
    if (!slugMap.has(r.slug)) slugMap.set(r.slug, r);
  });
  
  const noImgSlugs = [...slugMap.values()].filter(r => !r.image_url);
  const total = slugMap.size;
  
  console.log(`mukai総商品数: ${total}種`);
  console.log(`画像なし: ${noImgSlugs.length}件`);
  noImgSlugs.slice(0,10).forEach(r => console.log(' ', r.slug, '|', r.name, '|', r.source_url?.substring(0,60)));
}
main();
