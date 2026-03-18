import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SLUGS = [
  'fs417', 'powerfluffy', 'kingbousougaeru', 'clear-s-popper', 'fable',
  'lazy-swimmer-9inch', 'kasuminokaeru', 'one-up-curly-35', 'toukichirou-lead',
  'ignited-tail-fusion', 'zagger-50-b1-bone', 'g-flash', 'tiny-kaishin',
  'nichika167f', 'vahid80-80', 'kattobi-bow130br', 'bosogaeru',
  'piccolo', 'one-up-shad-6-monotone', 'heddon-zarapuppy',
  'ebiran-bg', 'crawl-up', 'buttobi-kun95s', 'gyokotsu', 'rush-bell',
];

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

  for (const slug of SLUGS) {
    const { data } = await sb.from('lures')
      .select('name, slug, manufacturer, manufacturer_slug, type, target_fish, color_name, weight, length, price, description')
      .eq('slug', slug);

    if (!data || data.length === 0) continue;

    const colors = new Set(data.map(l => l.color_name).filter(Boolean));
    const weights = [...new Set(data.map(l => l.weight).filter(Boolean))].sort((a: any, b: any) => a - b);
    const prices = [...new Set(data.map(l => l.price).filter(Boolean))].sort((a: any, b: any) => a - b);

    console.log(`--- ${slug} ---`);
    console.log(`name: ${data[0].name}`);
    console.log(`mfr: ${data[0].manufacturer} (${data[0].manufacturer_slug})`);
    console.log(`type: ${data[0].type}`);
    console.log(`fish: ${data[0].target_fish}`);
    console.log(`colors: ${colors.size} [${[...colors].slice(0, 5).join(', ')}${colors.size > 5 ? '...' : ''}]`);
    console.log(`weights: ${weights.join(', ')}g`);
    console.log(`prices: ¥${prices.join(', ¥')}`);
    console.log(`records: ${data.length}`);
    console.log(`desc: ${data[0].description?.slice(0, 200) || 'N/A'}`);
    console.log();
  }
}
main().catch(console.error);
