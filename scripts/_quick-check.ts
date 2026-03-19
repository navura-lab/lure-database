import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // SHIMMY FLAT画像チェック
  const { data: d1 } = await sb.from('lures').select('slug, color_name, images').eq('slug', 'shimmy-flat').limit(5);
  console.log('=== SHIMMY FLAT ===');
  for (const r of d1 || []) console.log(`  ${r.color_name}: img=${r.images?.[0]?.slice(-40) || 'NONE'}`);
  
  // Bite Powder確認
  const { data: d2 } = await sb.from('lures').select('slug, name, type, description').ilike('slug', '%bite-powder%').limit(3);
  console.log('\n=== Bite Powder ===');
  for (const r of d2 || []) {
    console.log(`  slug: ${r.slug}`);
    console.log(`  name: ${r.name}`);
    console.log(`  type: ${r.type}`);
    console.log(`  desc: ${(r.description || '').slice(0, 150)}`);
  }
}
main().catch(console.error);
