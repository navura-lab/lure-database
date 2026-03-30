import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  // マダイ関連のtarget_fish確認
  const {data} = await sb.from('lures').select('target_fish').ilike('target_fish', '%マダイ%').limit(3);
  console.log('マダイ:', data?.map(r => r.target_fish));
  
  // jighead系typeあるか
  const {data: jh} = await sb.from('lures').select('type').ilike('type', '%ジグヘッド%').limit(3);
  console.log('ジグヘッド type:', jh?.map(r=>r.type));
}
main();
