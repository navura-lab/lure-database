import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

for (const maker of ['z-man', 'zoom']) {
  const { data, error } = await sb
    .from('lures')
    .select('slug, name, description')
    .eq('manufacturer_slug', maker);
  
  if (error) {
    console.log(`${maker}: エラー - ${error.message}`);
    continue;
  }
  
  // slug単位で重複排除
  const unique = new Map<string, any>();
  for (const r of data || []) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }
  
  const items = [...unique.values()];
  const withDesc = items.filter(r => r.description && r.description.length > 0);
  const longDesc = items.filter(r => r.description && r.description.length > 250);
  const engDesc = items.filter(r => r.description && /^[A-Z]/.test(r.description));
  
  console.log(`\n=== ${maker} ===`);
  console.log(`  商品数(slug): ${items.length}`);
  console.log(`  説明文あり: ${withDesc.length}`);
  console.log(`  250文字超(未リライト): ${longDesc.length}`);
  console.log(`  英語説明文: ${engDesc.length}`);
  
  if (items.length > 0) {
    console.log(`  サンプル: ${items[0].slug} - ${(items[0].description || '').substring(0, 60)}...`);
  }
}
