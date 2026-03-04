import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('id,name,slug,manufacturer_slug,type,url').eq('manufacturer_slug','yarie').order('name');
  const unique = [...new Map(data!.map(r => [r.slug, r])).values()];
  for (const r of unique) console.log(JSON.stringify({name: r.name, slug: r.slug, type: r.type, url: r.url}));
  console.log('Total unique:', unique.length);
}
main();
