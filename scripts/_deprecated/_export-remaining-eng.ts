import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isEnglish(text: string): boolean {
  if (!text || text.length < 20) return false;
  let ascii = 0;
  for (const c of text) {
    if (c.charCodeAt(0) < 128) ascii++;
  }
  return ascii / text.length > 0.7;
}

const allEng: any[] = [];

for (const maker of ['strike-king', 'z-man', 'zoom']) {
  const { data } = await sb
    .from('lures')
    .select('slug, name, description, type, target_fish')
    .eq('manufacturer_slug', maker);
  
  const unique = new Map<string, any>();
  for (const r of data || []) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }
  
  const engItems = [...unique.values()].filter(r => isEnglish(r.description || ''));
  for (const item of engItems) {
    allEng.push({
      slug: item.slug,
      name: item.name,
      manufacturer_slug: maker,
      type: item.type,
      target_fish: item.target_fish,
      description: item.description
    });
  }
}

// 10件ずつバッチ分割
for (let i = 0; i < allEng.length; i += 10) {
  const batch = allEng.slice(i, i + 10);
  const batchNum = Math.floor(i / 10) + 1;
  writeFileSync(`/tmp/us-eng-batch-${batchNum}.json`, JSON.stringify(batch, null, 2));
  console.log(`us-eng-batch-${batchNum}.json: ${batch.length}件`);
}
console.log(`合計: ${allEng.length}件`);
