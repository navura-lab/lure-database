import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const result: any[] = [];
  let offset = 0;
  while(true) {
    const { data } = await sb.from('lures')
      .select('slug,manufacturer_slug,description,name')
      .range(offset, offset+999);
    if (!data?.length) break;
    result.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`総行数: ${result.length}`);
  // 最大descriptionを slug 単位で取得（全カラーの中で最も長いもの）
  const maxDesc = new Map<string, {slug: string, maker: string, name: string, len: number, desc: string}>();
  for (const r of result) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    const len = r.description?.length || 0;
    if (!maxDesc.has(k) || len > maxDesc.get(k)!.len) {
      maxDesc.set(k, { slug: r.slug, maker: r.manufacturer_slug, name: r.name, len, desc: r.description||'' });
    }
  }
  const long = [...maxDesc.values()].filter(r => r.len > 250);
  console.log(`\n250文字超（slug単位・最大len): ${long.length}件`);
  const byMaker: Record<string,number> = {};
  for (const r of long) byMaker[r.maker] = (byMaker[r.maker]||0)+1;
  Object.entries(byMaker).sort((a,b)=>b[1]-a[1]).slice(0,20)
    .forEach(([m,c]) => console.log(`  ${m}: ${c}件`));
    
  // strike-king サンプル
  const sk = long.filter(r => r.maker === 'strike-king').slice(0,3);
  console.log('\nstrike-king サンプル:');
  sk.forEach(r => console.log(`  ${r.slug} (${r.len}文字): ${r.desc.substring(0,80)}`));
}
main();
