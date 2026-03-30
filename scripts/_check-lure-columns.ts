import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  const { data, error } = await sb.from('lures').select('*').limit(1);
  if (error) { console.error(error); return; }
  console.log('カラム一覧:', Object.keys(data![0]));

  // jackall/speed-vib を確認
  const { data: d2, error: e2 } = await sb.from('lures').select('name, slug, manufacturer_slug').eq('manufacturer_slug', 'jackall').eq('slug', 'speed-vib').limit(3);
  console.log('jackall/speed-vib:', e2 || JSON.stringify(d2));

  // luckycraft/wander を確認
  const { data: d3, error: e3 } = await sb.from('lures').select('name, slug, manufacturer_slug').eq('manufacturer_slug', 'luckycraft').eq('slug', 'wander').limit(3);
  console.log('luckycraft/wander:', e3 || JSON.stringify(d3));
}
main().catch(console.error);
