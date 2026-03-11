import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);
  
  // target_fishの全ユニーク値
  const {data: fish} = await sb.from('lures').select('target_fish').not('target_fish','is',null);
  const fishAll = new Set<string>();
  fish!.forEach((r: any) => {
    if (Array.isArray(r.target_fish)) r.target_fish.forEach((f: string) => fishAll.add(f));
    else if (typeof r.target_fish === 'string') fishAll.add(r.target_fish);
  });
  
  // typeの全ユニーク値
  const {data: types} = await sb.from('lures').select('type').not('type','is',null);
  const typeSet = new Set(types!.map((r: any) => r.type));
  
  console.log('FISH:', JSON.stringify([...fishAll].sort()));
  console.log('TYPES:', JSON.stringify([...typeSet].sort()));
}
main();
