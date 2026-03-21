import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // ロングエムのソースURLを確認
  const { data: d1 } = await sb.from('lures').select('slug, name, type, source_url, manufacturer_slug').eq('slug', 'ronguemu').limit(1);
  console.log('=== ロングエム ===');
  console.log(JSON.stringify(d1?.[0], null, 2));
  
  // JACKALLのスクレイパー設定を確認
  // typeの決定ロジック: source_url → airtable → scraper config → fallback
  
  // 同じメーカーで同様の誤分類がないか（nameにインチ表記があるのにtype=ミノー）
  const { data: d2 } = await sb.from('lures').select('slug, name, type, description')
    .eq('manufacturer_slug', 'jackall')
    .eq('type', 'ミノー')
    .limit(100);
  
  const suspects = (d2 || []).filter(r => {
    const desc = (r.description || '').toLowerCase();
    const name = (r.name || '').toLowerCase();
    return desc.includes('ワーム') || desc.includes('ソフト') || desc.includes('インチ') || 
           name.includes('ワーム') || name.includes('グラブ') || /\d+["″]/.test(name) ||
           /\d+インチ/.test(desc);
  });
  
  console.log(`\n=== JACKALL ミノー分類でワーム疑い ===`);
  const slugs = new Set<string>();
  for (const r of suspects) {
    if (slugs.has(r.slug)) continue;
    slugs.add(r.slug);
    console.log(`  ${r.slug}: ${r.name} [${r.type}]`);
    console.log(`    desc: ${(r.description || '').slice(0, 100)}`);
  }
  console.log(`  合計: ${slugs.size}件`);
}
main();
