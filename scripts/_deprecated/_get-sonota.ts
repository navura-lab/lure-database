import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const US_MAKERS = ['strike-king','z-man','zoom','6th-sense','berkley-us','livetarget','lunkerhunt','missile-baits','spro','googan-baits','lunker-city','riot-baits','xzone-lures'];

async function main() {
  // Fetch all in pages of 1000
  let allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug, slug, name, type, description')
      .eq('type', 'その他')
      .in('manufacturer_slug', US_MAKERS)
      .order('manufacturer_slug')
      .order('slug')
      .range(offset, offset + 999);
    if (error) { console.error(error); return; }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const seen = new Map<string, any>();
  for (const r of allData) {
    const key = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(key)) seen.set(key, r);
  }

  // Group by maker
  const byMaker = new Map<string, any[]>();
  for (const [, r] of seen) {
    if (!byMaker.has(r.manufacturer_slug)) byMaker.set(r.manufacturer_slug, []);
    byMaker.get(r.manufacturer_slug)!.push(r);
  }

  // Output just maker + slug + name (compact)
  for (const [maker, items] of byMaker) {
    console.log(`\n=== ${maker} (${items.length}) ===`);
    for (const item of items) {
      console.log(`  ${item.slug} | ${item.name}`);
    }
  }
  console.log(`\nTotal unique slugs: ${seen.size}, Total rows: ${allData.length}`);
}

main();
