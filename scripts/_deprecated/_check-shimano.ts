import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Count shimano rows
  const { count } = await sb.from('lures').select('id', { count: 'exact' }).eq('manufacturer_slug', 'shimano');
  console.log(`Shimano rows in DB: ${count}`);

  // Count per manufacturer using pagination
  const counts: Record<string, number> = {};
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await sb.from('lures').select('manufacturer_slug').range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    for (const row of data) {
      counts[row.manufacturer_slug] = (counts[row.manufacturer_slug] || 0) + 1;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log('\nAll manufacturers:');
  let total = 0;
  for (const [slug, cnt] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug}: ${cnt} rows`);
    total += cnt;
  }
  console.log(`  TOTAL: ${total} rows`);
}
main().catch(console.error);
