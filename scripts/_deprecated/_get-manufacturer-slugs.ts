import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Get distinct manufacturer slugs using RPC or iterate with pagination
  const allSlugs = new Set<string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug')
      .range(from, from + pageSize - 1);

    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;

    for (const r of data) {
      allSlugs.add(r.manufacturer_slug);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const slugs = [...allSlugs].sort();
  console.log(JSON.stringify(slugs));
  console.log('Total manufacturers:', slugs.length);
}

main();
