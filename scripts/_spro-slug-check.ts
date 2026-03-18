import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, color_name, manufacturer_slug').eq('manufacturer_slug', 'spro').order('slug');
  if (!data) return;

  const groups = new Map<string, { name: string; colors: string[] }>();
  for (const r of data) {
    const g = groups.get(r.slug) || { name: r.name, colors: [] };
    g.colors.push(r.color_name || '(default)');
    groups.set(r.slug, g);
  }

  const singleColor = [...groups.entries()].filter(([_, g]) => g.colors.length === 1);

  console.log(`Total slugs: ${groups.size}, Single-color: ${singleColor.length}`);

  // 共通プレフィックスでグループ化
  const prefixMap = new Map<string, string[]>();
  for (const [slug] of singleColor) {
    const parts = slug.split('-');
    if (parts.length >= 3) {
      const prefix = parts.slice(0, Math.ceil(parts.length * 0.6)).join('-');
      const list = prefixMap.get(prefix) || [];
      list.push(slug);
      prefixMap.set(prefix, list);
    }
  }

  let suspect = 0;
  for (const [prefix, slugs] of [...prefixMap.entries()].sort((a,b) => b[1].length - a[1].length)) {
    if (slugs.length >= 2) {
      suspect += slugs.length;
      console.log(`\n${prefix} (${slugs.length}件):`);
      for (const s of slugs.slice(0, 8)) {
        const g = groups.get(s)!;
        console.log(`  ${s} → ${g.name} [${g.colors[0]}]`);
      }
      if (slugs.length > 8) console.log(`  ... +${slugs.length - 8}件`);
    }
  }
  console.log(`\nカラー別登録疑い: ${suspect}件 / ${singleColor.length}件(single-color)`);
}
main().catch(console.error);
