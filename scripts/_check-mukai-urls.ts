import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug,source_url,images')
    .eq('manufacturer_slug','mukai');
  const slugMap = new Map<string,any>();
  data?.forEach(r => { if(!slugMap.has(r.slug)) slugMap.set(r.slug, r); });
  // source_urlのパターン確認
  const urls = [...slugMap.values()].map(r => r.source_url).filter(Boolean);
  console.log('source_url サンプル:');
  urls.slice(0,5).forEach(u => console.log(' ', u));
  
  // 画像がmukai-fishing.jpのもの
  const needsUpdate = [...slugMap.values()].filter(r => r.images?.[0]?.includes('mukai-fishing.jp'));
  console.log(`\nR2未アップロード: ${needsUpdate.length}件`);
}
main();
