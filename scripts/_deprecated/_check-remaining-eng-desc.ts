import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

for (const maker of ['strike-king', 'z-man', 'zoom']) {
  const { data } = await sb
    .from('lures')
    .select('slug, name, description')
    .eq('manufacturer_slug', maker);
  
  const unique = new Map<string, any>();
  for (const r of data || []) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }
  
  // 英語の説明文（先頭がASCII文字）をチェック
  const engItems = [...unique.values()].filter(r => {
    const desc = r.description || '';
    return desc.length > 0 && /^[A-Z]/.test(desc);
  });
  
  console.log(`${maker}: ${unique.size}商品中、英語説明文=${engItems.length}件`);
  if (engItems.length > 0) {
    engItems.slice(0, 3).forEach(r => console.log(`  ${r.slug}: ${(r.description || '').substring(0, 50)}...`));
    if (engItems.length > 3) console.log(`  ...他${engItems.length - 3}件`);
  }
}
