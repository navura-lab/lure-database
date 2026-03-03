import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // DAIWA以外の全行取得
  const allRows: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug,name,manufacturer_slug,description')
      .neq('manufacturer_slug', 'daiwa')
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // slug単位でユニーク化
  const uniqueBySlug = new Map<string, { slug: string; name: string; manufacturer_slug: string; description: string }>();
  for (const row of allRows) {
    if (!uniqueBySlug.has(row.slug) && row.description && row.description.trim().length > 250) {
      uniqueBySlug.set(row.slug, {
        slug: row.slug,
        name: row.name,
        manufacturer_slug: row.manufacturer_slug,
        description: row.description.trim(),
      });
    }
  }

  const items = [...uniqueBySlug.values()];
  console.log(`リライト対象: ${items.length}件`);

  // バッチ分割（50件ずつ）
  const batchSize = 50;
  const batches: typeof items[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  console.log(`バッチ数: ${batches.length}（各${batchSize}件）`);

  // /tmp/rewrite-batches/ に保存
  const dir = '/tmp/rewrite-batches';
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < batches.length; i++) {
    const path = `${dir}/batch-${String(i).padStart(3, '0')}.json`;
    writeFileSync(path, JSON.stringify(batches[i], null, 2));
  }

  console.log(`バッチファイル保存先: ${dir}/batch-000.json ~ batch-${String(batches.length - 1).padStart(3, '0')}.json`);

  // 全件も保存（バックアップ用）
  writeFileSync(`${dir}/all-unrewritten.json`, JSON.stringify(items, null, 2));
  console.log(`全件バックアップ: ${dir}/all-unrewritten.json`);
}

main().catch(console.error);
