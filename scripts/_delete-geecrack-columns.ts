import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // コラムURLの確認
  const { data } = await sb.from('lures').select('id,slug,name,source_url')
    .eq('manufacturer_slug','geecrack').like('source_url','%column%');
  console.log('削除対象:');
  data?.forEach(r => console.log(` ${r.slug} | ${r.name} | ${r.source_url}`));
  
  if (!data?.length) { console.log('対象なし'); return; }
  
  // ユニークslugを削除
  const slugs = [...new Set(data.map(r => r.slug))];
  for (const slug of slugs) {
    const { error } = await sb.from('lures').delete()
      .eq('manufacturer_slug','geecrack').eq('slug',slug);
    if (error) console.log(`❌ ${slug}: ${error.message}`);
    else console.log(`✅ 削除: ${slug}`);
  }
}
main();
