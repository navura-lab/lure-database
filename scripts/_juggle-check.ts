import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, type, description, color_name, images').ilike('slug', '%juggle%');
  if (!data) return;
  for (const r of data) {
    console.log(`slug: ${r.slug}`);
    console.log(`name: ${r.name}`);
    console.log(`type: ${r.type}`);
    console.log(`color: ${r.color_name}`);
    console.log(`desc: ${(r.description || '').slice(0, 200)}`);
    console.log(`img: ${r.images?.[0]?.slice(-60) || 'NONE'}`);
    console.log('---');
  }
}
main().catch(console.error);
