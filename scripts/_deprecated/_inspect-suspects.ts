import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const {data} = await sb.from('lures')
    .select('name, slug, manufacturer_slug, type, description')
    .eq('manufacturer_slug', '6th-sense')
    .eq('type', 'その他')
    .order('slug');

  // dedupe by slug
  const seen = new Map<string, any>();
  for (const r of data!) { if (!seen.has(r.slug)) seen.set(r.slug, r); }

  for (const [slug, r] of seen) {
    const desc = (r.description || '').substring(0, 150);
    console.log(`${slug} | ${r.name}`);
    console.log(`  ${desc}`);
    console.log('---');
  }
  console.log(`合計: ${seen.size}件`);
}
main();
