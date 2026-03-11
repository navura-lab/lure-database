import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

for (const maker of ['strike-king', 'z-man', 'zoom']) {
  const { data } = await sb
    .from('lures')
    .select('slug, type, target_fish')
    .eq('manufacturer_slug', maker);
  
  const unique = new Map<string, any>();
  for (const r of data || []) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }
  
  const items = [...unique.values()];
  const typeCount = new Map<string, number>();
  const fishCount = new Map<string, number>();
  
  for (const item of items) {
    const t = item.type || 'null';
    typeCount.set(t, (typeCount.get(t) || 0) + 1);
    const fish = item.target_fish;
    if (Array.isArray(fish)) {
      for (const f of fish) fishCount.set(f, (fishCount.get(f) || 0) + 1);
    } else {
      fishCount.set('null', (fishCount.get('null') || 0) + 1);
    }
  }
  
  console.log(`\n=== ${maker} (${items.length}商品) ===`);
  console.log('type分布:');
  [...typeCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, c]) => 
    console.log(`  ${t}: ${c}`)
  );
  console.log('target_fish分布:');
  [...fishCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([f, c]) => 
    console.log(`  ${f}: ${c}`)
  );
}
