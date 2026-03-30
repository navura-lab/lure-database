import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('*')
    .eq('manufacturer_slug','mukai').limit(2);
  if (!data?.length) { console.log('mukaiデータなし'); return; }
  console.log('カラム:', Object.keys(data[0]));
  console.log('サンプル:', JSON.stringify(data[0], null, 2).substring(0,500));
}
main();
