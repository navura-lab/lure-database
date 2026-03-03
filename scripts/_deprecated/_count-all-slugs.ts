import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const allSlugs = new Set<string>();
  const makers = new Set<string>();
  let from = 0;

  while (true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug').range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.slug && r.manufacturer_slug) {
        allSlugs.add(`${r.manufacturer_slug}/${r.slug}`);
        makers.add(r.manufacturer_slug);
      }
    }
    from += 1000;
  }

  console.log(`Total unique lure pages: ${allSlugs.size}`);
  console.log(`Total manufacturers: ${makers.size}`);
  console.log(`Expected total URLs: 1 (top) + ${makers.size} (makers) + ${allSlugs.size} (lures) = ${1 + makers.size + allSlugs.size}`);
  console.log(`\nSitemap currently has: 2,848 URLs`);
  console.log(`Missing from sitemap: ~${1 + makers.size + allSlugs.size - 2848} URLs`);
}

main().catch(console.error);
