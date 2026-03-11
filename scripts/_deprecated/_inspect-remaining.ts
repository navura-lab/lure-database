import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const brands = ['6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];
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

  for (const [key, r] of seen) {
    const desc = (r.description || '').substring(0, 80);
    console.log(`${r.manufacturer_slug}/${r.slug} | ${r.name} | rows:${r.count} | ${desc}`);
  }
  console.log(`\n合計: ${seen.size}件`);
}
main();
