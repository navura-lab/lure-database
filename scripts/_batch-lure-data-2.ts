import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SLUGS = [
  'dex-cr53mr','momopunch30g-45g','usachanjig-ex','money-badger-4-5-625-675-725',
  'shiriten50','boom','bakuree-fish-62','sw133f','gig110s-umisakura-sp',
  'dex-choppo-90120-90120','snecon-220s','esnal','trout-btkswimmer35',
  'surface-wing95f','shalldus-35','fs430','greed3040','rein-14g',
  'nitro-vertical','viva-potato','giopick-qr','35mr-s',
  'one-up-shad-5-2tone','kaishin-blade','lft145',
];

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  for (const slug of SLUGS) {
    const { data } = await sb.from('lures')
      .select('name, slug, manufacturer, manufacturer_slug, type, target_fish, color_name, weight, price, description')
      .eq('slug', slug).limit(50);
    if (!data || data.length === 0) continue;
    const colors = new Set(data.map(l => l.color_name).filter(Boolean));
    const weights = [...new Set(data.map(l => l.weight).filter(Boolean))].sort((a:any,b:any)=>a-b);
    const prices = [...new Set(data.map(l => l.price).filter(Boolean))].sort((a:any,b:any)=>a-b);
    console.log(`--- ${slug} ---`);
    console.log(`name: ${data[0].name}`);
    console.log(`mfr: ${data[0].manufacturer} (${data[0].manufacturer_slug})`);
    console.log(`type: ${data[0].type}`);
    console.log(`fish: ${data[0].target_fish}`);
    console.log(`colors: ${colors.size}`);
    console.log(`weights: ${weights.join(',')}g`);
    console.log(`prices: ¥${prices.join(',¥')}`);
    console.log(`desc: ${data[0].description?.slice(0,150)||'N/A'}`);
    console.log();
  }
}
main().catch(console.error);
