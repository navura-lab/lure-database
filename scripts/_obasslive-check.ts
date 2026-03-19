import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, color_name, images, type, description, source_url').eq('manufacturer_slug', 'obasslive');
  if (!data) return;
  console.log(`OBASSLIVE total: ${data.length} records`);
  const slugs = new Map<string, any[]>();
  for (const r of data) {
    const g = slugs.get(r.slug) || [];
    g.push(r);
    slugs.set(r.slug, g);
  }
  console.log(`Unique slugs: ${slugs.size}\n`);
  for (const [slug, records] of slugs) {
    console.log(`=== ${slug} (${records.length}件) ===`);
    console.log(`  name: ${records[0].name}`);
    console.log(`  type: ${records[0].type}`);
    console.log(`  source: ${records[0].source_url}`);
    console.log(`  desc: ${(records[0].description || '').slice(0, 100)}`);
    for (const r of records.slice(0, 3)) {
      console.log(`  color: ${r.color_name || '(default)'} | img: ${r.images?.[0]?.slice(-50) || 'NONE'}`);
    }
    if (records.length > 3) console.log(`  ... +${records.length - 3} more`);
  }
}
main().catch(console.error);
