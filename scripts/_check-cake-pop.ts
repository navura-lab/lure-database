import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data, error} = await sb.from('lures').select('manufacturer_slug, slug').eq('manufacturer_slug','6th-sense').ilike('slug','cake-pop%').limit(20);
  if (error) console.error(error);
  else console.log(JSON.stringify([...new Set(data?.map(r => r.slug))], null, 2));
}
main();
