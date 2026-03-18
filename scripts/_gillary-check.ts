import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('name, slug, manufacturer, type, target_fish, color_name, weight, length, price, description').eq('slug', 'gillary-01--01');
  if (!data || data.length === 0) {
    // slugが違うかも
    const { data: d2 } = await sb.from('lures').select('name, slug, manufacturer, type, target_fish, color_name, weight, length, price, description').ilike('name', '%gillary%').limit(5);
    if (d2) {
      console.log('Found by name search:');
      const slugs = new Set(d2.map(l => l.slug));
      for (const s of slugs) console.log('  slug:', s, 'name:', d2.find(l => l.slug === s)?.name);
      // Get full data for the first slug
      const slug = [...slugs][0];
      const { data: d3 } = await sb.from('lures').select('name, slug, manufacturer, type, target_fish, color_name, weight, length, price, description').eq('slug', slug);
      if (d3) {
        const colors = new Set(d3.map(l => l.color_name).filter(Boolean));
        const weights = new Set(d3.map(l => l.weight).filter(Boolean));
        const prices = new Set(d3.map(l => l.price).filter(Boolean));
        console.log(`\nRecords: ${d3.length}`);
        console.log(`Colors: ${colors.size} — ${[...colors].join(', ')}`);
        console.log(`Weights: ${[...weights].sort((a,b)=>a-b).join(', ')}g`);
        console.log(`Prices: ¥${[...prices].sort((a,b)=>a-b).join(', ¥')}`);
        console.log(`Type: ${d3[0]?.type}`);
        console.log(`Target fish: ${d3[0]?.target_fish}`);
        console.log(`Description: ${d3[0]?.description?.slice(0, 400)}`);
      }
    }
    return;
  }
  const colors = new Set(data.map(l => l.color_name).filter(Boolean));
  const weights = new Set(data.map(l => l.weight).filter(Boolean));
  const prices = new Set(data.map(l => l.price).filter(Boolean));
  console.log(`Records: ${data.length}`);
  console.log(`Colors: ${colors.size} — ${[...colors].join(', ')}`);
  console.log(`Weights: ${[...weights].sort((a:any,b:any)=>a-b).join(', ')}g`);
  console.log(`Prices: ¥${[...prices].sort((a:any,b:any)=>a-b).join(', ¥')}`);
  console.log(`Type: ${data[0]?.type}`);
  console.log(`Target fish: ${data[0]?.target_fish}`);
  console.log(`Description: ${data[0]?.description?.slice(0, 400)}`);
}
main().catch(console.error);
