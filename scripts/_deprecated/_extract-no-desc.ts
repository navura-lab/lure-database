import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY!
);

async function fetchAll() {
  const allRows: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, name, manufacturer_slug, manufacturer, description, type, target_fish, weight, length, price, diving_depth, action_type, color_name')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id');

    if (error) { console.error(error); return null; }
    if (!data || data.length === 0) break;

    allRows.push(...data);
    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
  }

  return allRows;
}

async function main() {
  const data = await fetchAll();
  if (!data) return;

  console.log(`Total rows fetched: ${data.length}`);

  // slug単位で、descriptionなし商品を集約（スペック情報を集める）
  const bySlug = new Map<string, {
    slug: string;
    name: string;
    manufacturer_slug: string;
    manufacturer: string;
    type: string;
    target_fish: string[];
    weights: number[];
    lengths: number[];
    prices: number[];
    diving_depth: string | null;
    action_type: string | null;
    color_count: number;
  }>();

  for (const row of data) {
    const existing = bySlug.get(row.slug);
    if (existing) {
      // 集約（カラー・ウェイト等を追加）
      if (row.weight && row.weight > 0) existing.weights.push(row.weight);
      if (row.length && row.length > 0) existing.lengths.push(row.length);
      if (row.price && row.price > 0) existing.prices.push(row.price);
      if (row.target_fish) {
        for (const fish of row.target_fish) {
          if (!existing.target_fish.includes(fish)) existing.target_fish.push(fish);
        }
      }
      if (!existing.diving_depth && row.diving_depth) existing.diving_depth = row.diving_depth;
      if (!existing.action_type && row.action_type) existing.action_type = row.action_type;
      existing.color_count++;
    } else {
      // descriptionがあるものはスキップ（slugの最初の行のみチェック）
      if (row.description && row.description.trim() !== '') continue;

      bySlug.set(row.slug, {
        slug: row.slug,
        name: row.name,
        manufacturer_slug: row.manufacturer_slug,
        manufacturer: row.manufacturer,
        type: row.type,
        target_fish: row.target_fish || [],
        weights: row.weight > 0 ? [row.weight] : [],
        lengths: row.length > 0 ? [row.length] : [],
        prices: row.price > 0 ? [row.price] : [],
        diving_depth: row.diving_depth,
        action_type: row.action_type,
        color_count: 1,
      });
    }
  }

  // descriptionのあるslugは上でcontinueしたので、ここにはdescriptionなしのみ
  // ただしslugの2行目以降でdescriptionが入る可能性もあるので再チェック
  // → 上のロジックは最初の行でdescriptionチェックなので問題なし

  const noDescItems: any[] = [];
  for (const [, item] of bySlug) {
    const uniqueWeights = [...new Set(item.weights)].sort((a, b) => a - b);
    const uniqueLengths = [...new Set(item.lengths)].sort((a, b) => a - b);
    const uniquePrices = [...new Set(item.prices)].sort((a, b) => a - b);

    noDescItems.push({
      slug: item.slug,
      name: item.name,
      manufacturer_slug: item.manufacturer_slug,
      manufacturer: item.manufacturer,
      type: item.type,
      target_fish: item.target_fish,
      weight_range: uniqueWeights.length > 0 ? `${uniqueWeights[0]}g〜${uniqueWeights[uniqueWeights.length - 1]}g` : null,
      length_range: uniqueLengths.length > 0 ? `${uniqueLengths[0]}mm〜${uniqueLengths[uniqueLengths.length - 1]}mm` : null,
      price_range: uniquePrices.length > 0 ? `¥${uniquePrices[0].toLocaleString()}〜¥${uniquePrices[uniquePrices.length - 1].toLocaleString()}` : null,
      diving_depth: item.diving_depth,
      action_type: item.action_type,
      color_count: item.color_count,
    });
  }

  console.log(`\nNo-description items: ${noDescItems.length}`);

  // データの充実度をチェック
  let hasType = 0, hasTargetFish = 0, hasWeight = 0, hasLength = 0, hasPrice = 0, hasDiving = 0, hasAction = 0;
  for (const item of noDescItems) {
    if (item.type) hasType++;
    if (item.target_fish.length > 0) hasTargetFish++;
    if (item.weight_range) hasWeight++;
    if (item.length_range) hasLength++;
    if (item.price_range) hasPrice++;
    if (item.diving_depth) hasDiving++;
    if (item.action_type) hasAction++;
  }

  console.log(`\n--- Data availability ---`);
  console.log(`  type: ${hasType}/${noDescItems.length}`);
  console.log(`  target_fish: ${hasTargetFish}/${noDescItems.length}`);
  console.log(`  weight: ${hasWeight}/${noDescItems.length}`);
  console.log(`  length: ${hasLength}/${noDescItems.length}`);
  console.log(`  price: ${hasPrice}/${noDescItems.length}`);
  console.log(`  diving_depth: ${hasDiving}/${noDescItems.length}`);
  console.log(`  action_type: ${hasAction}/${noDescItems.length}`);

  // 10件ずつバッチに分割
  const BATCH_SIZE = 10;
  const batches = [];
  for (let i = 0; i < noDescItems.length; i += BATCH_SIZE) {
    batches.push(noDescItems.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    writeFileSync(`/tmp/gen-desc-batch-${i}.json`, JSON.stringify(batches[i], null, 2));
  }

  console.log(`\nSaved ${batches.length} batch files to /tmp/gen-desc-batch-*.json`);

  // サンプル表示
  console.log(`\n--- Sample items ---`);
  for (const item of noDescItems.slice(0, 5)) {
    console.log(`  ${item.manufacturer_slug}/${item.slug}: type=${item.type}, fish=${item.target_fish.join(',')}, colors=${item.color_count}, weight=${item.weight_range}, action=${item.action_type}`);
  }
}

main();
