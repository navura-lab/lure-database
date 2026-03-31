import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const targets: any[] = [];
  
  const makers = ['bassday','zipbaits','crazy-ocean','pazdesign','yamashita','ima','sawamura','deps'];
  for (const maker of makers) {
    let all: any[] = [], offset = 0;
    while(true) {
      const { data } = await sb.from('lures').select('slug,name,description,type,target_fish')
        .eq('manufacturer_slug', maker).range(offset, offset+999);
      if (!data?.length) break;
      all.push(...data);
      offset += data.length;
      if (data.length < 1000) break;
    }
    const seen = new Map<string,any>();
    for (const r of all) {
      const k = r.slug;
      if (!seen.has(k) || (r.description?.length||0) > (seen.get(k).description?.length||0))
        seen.set(k, { ...r, manufacturer_slug: maker });
    }
    const long = [...seen.values()].filter(r => (r.description?.length||0) > 250);
    targets.push(...long);
  }
  
  console.log(`対象: ${targets.length}件`);
  
  // 5件ずつバッチ分割
  const batches = [];
  for (let i = 0; i < targets.length; i += 8) batches.push(targets.slice(i, i+8));
  
  for (let i = 0; i < batches.length; i++) {
    writeFileSync(`/tmp/ja-rewrite-batch-${i+1}.json`, JSON.stringify(batches[i], null, 2));
  }
  console.log(`${batches.length}バッチ生成完了`);
  targets.slice(0,5).forEach(r => console.log(`  ${r.manufacturer_slug}/${r.slug}: ${r.description?.length}文字`));
}
main();
