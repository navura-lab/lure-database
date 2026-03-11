import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('lures')
      .select('manufacturer_slug,name,slug,type,target_fish')
      .range(from, from + pageSize - 1)
      .order('id', { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // Group by manufacturer
  const makers = new Map<string, { types: Set<string>, fish: Set<string>, count: number }>();
  const seen = new Set<string>();
  for (const r of allData) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const m = makers.get(r.manufacturer_slug) || { types: new Set(), fish: new Set(), count: 0 };
    m.count++;
    if (r.type) m.types.add(r.type);
    if (Array.isArray(r.target_fish)) {
      for (const f of r.target_fish) m.fish.add(f);
    }
    makers.set(r.manufacturer_slug, m);
  }

  // Output as JSON
  const result: any[] = [];
  for (const [slug, data] of [...makers.entries()].sort((a, b) => b[1].count - a[1].count)) {
    result.push({
      slug,
      count: data.count,
      topTypes: [...data.types].slice(0, 5),
      topFish: [...data.fish].slice(0, 5),
    });
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
