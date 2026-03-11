import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const brands = ['6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];

  const {data, error} = await sb.from('lures')
    .select('id, name, slug, manufacturer_slug, type')
    .in('manufacturer_slug', brands)
    .order('manufacturer_slug');

  if (error) { console.error(error); process.exit(1); }

  // Group by slug
  const seen = new Map<string, any>();
  for (const r of data!) {
    const key = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(key)) seen.set(key, {...r, count: 1});
    else seen.get(key)!.count++;
  }

  // Non-lure keywords
  const nonLureKeywords = ['rod', 'reel', 'shears', 'scissors', 'jacket', 'hoodie', 'hat', 'cap', 'shirt', 'sleeve', 'apparel', 'box', 'tackle', 'replacement tail', 'bundle', 'combo', 'tool', 'glove', 'sunglasses', 'bag', 'backpack', 'lanyard', 'sticker', 'decal', 'towel', 'gaiter', 'spool'];

  const suspects = [...seen.values()].filter(r => {
    const nameLower = r.name.toLowerCase();
    const isOther = r.type === 'その他';
    const matchesKeyword = nonLureKeywords.some(kw => nameLower.includes(kw));
    return isOther || matchesKeyword;
  });

  console.log(`=== 非ルアー疑い (${suspects.length}件) ===`);
  suspects.forEach(r => {
    const icon = r.type === 'その他' ? '⚠️' : '🔍';
    console.log(`${icon} ${r.manufacturer_slug}/${r.slug} | ${r.name} | type: ${r.type} | rows: ${r.count}`);
  });

  console.log(`\n=== 全${seen.size}商品中 ===`);
}

main();
