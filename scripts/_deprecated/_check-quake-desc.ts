import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data } = await sb.from('lures')
    .select('slug, description')
    .eq('manufacturer_slug', '6th-sense')
    .like('slug', 'quake%')
    .order('slug');

  const seen = new Map<string, any>();
  for (const r of data!) {
    if (!seen.has(r.slug)) seen.set(r.slug, r);
  }
  for (const [slug, r] of seen) {
    const desc = (r.description || '').substring(0, 80);
    console.log(`${slug}: ${desc}...`);
  }
  console.log(`\nユニーク: ${seen.size}件`);

  // description完全一致チェック（先頭200文字）
  const descGroups = new Map<string, string[]>();
  for (const [slug, r] of seen) {
    const d = (r.description || '').substring(0, 200).trim();
    if (d.length < 20) continue;
    if (!descGroups.has(d)) descGroups.set(d, []);
    descGroups.get(d)!.push(slug);
  }
  let totalGrouped = 0;
  for (const [desc, slugs] of descGroups) {
    if (slugs.length >= 2) {
      console.log(`\n同一desc (${slugs.length}件): ${desc.substring(0, 60)}...`);
      slugs.slice(0, 5).forEach(s => console.log(`  ${s}`));
      if (slugs.length > 5) console.log(`  ... +${slugs.length - 5}件`);
      totalGrouped += slugs.length;
    }
  }
  console.log(`\n同一descグループのslug合計: ${totalGrouped}`);
}
main();
