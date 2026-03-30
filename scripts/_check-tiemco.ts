import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('slug,name,description')
    .eq('manufacturer_slug','tiemco').is('description', null);
  console.log('description NULL:', data?.length, '件');
  data?.forEach(r => console.log(' ', r.slug, '|', r.name));
}
main();
