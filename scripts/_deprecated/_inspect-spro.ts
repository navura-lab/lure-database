import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const brands = ['spro', 'lunker-city', 'lunkerhunt', 'missile-baits'];
  const {data} = await sb.from('lures')
    .select('name, slug, manufacturer_slug, type, description')
    .in('manufacturer_slug', brands)
    .eq('type', 'その他')
    .order('manufacturer_slug');

  const seen = new Map<string, any>();
  for (const r of data!) {
    const k = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(k)) seen.set(k, {...r, count: 1});
    else seen.get(k)!.count++;
  }

  let current = '';
  for (const [key, r] of seen) {
    if (r.manufacturer_slug !== current) {
      current = r.manufacturer_slug;
      console.log(`\n=== ${current} (${[...seen.values()].filter(x => x.manufacturer_slug === current).length}件) ===`);
    }
    const desc = (r.description || '').substring(0, 100);
    console.log(`${r.slug} | ${r.name} | rows:${r.count}`);
    console.log(`  ${desc}`);
  }
}
main();
