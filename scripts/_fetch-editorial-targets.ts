import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

const targets = [
  { slug: 'raxma-55s', mfr: 'valkein' },
  { slug: 'hadesu-75f', mfr: 'bassday' },
  { slug: 'uzvycfp', mfr: 'daiwa' },
  { slug: 'sobat-100', mfr: 'ima' },
  { slug: 'usahuwa', mfr: 'attic' },
  { slug: 'sauza-s60', mfr: 'maria' },
  { slug: 'powerbait-maxscent-flatworm-36inch-36', mfr: 'berkley' },
  { slug: 'crush-series', mfr: '6th-sense' },
  { slug: 'jns3ciz', mfr: 'daiwa' },
  { slug: 'astrar', mfr: 'valkein' },
];

async function main() {
  const allTypeCounts: Record<string, { total: number; avgColors: number }> = {};

  for (const t of targets) {
    const { data, error } = await sb.from('lures')
      .select('name, slug, manufacturer_slug, manufacturer, type, weight, length, color_name, description, target_fish, price, images, action_type, diving_depth')
      .eq('slug', t.slug)
      .eq('manufacturer_slug', t.mfr);

    if (error) { console.error(t.slug, error); continue; }
    if (!data || data.length === 0) { console.error(`No data for ${t.mfr}/${t.slug}`); continue; }

    const colors = [...new Set(data.map((r: any) => r.color_name).filter(Boolean))];
    const weights = [...new Set(data.map((r: any) => r.weight).filter(Boolean))].sort((a, b) => a - b);
    const lengths = [...new Set(data.map((r: any) => r.length).filter(Boolean))].sort((a, b) => a - b);
    const prices = [...new Set(data.map((r: any) => r.price).filter(Boolean))].sort((a, b) => a - b);
    const desc = data[0]?.description || '';
    const targetFish = data[0]?.target_fish || [];
    const type = data[0]?.type || '';
    const actionType = data[0]?.action_type || '';
    const divingDepth = data[0]?.diving_depth || '';

    // Get type stats (limited query)
    if (type && !allTypeCounts[type]) {
      const { data: typeData } = await sb.from('lures')
        .select('slug, manufacturer_slug, color_name')
        .eq('type', type)
        .limit(1000);

      const slugSet = new Set<string>();
      const colorCounts: Record<string, number> = {};
      typeData?.forEach((r: any) => {
        const key = `${r.manufacturer_slug}/${r.slug}`;
        slugSet.add(key);
        if (r.color_name) {
          colorCounts[key] = (colorCounts[key] || 0) + 1;
        }
      });
      const avgColors = Object.values(colorCounts).length > 0
        ? Object.values(colorCounts).reduce((a, b) => a + b, 0) / slugSet.size
        : 0;

      allTypeCounts[type] = { total: slugSet.size, avgColors: Math.round(avgColors * 10) / 10 };
    }

    console.log(JSON.stringify({
      slug: t.slug,
      mfr: t.mfr,
      name: data[0]?.name,
      manufacturer: data[0]?.manufacturer,
      type,
      rows: data.length,
      colors: colors.length,
      colorSamples: colors.slice(0, 8),
      weights,
      lengths,
      prices,
      description: desc,
      target_fish: targetFish,
      actionType,
      divingDepth,
      typeStats: allTypeCounts[type],
    }));
  }
}

main().catch(console.error);
