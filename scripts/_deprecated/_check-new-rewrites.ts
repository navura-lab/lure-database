import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  // Check jazz and god-hands descriptions
  for (const maker of ['jazz', 'god-hands']) {
    const {data} = await sb.from('lures').select('slug,name,description').eq('manufacturer_slug', maker);
    const unique = [...new Map((data || []).map(r => [r.slug, {slug: r.slug, name: r.name, desc_len: r.description?.length || 0, desc_preview: (r.description || '').substring(0, 100)}])).values()];
    console.log(`\n=== ${maker} (${unique.length} unique products) ===`);
    for (const u of unique) {
      const status = !u.desc_preview ? 'EMPTY' : u.desc_len > 250 ? 'NEEDS_REWRITE' : 'OK';
      console.log(`  [${status}] ${u.slug}: ${u.desc_len} chars - ${u.desc_preview}`);
    }
  }
}

main().catch(console.error);
