import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,name,description')
      .range(offset,offset+999);
    if (!data?.length) break;
    all.push(...data); offset+=data.length;
    if (data.length<1000) break;
  }
  const seen = new Map<string,any>();
  for (const r of all) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k) || (r.description?.length||0) > (seen.get(k).description?.length||0))
      seen.set(k, r);
  }
  const short = [...seen.values()].filter(r => r.description && r.description.length < 50 && r.description.trim().length > 0);
  const byMaker: Record<string,number> = {};
  short.forEach(r => byMaker[r.manufacturer_slug]=(byMaker[r.manufacturer_slug]||0)+1);
  console.log(`50文字未満: ${short.length}件`);
  Object.entries(byMaker).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .forEach(([m,c]) => console.log(`  ${m}: ${c}件`));
  console.log('\nサンプル10件:');
  short.slice(0,10).forEach(r => console.log(`  ${r.manufacturer_slug}/${r.slug}: "${r.description}"`));
}
main();
