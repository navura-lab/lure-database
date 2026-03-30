import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('slug,name,description')
    .eq('manufacturer_slug','tiemco');
  const short = data?.filter(r => !r.description || r.description.length < 30);
  console.log('description短い/空:', short?.length, '件');
  short?.forEach(r => console.log(' ', r.slug, `|"${r.description?.substring(0,40) || '(空)'}"`));
  
  // 6th-sense description英語500文字超の確認
  const sb2 = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data: sixth} = await sb2.from('lures').select('slug,description')
    .eq('manufacturer_slug','6th-sense');
  const long = sixth?.filter(r => r.description && r.description.length > 250);
  console.log('\n6th-sense 250文字超:', long?.length, '件');
}
main();
