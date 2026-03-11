import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const keywords = /\b(hat|cap|beanie|shirt|tee|hoodie|hoody|polo|jacket|bib|shorts|tank top|flannel|sleeve|apparel|glove|visor|eyewear|sunglasses|decal|sticker|banner|sign|backpack|bag|pack|pouch|binder|cooler|bottle|towel|ruler|knife|shears|scissors|gripper|lighter|flashlight|mat|pad|mouse pad|desk pad|catalog|rod\b|reel\b|replacement tail|replacement split|split ring|swivel|snap\b|weight stop|fish ruler|fillet knife|bundle|subscription|o-ring)/i;

async function main() {
  const brands = ['6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];
  const {data} = await sb.from('lures')
    .select('name, slug, manufacturer_slug, type')
    .in('manufacturer_slug', brands)
    .order('manufacturer_slug');

  const seen = new Map<string, any>();
  for (const r of data!) {
    const k = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(k)) seen.set(k, {...r, count: 1});
    else seen.get(k)!.count++;
  }

  const suspects = [...seen.values()].filter(r => keywords.test(r.name));
  if (suspects.length === 0) {
    console.log('非ルアー疑いなし ✅');
    return;
  }
  console.log(`非ルアー疑い: ${suspects.length}件`);
  suspects.forEach(r => console.log(`  ${r.manufacturer_slug}/${r.slug} | ${r.name} | type:${r.type} | rows:${r.count}`));
}
main();
