import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// 問題メーカー（深層監査で判明）
const PROBLEM_MAKERS = [
  'attic',           // fallback=ミノー/シーバス → 実際はバス/トラウト系中心
  'pickup',          // fallback=メタルジグ/青物 → 衣類まで含む
  'pozidrive-garage',// fallback=ルアー→その他/シーバス
  'jazz',            // 103件がその他
  'obasslive',       // 8件がその他
  'valleyhill',      // 一部間違い
  'viva',            // 確認必要
  'gancraft',        // 38件がその他
  'blueblue',        // 19件がその他
  'majorcraft',      // 16件がその他
];

async function main() {
  const allProducts: any[] = [];
  const seenKeys = new Set<string>();

  // 1. 問題メーカーの全商品を取得
  for (const maker of PROBLEM_MAKERS) {
    const { data, error } = await sb.from('lures')
      .select('slug, name, type, target_fish, manufacturer_slug, description, weight')
      .eq('manufacturer_slug', maker)
      .limit(5000);

    if (error) {
      console.error(`Error fetching ${maker}:`, error.message);
      continue;
    }

    // slug単位でユニーク化
    const uniqueMap = new Map<string, any>();
    for (const r of data!) {
      if (!uniqueMap.has(r.slug)) {
        uniqueMap.set(r.slug, {
          slug: r.slug,
          name: r.name,
          type: r.type,
          target_fish: r.target_fish,
          manufacturer_slug: r.manufacturer_slug,
          description: r.description?.substring(0, 200) || '',
          weight: r.weight,
        });
      }
    }

    const products = [...uniqueMap.values()];
    for (const p of products) {
      const key = `${p.manufacturer_slug}/${p.slug}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allProducts.push(p);
      }
    }
    console.log(`${maker}: ${products.length}商品`);
  }

  // 2. 全メーカーから type=その他 の商品（問題メーカー以外も含む）
  const { data: otherTypeAll } = await sb.from('lures')
    .select('slug, name, type, target_fish, manufacturer_slug, description, weight')
    .eq('type', 'その他')
    .limit(5000);

  let otherCount = 0;
  for (const r of otherTypeAll!) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      allProducts.push({
        slug: r.slug,
        name: r.name,
        type: r.type,
        target_fish: r.target_fish,
        manufacturer_slug: r.manufacturer_slug,
        description: r.description?.substring(0, 200) || '',
        weight: r.weight,
      });
      otherCount++;
    }
  }
  console.log(`\nその他（問題メーカー以外）: ${otherCount}商品`);

  console.log(`\n合計: ${allProducts.length}商品`);

  // 3. JSONファイルに出力（20件ずつバッチ分割）
  const batchSize = 20;
  const batches: any[][] = [];
  for (let i = 0; i < allProducts.length; i += batchSize) {
    batches.push(allProducts.slice(i, i + batchSize));
  }

  // 全データを1ファイルに保存
  writeFileSync('/tmp/reclassify-all.json', JSON.stringify(allProducts, null, 2));

  // バッチごとにファイル保存
  for (let i = 0; i < batches.length; i++) {
    writeFileSync(`/tmp/reclassify-batch-${i}.json`, JSON.stringify(batches[i], null, 2));
  }

  console.log(`${batches.length}バッチに分割（各${batchSize}件）`);
  console.log('出力: /tmp/reclassify-all.json');
  console.log(`バッチ: /tmp/reclassify-batch-0.json ~ /tmp/reclassify-batch-${batches.length - 1}.json`);
}

main();
