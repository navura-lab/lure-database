import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
  
  // typeフィールドの実態確認（nullも含む）
  const {data: sample} = await sb.from('lures').select('name,type,target_fish').limit(20);
  console.log('SAMPLE:');
  sample!.forEach((r: any) => console.log(r.name, '|', r.type, '|', JSON.stringify(r.target_fish)));
  
  // typeがi字系、エギ以外に何があるか（全件）
  const {count} = await sb.from('lures').select('*', {count: 'exact', head: true}).is('type', null);
  console.log('type=null件数:', count);
}
main();
