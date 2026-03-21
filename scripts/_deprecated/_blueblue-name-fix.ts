import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('id, manufacturer').eq('manufacturer_slug', 'blueblue').limit(1);
  console.log('Current:', data?.[0]?.manufacturer);
  
  const { data: updated, error } = await sb.from('lures')
    .update({ manufacturer: 'BlueBlue' })
    .eq('manufacturer_slug', 'blueblue')
    .select('id');
  console.log(`Updated: ${updated?.length} records, error: ${error?.message || 'none'}`);
}
main();
