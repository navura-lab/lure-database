import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const MAKERS = [
  'strike-king', 'z-man', 'zoom', '6th-sense', 'berkley-us',
  'livetarget', 'lunkerhunt', 'missile-baits', 'spro',
  'googan-baits', 'lunker-city', 'riot-baits', 'xzone-lures'
];

async function main() {
  let all: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('id, manufacturer_slug, slug, name, type, description')
      .eq('type', 'その他')
      .in('manufacturer_slug', MAKERS)
      .order('manufacturer_slug')
      .order('slug')
      .range(from, from + 999);

    if (error) { console.error(error); return; }
    all = all.concat(data!);
    if (data!.length < 1000) break;
    from += 1000;
  }

  // Group by manufacturer
  const grouped: Record<string, Map<string, any>> = {};
  for (const item of all) {
    if (!grouped[item.manufacturer_slug]) grouped[item.manufacturer_slug] = new Map();
    if (!grouped[item.manufacturer_slug].has(item.slug)) {
      grouped[item.manufacturer_slug].set(item.slug, item);
    }
  }

  for (const [maker, slugMap] of Object.entries(grouped)) {
    console.log(`\n=== ${maker} (${slugMap.size} unique slugs) ===`);
    for (const [slug, item] of slugMap) {
      const descShort = (item.description || '').substring(0, 80).replace(/\n/g, ' ');
      console.log(`  ${slug} | ${item.name} | ${descShort}`);
    }
  }

  const totalUnique = Object.values(grouped).reduce((s, m) => s + m.size, 0);
  console.log(`\n合計rows: ${all.length}, ユニークslug合計: ${totalUnique}`);
}

main();
