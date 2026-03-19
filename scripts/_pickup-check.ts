import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, color_name, images, type, description, manufacturer, manufacturer_slug').eq('manufacturer_slug', 'pickup');
  if (!data) return;
  console.log(`PICKUP total: ${data.length} records`);
  const slugs = new Map<string, any[]>();
  for (const r of data) {
    const g = slugs.get(r.slug) || [];
    g.push(r);
    slugs.set(r.slug, g);
  }
  console.log(`Unique slugs: ${slugs.size}\n`);
  
  // カラー別slug疑い（1レコードのslugで、似たプレフィックスが複数ある）
  const allSlugs = [...slugs.keys()];
  for (const slug of allSlugs) {
    if (slug.includes('wasupusuraromu') || slug.includes('suraromu')) {
      const records = slugs.get(slug)!;
      console.log(`${slug}: ${records.length}件 | color:${records[0].color_name} | name:${records[0].name}`);
    }
  }
  
  // 全slug表示（問題の全体像把握）
  console.log('\n=== 全slug ===');
  for (const [slug, records] of [...slugs.entries()].slice(0, 30)) {
    console.log(`  ${slug}: ${records.length}件 | ${records[0].name} | color:${records[0].color_name || '(default)'}`);
  }
  if (slugs.size > 30) console.log(`  ... +${slugs.size - 30} more`);
}
main().catch(console.error);
