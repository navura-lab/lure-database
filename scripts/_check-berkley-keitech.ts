import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  for (const maker of ['berkley-us','keitech','carpenter']) {
    const { data } = await sb.from('lures').select('slug,name,source_url')
      .eq('manufacturer_slug',maker).or('description.is.null,description.eq.').limit(3);
    const seen = new Set<string>();
    const uniq = (data||[]).filter(r => { if(seen.has(r.slug)) return false; seen.add(r.slug); return true; });
    uniq.forEach(r => console.log(`${maker}: ${r.slug} | ${r.source_url?.substring(0,70)}`));
  }
}
main();
