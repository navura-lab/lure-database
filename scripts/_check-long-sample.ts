import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  // strike-king サンプル
  const { data } = await sb.from('lures').select('slug,name,description')
    .eq('manufacturer_slug','strike-king').gt('description', '');
  const seen = new Map<string,any>();
  data?.forEach(r => { if(!seen.has(r.slug)) seen.set(r.slug, r); });
  const long = [...seen.values()].filter(r => r.description?.length > 250);
  console.log(`strike-king 250文字超: ${long.length}件`);
  // サンプル3件
  long.slice(0,3).forEach(r => {
    console.log(`\n${r.slug} (${r.description?.length}文字):`);
    console.log(r.description?.substring(0,150));
  });
}
main();
