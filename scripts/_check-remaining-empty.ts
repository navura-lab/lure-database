import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  for (const maker of ['ecogear','berkley','jackall','daiwa','ima','osp','duo','viva']) {
    const { data } = await sb.from('lures').select('slug,source_url')
      .eq('manufacturer_slug', maker).or('description.is.null,description.eq.').limit(2);
    const seen = new Set<string>();
    const uniq = data?.filter(r => { if(seen.has(r.slug)) return false; seen.add(r.slug); return true; });
    if (uniq?.length) {
      console.log(`${maker}(${uniq.length}件): ${uniq[0].source_url?.substring(0,70)}`);
    }
  }
}
main();
