import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // soft-bait を含むsource_urlを持つルアーを全件取得
  const { data } = await sb.from('lures').select('slug, name, type, source_url')
    .ilike('source_url', '%soft-bait%')
    .limit(100);
  
  const slugs = new Map<string, any>();
  for (const r of data || []) {
    if (!slugs.has(r.slug)) slugs.set(r.slug, r);
  }
  
  console.log(`=== soft-bait URL のルアー: ${slugs.size}件 ===`);
  for (const [slug, r] of slugs) {
    const typeOk = r.type === 'ワーム' || r.type === 'ソフトベイト';
    console.log(`${typeOk ? '✅' : '❌'} ${slug}: type=${r.type} name=${r.name}`);
  }
}
main();
