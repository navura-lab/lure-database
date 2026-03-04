import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);
  
  // Count
  const {data} = await sb.from('lures').select('id', {count: 'exact'}).eq('manufacturer_slug', 'boreas');
  console.log(`BOREAS rows to delete: ${data?.length || 0}`);
  
  if (DRY_RUN) return;
  
  // Delete all BOREAS
  const {error, count} = await sb.from('lures').delete({count: 'exact'}).eq('manufacturer_slug', 'boreas');
  if (error) { console.log('Error:', error.message); return; }
  console.log(`Deleted ${count} rows`);
}
main();
