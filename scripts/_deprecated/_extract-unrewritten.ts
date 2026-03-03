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
      .select('slug, name, manufacturer_slug, manufacturer, description, type, target_fish, weight, length, price, diving_depth, action_type')
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

  // slug単位で重複排除
  const bySlug = new Map<string, any>();
  for (const row of data) {
    if (!bySlug.has(row.slug)) {
      bySlug.set(row.slug, row);
    }
  }

  // 未リライト（>250文字）を抽出
  const unrewritten: any[] = [];
  for (const [, row] of bySlug) {
    if (row.description && row.description.length > 250) {
      unrewritten.push({
        slug: row.slug,
        name: row.name,
        manufacturer_slug: row.manufacturer_slug,
        manufacturer: row.manufacturer,
        description: row.description,
        type: row.type,
        target_fish: row.target_fish,
      });
    }
  }

  console.log(`Extracted ${unrewritten.length} unrewritten items`);

  // 10件ずつのバッチに分割
  const BATCH_SIZE = 10;
  const batches = [];
  for (let i = 0; i < unrewritten.length; i += BATCH_SIZE) {
    batches.push(unrewritten.slice(i, i + BATCH_SIZE));
  }

  // 各バッチをファイルに保存
  for (let i = 0; i < batches.length; i++) {
    const path = `/tmp/rewrite-batch-${i}.json`;
    writeFileSync(path, JSON.stringify(batches[i], null, 2));
  }

  console.log(`Saved ${batches.length} batch files to /tmp/rewrite-batch-*.json`);

  // バッチ一覧を出力
  for (let i = 0; i < batches.length; i++) {
    const makers = [...new Set(batches[i].map((r: any) => r.manufacturer_slug))].join(', ');
    console.log(`  Batch ${i}: ${batches[i].length} items (${makers})`);
  }
}

main();
