import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,name,description,name_kana,type,target_fish')
      .range(offset, offset+999);
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  
  // slug単位でmax desc
  const slugMap = new Map<string,any>();
  for (const r of all) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!slugMap.has(k) || (r.description?.length||0) > (slugMap.get(k).description?.length||0))
      slugMap.set(k, r);
  }
  const uniq = [...slugMap.values()];
  
  // 問題分類
  const tooShort  = uniq.filter(r => (r.description?.length||0) < 50 && r.description);
  const empty     = uniq.filter(r => !r.description);
  const tooLong   = uniq.filter(r => (r.description?.length||0) > 250);
  const noKana    = uniq.filter(r => !r.name_kana && r.name && /^[a-zA-Z0-9\s\-\/\.]+$/.test(r.name));
  
  console.log(`総ユニーク商品: ${uniq.length}`);
  console.log(`\n【description問題】`);
  console.log(`  空/NULL: ${empty.length}件`);
  console.log(`  50文字未満(極短): ${tooShort.length}件`);
  console.log(`  250文字超(長すぎ): ${tooLong.length}件`);
  console.log(`\n【name_kana未設定(英語名)】: ${noKana.length}件`);
  
  // 250文字超をメーカー別
  const longByMaker: Record<string,number> = {};
  tooLong.forEach(r => longByMaker[r.manufacturer_slug] = (longByMaker[r.manufacturer_slug]||0)+1);
  console.log('\n  250文字超メーカー別:');
  Object.entries(longByMaker).sort((a,b)=>b[1]-a[1]).forEach(([m,c]) => console.log(`    ${m}: ${c}件`));
  
  // 極短サンプル
  console.log('\n極短description(50文字未満)サンプル:');
  tooShort.slice(0,10).forEach(r => console.log(`  ${r.manufacturer_slug}/${r.slug}: "${r.description}"`));
}
main();
