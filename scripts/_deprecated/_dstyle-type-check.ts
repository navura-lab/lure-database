/**
 * DSTYLEタイプ分類チェック
 * slug単位でユニーク化し、typeごとにグルーピングして表示
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.PUBLIC_SUPABASE_ANON_KEY as string
);

async function main() {
  const { data, error } = await sb
    .from('lures')
    .select('slug, name, type')
    .eq('manufacturer_slug', 'dstyle')
    .order('slug');

  if (error) { console.error(error); process.exit(1); }

  // slug単位でユニーク化
  const slugMap = new Map<string, { slug: string; name: string; type: string }>();
  for (const r of data) {
    if (!slugMap.has(r.slug)) {
      slugMap.set(r.slug, { slug: r.slug, name: r.name, type: r.type });
    }
  }

  // typeごとにグルーピング
  const byType = new Map<string, Array<{ slug: string; name: string }>>();
  for (const s of slugMap.values()) {
    const list = byType.get(s.type) || [];
    list.push({ slug: s.slug, name: s.name });
    byType.set(s.type, list);
  }

  for (const [type, items] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n=== ${type} (${items.length}件) ===`);
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  ${item.name}`);
    }
  }
}

main();
