import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const makers = ['palms','jackall','megabass','evergreen','osp','ima','shimano','daiwa','duo','jackson'];
  const allData: any[] = [];

  for (const maker of makers) {
    let page = 0;
    while (true) {
      const { data, error } = await sb.from('lures').select('manufacturer_slug, slug, name, type, target_fish')
        .eq('manufacturer_slug', maker)
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (error) { console.error(maker, error); break; }
      if (!data || data.length === 0) break;
      allData.push(...data);
      if (data.length < 1000) break;
      page++;
    }
  }

  // Deduplicate by slug
  const seen = new Map<string, any>();
  for (const r of allData) {
    const key = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(key)) seen.set(key, r);
  }

  const unique = [...seen.values()];
  console.log('Total unique products:', unique.length);
  for (const maker of makers) {
    const count = unique.filter((r: any) => r.manufacturer_slug === maker).length;
    console.log(maker + ':', count);
  }

  fs.writeFileSync('/tmp/maker-products-db.json', JSON.stringify(unique, null, 2));
  console.log('Written to /tmp/maker-products-db.json');
}

main().catch(console.error);
