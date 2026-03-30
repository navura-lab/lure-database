import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const {data} = await sb.from('lures').select('type').eq('type', 'ジグヘッド').limit(1);
  console.log('ジグヘッド存在:', data?.length > 0);
}
main();
