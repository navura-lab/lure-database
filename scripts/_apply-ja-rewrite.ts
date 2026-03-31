import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const all: any[] = [];
  for (let i = 1; i <= 7; i++) {
    const data = JSON.parse(readFileSync(`/tmp/ja-rewrite-result-${i}.json`, 'utf-8'));
    all.push(...data);
  }
  console.log(`書き込み対象: ${all.length}件`);

  let ok = 0, ng = 0;
  for (const r of all) {
    if (!r.description || r.description.length < 100) { console.log(`⚠️ スキップ: ${r.slug} (${r.description?.length}文字)`); ng++; continue; }
    const { error } = await sb.from('lures').update({ description: r.description })
      .eq('manufacturer_slug', r.manufacturer_slug).eq('slug', r.slug);
    if (error) { console.log(`❌ ${r.slug}: ${error.message}`); ng++; }
    else ok++;
  }
  console.log(`\n完了: 成功${ok}件, スキップ/エラー${ng}件`);
}
main().catch(e => { console.error(e); process.exit(1); });
