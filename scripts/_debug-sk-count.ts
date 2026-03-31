import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  // 全件取得（ページネーション）
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,description')
      .eq('manufacturer_slug','strike-king').range(offset, offset+999);
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  console.log(`strike-king 総行数: ${all.length}`);
  // ユニークslug
  const slugs = new Map<string,string>();
  for (const r of all) {
    if (!slugs.has(r.slug)) slugs.set(r.slug, r.description || '');
  }
  console.log(`ユニークslug: ${slugs.size}件`);
  const eng = [...slugs.entries()].filter(([, d]) => {
    const ascii = (d.match(/[\x00-\x7F]/g) || []).length;
    return d.length > 0 && ascii / d.length >= 0.7;
  });
  const long = [...slugs.entries()].filter(([, d]) => d.length > 250);
  console.log(`英語(ASCII>=70%): ${eng.length}件`);
  console.log(`250文字超: ${long.length}件`);
  // 英語×250文字超
  const target = [...slugs.entries()].filter(([, d]) => {
    const ascii = (d.match(/[\x00-\x7F]/g) || []).length;
    return d.length > 250 && ascii / d.length >= 0.7;
  });
  console.log(`英語かつ250文字超: ${target.length}件`);
  target.slice(0,3).forEach(([slug, d]) => console.log(`  ${slug}: ${d.substring(0,80)}`));
}
main();
