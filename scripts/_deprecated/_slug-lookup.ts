import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  // D-Contact
  const { data: d1 } = await sb.from('lures').select('slug, name, manufacturer_slug').ilike('name', '%D-Contact%').eq('manufacturer_slug', 'smith').limit(5);
  console.log('=== D-Contact ===');
  for (const r of d1 || []) console.log(`  /${r.manufacturer_slug}/${r.slug}/ → ${r.name}`);
  // ONETEN
  const { data: d2 } = await sb.from('lures').select('slug, name, manufacturer_slug').ilike('name', '%ONETEN%').eq('manufacturer_slug', 'megabass').limit(5);
  console.log('=== ONETEN ===');
  for (const r of d2 || []) console.log(`  /${r.manufacturer_slug}/${r.slug}/ → ${r.name}`);
}
main();
