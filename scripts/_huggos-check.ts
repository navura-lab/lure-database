import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('name, slug, manufacturer, type, target_fish, color_name, weight, length, price, description, action_type, diving_depth, is_limited').eq('slug', 'huggos');
  if (!data) return;

  const colors = new Set<string>();
  const weights = new Set<number>();
  const lengths = new Set<number>();
  const prices = new Set<number>();

  for (const l of data) {
    if (l.color_name) colors.add(l.color_name);
    if (l.weight) weights.add(l.weight);
    if (l.length) lengths.add(l.length);
    if (l.price) prices.add(l.price);
  }

  console.log(`Records: ${data.length}`);
  console.log(`Colors: ${colors.size} — ${[...colors].join(', ')}`);
  console.log(`Weights: ${[...weights].sort((a,b)=>a-b).join(', ')}g`);
  console.log(`Lengths: ${[...lengths].sort((a,b)=>a-b).join(', ')}mm`);
  console.log(`Prices: ¥${[...prices].sort((a,b)=>a-b).join(', ¥')}`);
  console.log(`Type: ${data[0]?.type}`);
  console.log(`Target fish: ${data[0]?.target_fish}`);
  console.log(`Action: ${data[0]?.action_type}`);
  console.log(`Depth: ${data[0]?.diving_depth}`);
  console.log(`Description: ${data[0]?.description?.slice(0, 500)}`);
}
main().catch(console.error);
