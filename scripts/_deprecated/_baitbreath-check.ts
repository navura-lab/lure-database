import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  const {data} = await sb.from('lures').select('slug,source_url').eq('manufacturer_slug','baitbreath');
  if (!data) return;
  const unique = [...new Map(data.map(r => [r.slug, r.source_url])).entries()];
  unique.forEach(([slug, url]) => console.log(`${slug} | ${url}`));
}
main();
