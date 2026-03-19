import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, color_name, type, images').eq('manufacturer_slug', 'spro');
  if (!data) return;
  
  const slugs = new Map<string, { colors: string[], type: string, hasImage: boolean }>();
  for (const r of data) {
    const g = slugs.get(r.slug);
    if (g) {
      g.colors.push(r.color_name || '(default)');
      if (r.images?.length) g.hasImage = true;
    } else {
      slugs.set(r.slug, { 
        colors: [r.color_name || '(default)'], 
        type: r.type || '不明',
        hasImage: !!(r.images?.length)
      });
    }
  }
  
  console.log(`Total records: ${data.length}`);
  console.log(`Unique slugs: ${slugs.size}`);
  console.log(`\n=== 全slug一覧 ===`);
  for (const [slug, g] of [...slugs.entries()].sort((a,b) => b[1].colors.length - a[1].colors.length)) {
    const imgFlag = g.hasImage ? '✓' : '✗';
    console.log(`  ${slug}: ${g.colors.length}色, type:${g.type}, img:${imgFlag}`);
  }
  
  // 問題チェック
  const noImage = [...slugs.entries()].filter(([_, g]) => !g.hasImage);
  const noType = [...slugs.entries()].filter(([_, g]) => g.type === '不明' || g.type === 'その他');
  console.log(`\n=== 問題 ===`);
  console.log(`画像なし: ${noImage.length}件`);
  console.log(`タイプ未分類: ${noType.length}件`);
  if (noType.length > 0) {
    for (const [slug, g] of noType) console.log(`  ${slug}: ${g.type}`);
  }
}
main().catch(console.error);
