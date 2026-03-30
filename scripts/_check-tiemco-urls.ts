import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('slug,name,source_url,description')
    .eq('manufacturer_slug','tiemco')
    .in('slug',['shumari-110f','suterusupeppa-110ssuroshinkingu'])
    .limit(5);
  // ユニーク化
  const seen = new Set();
  data?.forEach(r => {
    if (!seen.has(r.slug)) {
      seen.add(r.slug);
      console.log(r.slug, '|', r.name, '|', r.source_url);
    }
  });
}
main();
