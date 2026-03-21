import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, color_name, images, source_url').eq('slug', 'kuttail4').limit(5);
  if (!data) return;
  console.log(`Records: ${data.length}`);
  for (const r of data.slice(0, 3)) {
    console.log(`  color: ${r.color_name}`);
    console.log(`  images: ${JSON.stringify(r.images?.slice(0, 3))}`);
    console.log(`  source: ${r.source_url}`);
  }
}
main();
