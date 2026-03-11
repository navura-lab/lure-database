import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  const { data } = await sb.from('lures').select('*').limit(1);
  console.log(Object.keys(data![0]));
}
main();
