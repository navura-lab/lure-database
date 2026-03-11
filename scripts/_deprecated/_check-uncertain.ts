import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const items = [
    { manufacturer_slug: '6th-sense', slug: 'my-boy-blue-youth-kids' },
    { manufacturer_slug: 'lunkerhunt', slug: 'hive-typhon' },
    { manufacturer_slug: 'lunkerhunt', slug: 'link' },
    { manufacturer_slug: 'lunkerhunt', slug: 'nose-down-straight-up' },
    { manufacturer_slug: 'xzone-lures', slug: 'bmc' },
  ];

  for (const item of items) {
    const { data, error } = await sb.from('lures')
      .select('manufacturer_slug, slug, name, type, description')
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug)
      .limit(1);
    if (error) { console.error(error); continue; }
    if (!data || data.length === 0) { console.log(`NOT FOUND: ${item.manufacturer_slug}/${item.slug}`); continue; }
    const r = data[0];
    console.log(`\n=== ${r.manufacturer_slug}/${r.slug} ===`);
    console.log(`name: ${r.name}`);
    console.log(`type: ${r.type}`);
    console.log(`desc: ${(r.description || '(none)').substring(0, 500)}`);
  }
}

main();
