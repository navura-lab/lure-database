import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
  
  // ヒラメ・タチウオ・メバルがDBにあるか確認
  const targets = ['ヒラメ', 'タチウオ', 'メバル', 'クロダイ'];
  for (const fish of targets) {
    const {data, count} = await sb.from('lures').select('name,target_fish', {count: 'exact'}).contains('target_fish', [fish]);
    console.log(`${fish}: ${count}件`);
    if(data && data.length > 0) console.log('  例:', data[0].name, data[0].target_fish);
  }
}
main();
