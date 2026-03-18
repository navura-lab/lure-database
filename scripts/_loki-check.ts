import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('name, slug, manufacturer, type, target_fish, color_name, weight, length, price, description').eq('slug', 'masukurouto-loki');
  if (!data || data.length === 0) {
    const { data: d2 } = await sb.from('lures').select('name, slug').ilike('name', '%ロキ%').eq('manufacturer', 'Nories').limit(5);
    console.log('Search results:', d2);
    return;
  }
  const colors = new Set(data.map(l => l.color_name).filter(Boolean));
  const weights = new Set(data.map(l => l.weight).filter(Boolean));
  console.log(`Records: ${data.length}`);
  console.log(`Colors: ${colors.size} — ${[...colors].join(', ')}`);
  console.log(`Weights: ${[...weights].sort((a:any,b:any)=>a-b).join(', ')}g`);
  console.log(`Type: ${data[0]?.type}`);
  console.log(`Target: ${data[0]?.target_fish}`);
  console.log(`Price: ¥${data[0]?.price}`);
  console.log(`Desc: ${data[0]?.description?.slice(0, 300)}`);
}
main().catch(console.error);
