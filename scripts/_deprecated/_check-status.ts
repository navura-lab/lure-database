import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  // Check obasslive products
  const {data: obasslive} = await sb.from('lures').select('slug,name,description').eq('manufacturer_slug','obasslive').limit(30);
  const unique = [...new Map((obasslive || []).map(r => [r.slug, {slug: r.slug, name: r.name, desc_len: r.description?.length || 0, desc_preview: (r.description || '').substring(0, 80)}])).values()];
  console.log('=== OBASSLIVE products (' + unique.length + ' unique) ===');
  for (const u of unique) {
    console.log(`  ${u.slug}: ${u.desc_len} chars - ${u.desc_preview}`);
  }

  // Check damiki, god-hands, jazz products
  for (const maker of ['damiki', 'god-hands', 'jazz']) {
    const {count} = await sb.from('lures').select('*', {count: 'exact', head: true}).eq('manufacturer_slug', maker);
    console.log(`\n${maker}: ${count} products`);
  }

  // Overall unrewritten check
  const {data: allLures} = await sb.from('lures').select('slug,manufacturer_slug,name,description');
  const unrewritten = (allLures || []).filter(r => r.description && r.description.length > 250);
  const uniqueUnrewritten = [...new Map(unrewritten.map(r => [r.slug + ':' + r.manufacturer_slug, r])).values()];
  console.log('\n=== Unrewritten (>250 chars): ' + uniqueUnrewritten.length + ' unique slugs ===');
  for (const r of uniqueUnrewritten) {
    console.log(`  ${r.manufacturer_slug}/${r.slug}: ${r.description?.length} chars`);
  }
}

main().catch(console.error);
