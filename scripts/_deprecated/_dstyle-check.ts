import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.PUBLIC_SUPABASE_ANON_KEY as string
);

async function main() {
  const { data, error } = await sb
    .from('lures')
    .select('slug, name, type, color_name')
    .eq('manufacturer_slug', 'dstyle')
    .order('slug');

  if (error) {
    console.error(error);
    process.exit(1);
  }

  // slug単位でユニーク化
  const slugs = new Map<string, { slug: string; name: string; type: string; colors: number }>();
  for (const r of data) {
    const e = slugs.get(r.slug);
    if (e) {
      e.colors++;
    } else {
      slugs.set(r.slug, { slug: r.slug, name: r.name, type: r.type, colors: 1 });
    }
  }

  const list = [...slugs.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  console.log('Total unique slugs:', list.length);
  console.log('Total rows:', data.length);
  console.log('---');
  for (const s of list) {
    console.log(`${s.slug} | ${s.name} | type=${s.type} | colors=${s.colors}`);
  }
}

main();
