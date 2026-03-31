import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,description')
      .range(offset, offset+999);
    if (!data?.length) break;
    all = [...all, ...data];
    offset += data.length;
    if (data.length < 1000) break;
  }
  // slug単位でユニーク化
  const seen = new Map<string,any>();
  for (const r of all) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  const long = [...seen.values()].filter(r => r.description && r.description.length > 250);
  console.log(`250文字超: ${long.length}件`);
  // メーカー別集計
  const byMaker: Record<string,number> = {};
  for (const r of long) byMaker[r.manufacturer_slug] = (byMaker[r.manufacturer_slug]||0)+1;
  Object.entries(byMaker).sort((a,b)=>b[1]-a[1]).slice(0,15)
    .forEach(([m,c]) => console.log(`  ${m}: ${c}件`));
}
main();
