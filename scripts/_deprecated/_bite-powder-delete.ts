import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // Bite Powder削除
  const { data, error } = await sb.from('lures').delete().eq('slug', 'bite-powder-or-bite-liquid').select('id');
  console.log(`Bite Powder deleted: ${data?.length || 0} records, error: ${error?.message || 'none'}`);
  
  // NON_LURE_PATTERNSに追加すべきキーワード確認
  // bite powder, bite liquid, attractant, scent → 非ルアー
}
main().catch(console.error);
