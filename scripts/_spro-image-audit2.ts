import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  const results: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('lures').select('slug, color_name, images').eq('manufacturer_slug', 'spro').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  
  console.log(`SPRO total: ${results.length}`);
  
  // 画像問題の分類
  let noImage = 0;
  let httpImage = 0;
  let truncatedR2 = 0;
  let validR2 = 0;
  let defaultWebp = 0;
  
  const R2_PREFIX = 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/';
  
  for (const r of results) {
    const img = r.images?.[0];
    if (!img) { noImage++; continue; }
    if (img.startsWith('http://')) { httpImage++; continue; }
    if (img.startsWith(R2_PREFIX)) {
      validR2++;
      if (img.includes('/default.webp')) defaultWebp++;
    } else if (img.includes('r2.dev/')) {
      truncatedR2++;
    }
  }
  
  console.log(`Valid R2: ${validR2} (default.webp: ${defaultWebp})`);
  console.log(`No image: ${noImage}`);
  console.log(`HTTP (not HTTPS): ${httpImage}`);
  console.log(`Truncated R2 URL: ${truncatedR2}`);
  
  // default.webpの画像が実際にルアー画像なのかチェック（ランダム5件）
  const defaults = results.filter(r => r.images?.[0]?.includes('/default.webp'));
  console.log(`\n=== default.webp samples (${defaults.length}件) ===`);
  for (const r of defaults.slice(0, 5)) {
    const img = r.images[0];
    try {
      const res = await fetch(img, { method: 'HEAD' });
      const size = res.headers.get('content-length');
      console.log(`  ${r.slug}/${r.color_name}: ${res.status} size=${size} url=${img.slice(-60)}`);
    } catch (e: any) {
      console.log(`  ${r.slug}/${r.color_name}: ERROR ${e.message}`);
    }
  }
  
  // 画像なしのslug一覧
  const noImgSlugs = new Set(results.filter(r => !r.images?.[0]).map(r => r.slug));
  if (noImgSlugs.size > 0) {
    console.log(`\n=== 画像なしslug (${noImgSlugs.size}件) ===`);
    for (const s of noImgSlugs) console.log(`  ${s}`);
  }
}
main().catch(console.error);
