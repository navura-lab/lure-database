import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { error, count } = await sb
    .from('lures')
    .update({ type: 'ワーム' })
    .eq('slug', 'hive-wacky-stick')
    .eq('manufacturer_slug', 'lunkerhunt');
  if (error) { console.error('❌', error.message); return; }
  console.log(`✅ hive-wacky-stick → ワーム に再分類完了`);
}
main();
