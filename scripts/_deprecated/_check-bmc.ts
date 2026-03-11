import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const {data} = await sb.from('lures')
    .select('name, slug, type, price, images, color')
    .eq('slug', 'bmc')
    .eq('manufacturer_slug', 'xzone-lures');
  console.log(JSON.stringify(data, null, 2));
}
main();
