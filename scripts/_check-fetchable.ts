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
  
  // メーカー別のURLパターン確認
  const byMaker = new Map<string, string[]>();
  empty.forEach(r => {
    if (!byMaker.has(r.manufacturer_slug)) byMaker.set(r.manufacturer_slug, []);
    byMaker.get(r.manufacturer_slug)!.push(r.source_url || '');
  });
  
  console.log('空description メーカー別URLパターン:');
  for (const [maker, urls] of [...byMaker.entries()].sort((a,b) => b[1].length - a[1].length).slice(0,12)) {
    const sample = urls[0] || 'URLなし';
    console.log(`  ${maker}(${urls.length}件): ${sample.substring(0,70)}`);
  }
}
main();
