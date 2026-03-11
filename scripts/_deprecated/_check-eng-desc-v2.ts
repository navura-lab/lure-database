import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isEnglish(text: string): boolean {
  if (!text || text.length < 20) return false;
  // Count ASCII vs non-ASCII
  let ascii = 0;
  for (const c of text) {
    if (c.charCodeAt(0) < 128) ascii++;
  }
  return ascii / text.length > 0.7; // 70%以上ASCII = 英語
}

for (const maker of ['strike-king', 'z-man', 'zoom']) {
  const { data } = await sb
    .from('lures')
    .select('slug, name, description')
    .eq('manufacturer_slug', maker);
  
  const unique = new Map<string, any>();
  for (const r of data || []) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }
  
  const engItems = [...unique.values()].filter(r => isEnglish(r.description || ''));
  
  console.log(`\n${maker}: ${unique.size}商品中、英語のまま=${engItems.length}件`);
  for (const r of engItems) {
    console.log(`  ${r.slug}: ${(r.description || '').substring(0, 60)}...`);
  }
}
