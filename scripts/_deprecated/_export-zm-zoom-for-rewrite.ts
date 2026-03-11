import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

for (const maker of ['z-man', 'zoom']) {
  const { data } = await sb
    .from('lures')
    .select('slug, name, description, type, target_fish')
    .eq('manufacturer_slug', maker);
  
  // slug単位で重複排除
  const unique = new Map<string, any>();
  for (const r of data || []) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }
  
  const items = [...unique.values()].filter(r => r.description && /[a-zA-Z]/.test(r.description));
  
  // 10件ずつバッチ分割
  const batches = [];
  for (let i = 0; i < items.length; i += 10) {
    batches.push(items.slice(i, i + 10));
  }
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i].map(r => ({
      slug: r.slug,
      name: r.name,
      manufacturer_slug: maker,
      type: r.type,
      target_fish: r.target_fish,
      description: r.description
    }));
    writeFileSync(`/tmp/${maker}-batch-${i + 1}.json`, JSON.stringify(batch, null, 2));
    console.log(`${maker}-batch-${i + 1}.json: ${batch.length}件`);
  }
}
