import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || '',
);

async function main() {
  // Get a sample of lures per type with images
  const typeMap = new Map<string, { count: number; image: string | null; example: string }>();

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('type, images, manufacturer_slug, slug')
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;

    for (const r of data) {
      if (!r.type) continue;
      const existing = typeMap.get(r.type);
      if (!existing) {
        const img = r.images?.[0] || null;
        typeMap.set(r.type, { count: 1, image: img, example: `${r.manufacturer_slug}/${r.slug}` });
      } else {
        existing.count++;
        if (!existing.image && r.images?.[0]) {
          existing.image = r.images[0];
          existing.example = `${r.manufacturer_slug}/${r.slug}`;
        }
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const sorted = [...typeMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  console.log('=== Top 12 Lure Types (by row count) ===');
  for (const [type, info] of sorted) {
    const shortImg = info.image ? info.image.substring(0, 90) : 'NO IMAGE';
    console.log(`${type} (${info.count}) → ${shortImg}`);
  }

  // Fish species
  const fishMap = new Map<string, number>();
  from = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('target_fish')
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      if (r.target_fish) {
        for (const f of r.target_fish) {
          fishMap.set(f, (fishMap.get(f) || 0) + 1);
        }
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const fishSorted = [...fishMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('\n=== Top 12 Fish Species ===');
  for (const [fish, count] of fishSorted) {
    console.log(`${fish} (${count})`);
  }

  // Top makers
  const makerMap = new Map<string, { name: string; count: number }>();
  from = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer, manufacturer_slug')
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      const e = makerMap.get(r.manufacturer_slug);
      if (e) e.count++;
      else makerMap.set(r.manufacturer_slug, { name: r.manufacturer, count: 1 });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const makerSorted = [...makerMap.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  console.log('\n=== Top 12 Makers ===');
  for (const m of makerSorted) {
    console.log(`${m.name} (${m.count})`);
  }
}

main();
