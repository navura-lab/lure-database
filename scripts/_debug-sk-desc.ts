import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  // "rodent" slug で全行確認
  const { data } = await sb.from('lures').select('slug,color_name,description')
    .eq('manufacturer_slug','strike-king').eq('slug','rodent');
  const descs = new Set(data?.map(r => r.description));
  console.log(`rodent: ${data?.length}行, ユニークdescription数: ${descs.size}`);
  [...descs].forEach(d => console.log(`  [${d?.length}文字] ${d?.substring(0,80)}`));
}
main();
