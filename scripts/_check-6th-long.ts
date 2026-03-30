import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('slug,name,description,type,target_fish')
    .eq('manufacturer_slug','6th-sense');
  const long = data?.filter(r => r.description && r.description.length > 250);
  // slug単位でユニーク化
  const seen = new Set();
  const uniq = long?.filter(r => { if(seen.has(r.slug)) return false; seen.add(r.slug); return true; });
  console.log('ユニークslug:', uniq?.length);
  uniq?.forEach(r => console.log(JSON.stringify({slug:r.slug,name:r.name,type:r.type,fish:r.target_fish,len:r.description.length,desc:r.description.substring(0,80)})));
}
main();
