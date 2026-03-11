import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const {count} = await sb.from('lures').delete({count:'exact'}).eq('manufacturer_slug','berkley-us').eq('slug','16-jar-bait-folder');
  console.log('deleted', count, 'rows');
}
main();
