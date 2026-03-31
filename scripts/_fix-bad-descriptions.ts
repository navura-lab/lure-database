import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,description')
      .range(offset,offset+999);
    if (!data?.length) break;
    all.push(...data); offset+=data.length;
    if (data.length<1000) break;
  }
  
  // 問題パターン検出
  const badPatterns = [
    /\uff5c(DAIWA|ダイワ|Daiwa)\s*$/, // 「ルアー名｜DAIWA」
    /^N\/A$/i,                         // "N/A"
    /\(ルアー\)｜DAIWA/,              // ページタイトルそのまま
    /^\s*$/,                           // 空白のみ
  ];
  
  const seen = new Map<string,any>();
  for (const r of all) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  
  const badItems = [...seen.values()].filter(r => 
    r.description && badPatterns.some(p => p.test(r.description))
  );
  
  console.log(`修正対象: ${badItems.length}件`);
  badItems.forEach(r => console.log(`  ${r.manufacturer_slug}/${r.slug}: "${r.description}"`));
  
  // NULL化（空にする）
  let ok = 0;
  for (const r of badItems) {
    const { error } = await sb.from('lures').update({ description: null })
      .eq('manufacturer_slug', r.manufacturer_slug).eq('slug', r.slug);
    if (error) console.log(`❌ ${r.slug}: ${error.message}`);
    else ok++;
  }
  console.log(`\n✅ ${ok}件をNULL化`);
}
main().catch(e => { console.error(e); process.exit(1); });
