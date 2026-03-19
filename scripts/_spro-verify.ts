import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, color_name').eq('manufacturer_slug', 'spro').order('slug');
  if (!data) return;
  
  const groups = new Map<string, string[]>();
  for (const r of data) {
    const g = groups.get(r.slug) || [];
    g.push(r.color_name || '(default)');
    groups.set(r.slug, g);
  }
  
  // カラー別slugがまだ残っているか
  const single = [...groups.entries()].filter(([_, c]) => c.length === 1 && c[0] === '(default)');
  const multi = [...groups.entries()].filter(([_, c]) => c.length > 1);
  
  console.log(`Total slugs: ${groups.size}`);
  console.log(`Multi-color: ${multi.length}`);
  console.log(`Single (default): ${single.length}`);
  
  // 統合済みグループ確認
  console.log('\n=== 統合済みの代表例 ===');
  for (const slug of ['bucktail-jig', 'aiya-ball', 'banana-jig', 'bucktail-teaser']) {
    const colors = groups.get(slug);
    if (colors) console.log(`  ${slug}: ${colors.length}色 → ${colors.slice(0,5).join(', ')}${colors.length > 5 ? '...' : ''}`);
    else console.log(`  ${slug}: NOT FOUND`);
  }
  
  // まだカラー別になっている疑いのあるもの
  const prefixMap = new Map<string, string[]>();
  for (const [slug] of single) {
    const parts = slug.split('-');
    if (parts.length >= 3) {
      const prefix = parts.slice(0, Math.ceil(parts.length * 0.5)).join('-');
      const list = prefixMap.get(prefix) || [];
      list.push(slug);
      prefixMap.set(prefix, list);
    }
  }
  const suspects = [...prefixMap.entries()].filter(([_, s]) => s.length >= 2);
  if (suspects.length > 0) {
    console.log('\n=== まだカラー別の疑い ===');
    for (const [p, s] of suspects) console.log(`  ${p}: ${s.join(', ')}`);
  } else {
    console.log('\n✅ カラー別slug問題: 解消済み');
  }
}
main().catch(console.error);
