import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, type, description').eq('slug', 'ronguemu').limit(3);
  if (!data) return;
  for (const r of data) {
    console.log(`slug: ${r.slug}`);
    console.log(`name: ${r.name}`);
    console.log(`type: ${r.type}`);
    console.log(`desc: ${(r.description || '').slice(0, 200)}`);
    console.log('---');
  }
}
main();
