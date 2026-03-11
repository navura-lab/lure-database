import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const sb = createClient(url, key);
  const {data, error} = await sb.from('lures').select('*').limit(1);
  if (error) { console.error('Error:', error); process.exit(1); }
  if (data && data.length > 0) console.log(Object.keys(data[0]).sort().join('\n'));
}
main();
