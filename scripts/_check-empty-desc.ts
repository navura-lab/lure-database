import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,name,description,source_url')
      .range(offset, offset+999);
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  const seen = new Map<string,any>();
  for (const r of all) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  const empty = [...seen.values()].filter(r => !r.description || r.description.trim() === '');
  console.log(`description空: ${empty.length}件`);
  const byMaker: Record<string,number> = {};
  empty.forEach(r => byMaker[r.manufacturer_slug] = (byMaker[r.manufacturer_slug]||0)+1);
  Object.entries(byMaker).sort((a,b)=>b[1]-a[1]).slice(0,20)
    .forEach(([m,c]) => console.log(`  ${m}: ${c}件`));
  
  // サンプル（source_url付き）
  console.log('\nサンプル:');
  empty.slice(0,8).forEach(r => console.log(`  ${r.manufacturer_slug}/${r.slug} | ${r.source_url?.substring(0,60)}`));
}
main();
