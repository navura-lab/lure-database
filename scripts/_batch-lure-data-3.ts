import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const SLUGS = [
  '4-front-flapper-curly','outstar-120s','petit-bomber70s','sj-pencil',
  'jigaro-superslide','briliant12','messiah-semilong','aw-offset-sinker',
  'petit-bomber70ss-sl','dex-cr55sr','helter-twister','hydram-100s',
  'furifuri-usachan-jig','plapan','sw-slider-shad-15-15',
  'gulp-saltwater-isome-gokubuto-4inch-4','i-fish-ft','yarukinashi-stick-93',
  'k2rp','one-up-shad-3-2tone','power-wiggler-55inch-55','flap-slj',
  'over-ride','flesh-back-80sp','gorgon-custom-125188','pokopokocrapea-area',
  'fallstick4','erda-zero-innovator','black-blast','dowzvido',
  'gutter-jig-super-slice','qeirw28','likeavalon','a-flash',
  'deco-cut','sw-bubble-creature-36inchsw36','bakuree-spin-8','vm60s',
  'saltwater-pulse-worm38inch-38','fall-stick3','spark-tenya',
  'zagger-65-b1-bone','usakura',
];
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  for (const slug of SLUGS) {
    const { data } = await sb.from('lures')
      .select('name, slug, manufacturer, manufacturer_slug, type, target_fish, color_name, weight, price, description')
      .eq('slug', slug).limit(20);
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
    console.log(`desc: ${data[0].description?.slice(0,120)||'N/A'}`);
    console.log();
  }
}
main().catch(console.error);
