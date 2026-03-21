import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function fetchAll(sb: any) {
  const results: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('lures')
      .select('slug, name, manufacturer, manufacturer_slug, type, images, description, color_name, price')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return results;
}

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const all = await fetchAll(sb);
  console.log(`Total: ${all.length} records\n`);

  // 1. 画像なし
  const noImage = all.filter(l => !l.images || l.images.length === 0);
  console.log(`=== 画像なし: ${noImage.length}件 ===`);
  const noImgByMfr = new Map<string, number>();
  for (const l of noImage) noImgByMfr.set(l.manufacturer, (noImgByMfr.get(l.manufacturer) || 0) + 1);
  [...noImgByMfr.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([m,c]) => console.log(`  ${m}: ${c}`));

  // 2. 画像がロゴっぽい（logo, brand, icon等を含むURL）
  const logoPattern = /logo|brand|icon|avatar|placeholder|default|no-image/i;
  const logoImage = all.filter(l => l.images?.[0] && logoPattern.test(l.images[0]));
  console.log(`\n=== ロゴ画像疑い: ${logoImage.length}件 ===`);
  for (const l of logoImage.slice(0, 10)) {
    console.log(`  ${l.manufacturer}/${l.slug}: ${l.images[0].slice(-60)}`);
  }

  // 3. description が英語 or 空
  const noDesc = all.filter(l => !l.description || l.description.trim().length < 10);
  console.log(`\n=== description短い/なし: ${noDesc.length}件 ===`);

  // 4. 日本語がないdescription（英語のみ）
  const jpPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
  const engDesc = all.filter(l => l.description && l.description.length >= 10 && !jpPattern.test(l.description));
  console.log(`\n=== 英語のみdescription: ${engDesc.length}件 ===`);
  const engByMfr = new Map<string, number>();
  for (const l of engDesc) engByMfr.set(l.manufacturer, (engByMfr.get(l.manufacturer) || 0) + 1);
  [...engByMfr.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([m,c]) => console.log(`  ${m}: ${c}`));

  // 5. price が 0 or null
  const noPrice = all.filter(l => !l.price || l.price === 0);
  console.log(`\n=== 価格なし: ${noPrice.length}件 ===`);

  // 6. type が「その他」or null
  const noType = all.filter(l => !l.type || l.type === 'その他');
  console.log(`\n=== タイプ未分類: ${noType.length}件 ===`);
  const noTypeByMfr = new Map<string, number>();
  for (const l of noType) noTypeByMfr.set(l.manufacturer, (noTypeByMfr.get(l.manufacturer) || 0) + 1);
  [...noTypeByMfr.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([m,c]) => console.log(`  ${m}: ${c}`));

  // 7. slug がエンコード文字列っぽい（u3000等）
  const badSlug = all.filter(l => /u[0-9a-f]{4}/.test(l.slug) && l.manufacturer_slug !== 'zero-dragon');
  console.log(`\n=== 不正slug（Unicodeエスケープ）: ${badSlug.length}件 ===`);
  for (const l of badSlug.slice(0, 10)) {
    console.log(`  ${l.manufacturer}/${l.slug}`);
  }

  // サマリー
  console.log(`\n=== 品質サマリー ===`);
  console.log(`  画像なし: ${noImage.length} (${(noImage.length/all.length*100).toFixed(1)}%)`);
  console.log(`  ロゴ画像疑い: ${logoImage.length}`);
  console.log(`  description短い: ${noDesc.length} (${(noDesc.length/all.length*100).toFixed(1)}%)`);
  console.log(`  英語のみdesc: ${engDesc.length} (${(engDesc.length/all.length*100).toFixed(1)}%)`);
  console.log(`  価格なし: ${noPrice.length} (${(noPrice.length/all.length*100).toFixed(1)}%)`);
  console.log(`  タイプ未分類: ${noType.length} (${(noType.length/all.length*100).toFixed(1)}%)`);
  console.log(`  不正slug: ${badSlug.length}`);
}
main().catch(console.error);
