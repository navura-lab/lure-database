import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const brands = ['6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];
  const {data} = await sb.from('lures')
    .select('slug, manufacturer_slug, type')
    .in('manufacturer_slug', brands)
    .eq('type', 'その他')
    .order('manufacturer_slug');

  const seen = new Map<string, any>();
  for (const r of data!) {
    const k = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(k)) seen.set(k, {...r, count: 1});
    else seen.get(k)!.count++;
  }

  const byBrand: Record<string, number> = {};
  for (const [, r] of seen) {
    const b = r.manufacturer_slug;
    byBrand[b] = (byBrand[b] || 0) + 1;
  }

  console.log('type=その他 商品数（ブランド別）:');
  for (const [b, c] of Object.entries(byBrand).sort()) {
    console.log(`  ${b}: ${c}件`);
  }
  console.log(`合計: ${seen.size}件`);

  // Also count total items per brand
  const {data: all} = await sb.from('lures')
    .select('slug, manufacturer_slug')
    .in('manufacturer_slug', brands);
  const allSeen = new Map<string, boolean>();
  for (const r of all!) allSeen.set(r.manufacturer_slug + '/' + r.slug, true);
  const totalByBrand: Record<string, number> = {};
  for (const k of allSeen.keys()) {
    const b = k.split('/')[0];
    totalByBrand[b] = (totalByBrand[b] || 0) + 1;
  }
  console.log('\n全商品数（ブランド別）:');
  for (const [b, c] of Object.entries(totalByBrand).sort()) {
    const s = byBrand[b] || 0;
    console.log(`  ${b}: ${c}件 (その他: ${s}件, ${Math.round(s/c*100)}%)`);
  }
}
main();
