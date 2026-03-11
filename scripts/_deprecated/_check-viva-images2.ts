import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await sb
    .from('lures')
    .select('slug, name, color_name, images, main_image_url')
    .eq('manufacturer_slug', 'viva')
    .order('slug')
    .limit(200);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Total rows:', data.length);

  // slug毎にユニーク
  const seen = new Map();
  for (const r of data) {
    if (!seen.has(r.slug)) seen.set(r.slug, r);
  }

  console.log('Unique slugs:', seen.size);

  // 先頭10件のメイン画像とカラー画像を表示
  let count = 0;
  for (const [slug, r] of seen) {
    if (count >= 10) break;
    count++;
    const imgs = r.images || [];
    console.log(`\n${slug}:`);
    console.log(`  main_image: ${r.main_image_url || 'なし'}`);
    console.log(`  color: ${r.color_name}`);
    for (let i = 0; i < Math.min(imgs.length, 2); i++) {
      console.log(`  images[${i}]: ${imgs[i]}`);
    }
  }

  // メイン画像の問題チェック
  console.log('\n\n=== 問題チェック ===');
  let noMainImg = 0;
  let mainIsColorImg = 0;
  for (const [slug, r] of seen) {
    const main = r.main_image_url || '';
    const colorImgs = r.images || [];
    if (!main) noMainImg++;
    // メイン画像がR2のカラー画像になっていないか
    if (main && main.includes('r2.dev') && /\/\d{2}\.webp$/.test(main)) {
      mainIsColorImg++;
      if (mainIsColorImg <= 5) {
        console.log(`  main==colorっぽい: ${slug} => ${main}`);
      }
    }
  }
  console.log(`メイン画像なし: ${noMainImg}`);
  console.log(`メイン画像がカラー画像っぽい: ${mainIsColorImg}`);

  // メイン画像のURLパターン確認
  console.log('\n=== main_image URLパターン ===');
  const patterns = new Map();
  for (const [, r] of seen) {
    const main = r.main_image_url || '';
    if (main.includes('vivanet.co.jp')) patterns.set('vivanet', (patterns.get('vivanet') || 0) + 1);
    else if (main.includes('r2.dev')) patterns.set('r2', (patterns.get('r2') || 0) + 1);
    else if (!main) patterns.set('empty', (patterns.get('empty') || 0) + 1);
    else patterns.set('other', (patterns.get('other') || 0) + 1);
  }
  for (const [p, n] of patterns) console.log(`  ${p}: ${n}`);
}

main().catch(e => console.error(e));
