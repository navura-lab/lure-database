import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
  const {data: fish} = await sb.from('lures').select('target_fish').not('target_fish','is',null);
  const {data: types} = await sb.from('lures').select('type').not('type','is',null);
  const fishSet = [...new Set(fish!.map((r: any)=>r.target_fish))].sort();
  const typeSet = [...new Set(types!.map((r: any)=>r.type))].sort();
  console.log('FISH:', JSON.stringify(fishSet));
  console.log('TYPES:', JSON.stringify(typeSet));
}
main();
