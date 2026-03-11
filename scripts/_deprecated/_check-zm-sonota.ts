import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const { data } = await sb
  .from('lures')
  .select('slug, name, type, description')
  .eq('manufacturer_slug', 'z-man')
  .eq('type', 'その他');

const unique = new Map<string, any>();
for (const r of data || []) {
  if (!unique.has(r.slug)) unique.set(r.slug, r);
}

for (const item of unique.values()) {
  console.log(`${item.slug} | ${item.name} | ${(item.description || '').substring(0, 80)}...`);
}
