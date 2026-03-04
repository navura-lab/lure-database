import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  const {data} = await sb.from('lures').select('slug,name,source_url').eq('manufacturer_slug','boreas');
  if (!data) return;
  
  const bySlug = new Map<string, {name: string; source: string}>();
  for (const r of data) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, {name: r.name, source: r.source_url || ''});
  }
  
  const fromShop = [...bySlug.entries()].filter(([,v]) => v.source.includes('flashpoint'));
  const fromOther = [...bySlug.entries()].filter(([,v]) => !v.source.includes('flashpoint'));
  
  console.log(`=== From flashpointonlineshop.com (${fromShop.length}) ===`);
  fromShop.forEach(([slug, info]) => {
    const isBoreasProduct = /BOREAS|MOZAIC|ANOSTRA|ANOSLID|ANO FLACKER|DEVILSTALL/i.test(info.name);
    console.log(`  ${isBoreasProduct ? '✅' : '❌'} [${slug}] ${info.name}`);
  });
  
  console.log(`\n=== From other/null source (${fromOther.length}) ===`);
  fromOther.forEach(([slug, info]) => console.log(`  [${slug}] ${info.name} | src: ${info.source || 'null'}`));
  
  console.log(`\nTotal rows: ${data.length}`);
}
main();
