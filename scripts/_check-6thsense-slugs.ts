import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY!
);

async function main() {
  const allSlugs = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug')
      .eq('manufacturer_slug', '6th-sense')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    data.forEach(r => allSlugs.add(r.slug));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(JSON.stringify([...allSlugs].sort()));
}

main().catch(console.error);
