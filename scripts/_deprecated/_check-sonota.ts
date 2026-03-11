import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const usbrands = ['strike-king', 'z-man', 'zoom', '6th-sense', 'berkley-us', 'livetarget', 'lunkerhunt', 'missile-baits', 'spro', 'googan-baits', 'lunker-city', 'riot-baits', 'xzone-lures'];

  const { data, error } = await sb.from('lures')
    .select('name, slug, manufacturer_slug, type, description')
    .in('manufacturer_slug', usbrands)
    .eq('type', 'その他')
    .order('manufacturer_slug');

  if (error) { console.error(error); process.exit(1); }

  // Deduplicate by slug
  const seen = new Map<string, any>();
  for (const r of data!) {
    const key = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(key)) seen.set(key, r);
  }

  console.log(`=== type=その他 (${seen.size}件ユニーク) ===\n`);
  for (const [key, r] of seen) {
    console.log(`${key} | ${r.name}`);
    console.log(`  desc: ${r.description?.substring(0, 80)}...`);
    console.log();
  }
}

main();
