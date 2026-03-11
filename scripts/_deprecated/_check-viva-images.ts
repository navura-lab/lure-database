import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  const { data } = await sb
    .from('lures')
    .select('slug, name, color_name, images, main_image_url')
    .eq('manufacturer_slug', 'viva')
    .order('slug')
    .limit(100);

  if (!data) return;

  const seen = new Map<string, any>();
  for (const r of data) {
    if (!seen.has(r.slug)) seen.set(r.slug, r);
  }

  let issueCount = 0;
  for (const [slug, r] of seen) {
    const imgs = r.images || [];
    const mainImg = r.main_image_url || '';
    const colorImg = imgs[0] || '';

    // 問題のパターンを検出
    const issues: string[] = [];
    if (!mainImg) issues.push('main_image なし');
    if (!colorImg) issues.push('color_image なし');
    if (mainImg && colorImg && mainImg === colorImg) issues.push('main==color (同じ画像)');
    // og:image (メイン画像) がカラーチャート画像と混同しているか
    if (mainImg && /\/\d{2,3}\.webp$/.test(mainImg)) issues.push('main_imageがカラー画像っぽい');

    if (issues.length > 0) {
      console.log(`${slug}: ${issues.join(', ')}`);
      console.log(`  main: ${mainImg}`);
      console.log(`  color[0]: ${colorImg}`);
      issueCount++;
    }
  }

  console.log(`\n合計: ${seen.size}商品中 ${issueCount}件に問題あり`);

  // 画像URLパターンの確認
  console.log('\n--- 画像URLパターン (先頭5件) ---');
  for (const [slug, r] of [...seen.entries()].slice(0, 5)) {
    console.log(`\n${slug} (${r.name}):`);
    console.log(`  main_image: ${r.main_image_url}`);
    const imgs = r.images || [];
    imgs.forEach((img: string, i: number) => {
      console.log(`  images[${i}]: ${img}`);
    });
  }

  // R2画像のソース元（元のvivanet.co.jp URL）を確認するため、
  // スクレイパーがどこから画像を取得しているか確認
  console.log('\n--- main_image_url のドメイン分布 ---');
  const domains = new Map<string, number>();
  for (const [, r] of seen) {
    const url = r.main_image_url || '';
    try {
      const domain = new URL(url).hostname;
      domains.set(domain, (domains.get(domain) || 0) + 1);
    } catch {
      domains.set('(invalid)', (domains.get('(invalid)') || 0) + 1);
    }
  }
  for (const [d, n] of domains) console.log(`  ${d}: ${n}`);
}

main();
