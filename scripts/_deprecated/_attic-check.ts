import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  const {data} = await sb.from('lures').select('slug,name,images,color_name').eq('manufacturer_slug','attic');
  if (!data) { console.log('No data'); return; }
  
  console.log(`Total ATTIC rows: ${data.length}`);
  
  const bySlug = new Map<string, {name: string; colors: string[]; imgSample: string}>();
  for (const r of data) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, {name: r.name, colors: [], imgSample: ''});
    const e = bySlug.get(r.slug)!;
    if (r.color_name && !e.colors.includes(r.color_name)) e.colors.push(r.color_name);
    if (!e.imgSample && r.images && r.images[0]) e.imgSample = r.images[0];
  }
  
  console.log(`Unique slugs: ${bySlug.size}\n`);
  
  // Check for "ATTIC" as color name (the bug)
  let bugCount = 0;
  for (const [slug, info] of bySlug) {
    if (info.colors.includes('ATTIC')) bugCount++;
  }
  console.log(`Products with "ATTIC" as color: ${bugCount}`);
  
  // Show sample
  let shown = 0;
  for (const [slug, info] of bySlug) {
    if (shown >= 5) break;
    console.log(`\n[${slug}] ${info.name}`);
    console.log(`  Colors(${info.colors.length}): ${info.colors.slice(0,5).join(', ')}${info.colors.length > 5 ? '...' : ''}`);
    console.log(`  IMG: ${info.imgSample?.substring(0, 80) || 'none'}`);
    shown++;
  }
}
main();
