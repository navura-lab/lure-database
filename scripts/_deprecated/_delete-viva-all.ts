import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // 先に件数確認
  const { count } = await sb
    .from('lures')
    .select('id', { count: 'exact', head: true })
    .eq('manufacturer_slug', 'viva');

  console.log(`VIVA行数: ${count}`);

  // バッチ削除（Supabaseは1回1000件制限）
  let deleted = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .delete()
      .eq('manufacturer_slug', 'viva')
      .select('id')
      .limit(1000);

    if (error) {
      console.error('削除エラー:', error);
      break;
    }
    if (!data || data.length === 0) break;
    deleted += data.length;
    console.log(`削除: ${data.length}件 (計 ${deleted}件)`);
  }

  console.log(`\n完了: ${deleted}件削除`);

  // 確認
  const { count: remaining } = await sb
    .from('lures')
    .select('id', { count: 'exact', head: true })
    .eq('manufacturer_slug', 'viva');
  console.log(`残り: ${remaining}件`);
}

main();
