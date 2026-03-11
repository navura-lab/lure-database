import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  const {data, error} = await sb.from('lures').select('manufacturer_slug, manufacturer');
  if (error) { console.error('ERROR:', error.message); process.exit(1); }
  const makers = new Map<string, {slug: string, name: string, count: number}>();
  for (const r of data) {
    if (!makers.has(r.manufacturer_slug)) makers.set(r.manufacturer_slug, { slug: r.manufacturer_slug, name: r.manufacturer, count: 0 });
    makers.get(r.manufacturer_slug)!.count++;
  }
  const list = [...makers.values()].sort((a,b) => b.count - a.count);
  console.log('Total makers:', list.length);
  list.forEach(m => console.log(m.slug + '|' + m.name + '|' + m.count));
}
main();
