import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // 全vivaデータ取得
  let allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from('lures')
      .select('slug, name, color_name, images, description, type, target_fish, source_url')
      .eq('manufacturer_slug', 'viva')
      .order('slug')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    offset += data.length;
    if (data.length < 1000) break;
  }

  // slug毎にグループ
  const seen = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (!seen.has(r.slug)) seen.set(r.slug, []);
    seen.get(r.slug)!.push(r);
  }

  console.log(`=== VIVA: ${seen.size} シリーズ, ${allRows.length} 行 ===\n`);

  let issues: string[] = [];

  for (const [slug, rows] of seen) {
    const name = rows[0].name;
    const desc = rows[0].description || '';
    const problems: string[] = [];

    // 名前が長すぎる（説明文が入ってる可能性）
    if (name.length > 50) problems.push(`NAME_TOO_LONG(${name.length})`);

    // 説明文がサイト全体の説明
    if (desc.includes('バスフィッシング専門ルアーブランド')) problems.push('DESC_IS_SITE_ABOUT');

    // カラー名に問題がある
    for (const r of rows) {
      if (r.color_name && r.color_name.length > 50) {
        problems.push(`COLOR_NAME_TOO_LONG: "${r.color_name.substring(0, 50)}..."`);
        break;
      }
      if (r.color_name && (r.color_name.includes('Viva-net') || r.color_name.includes('ビバネット'))) {
        problems.push(`COLOR_NAME_IS_BRAND: "${r.color_name}"`);
        break;
      }
    }

    // 画像が説明画像っぽい
    for (const r of rows) {
      if (r.images && r.images.length > 0) {
        const img = r.images[0];
        if (img.includes('banner') || img.includes('logo') || img.includes('spec') || img.includes('chart') || img.includes('feature')) {
          problems.push(`IMG_NOT_PRODUCT: ${img.substring(0, 80)}`);
          break;
        }
      }
    }

    // 画像なしカラーの数
    const noImgCount = rows.filter((r: any) => !r.images || r.images.length === 0).length;
    if (noImgCount > 0) problems.push(`NO_IMG: ${noImgCount}/${rows.length}`);

    if (problems.length > 0) {
      console.log(`❌ ${slug} (${rows.length}色)`);
      console.log(`   name: ${name.substring(0, 80)}`);
      console.log(`   desc: ${desc.substring(0, 80)}`);
      for (const p of problems) console.log(`   ⚠️ ${p}`);

      // 画像URLサンプル
      const withImg = rows.find((r: any) => r.images && r.images.length > 0);
      if (withImg) {
        console.log(`   img_sample: ${withImg.images[0].substring(0, 120)}`);
      }
      // カラー名サンプル（最初3つ）
      console.log(`   colors: ${rows.slice(0, 5).map((r: any) => r.color_name).join(' | ')}`);
      console.log();
      issues.push(slug);
    } else {
      console.log(`✅ ${slug} (${rows.length}色) - ${name}`);
    }
  }

  console.log(`\n=== 問題あり: ${issues.length}/${seen.size} シリーズ ===`);
}

main();
