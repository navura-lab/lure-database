import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const {data} = await sb.from('lures').select('name, slug, description').eq('manufacturer_slug','berkley-us').eq('slug','16-jar-bait-folder').limit(1);
  console.log(data?.[0]?.name, '|', (data?.[0]?.description||'').substring(0,150));
}
main();
