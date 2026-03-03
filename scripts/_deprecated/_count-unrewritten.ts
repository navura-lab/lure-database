import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // 全商品数
  const { count: totalCount } = await sb
    .from('lures')
    .select('*', { count: 'exact', head: true });

  console.log(`全商品数: ${totalCount}`);

  // DAIWAの商品数
  const { count: daiwaCount } = await sb
    .from('lures')
    .select('*', { count: 'exact', head: true })
    .eq('manufacturer_slug', 'daiwa');

  console.log(`DAIWA商品数: ${daiwaCount}`);

  // description が null or 空の商品数
  const { count: noDescCount } = await sb
    .from('lures')
    .select('*', { count: 'exact', head: true })
    .or('description.is.null,description.eq.');

  console.log(`description なし: ${noDescCount}`);

  // DAIWA以外のメーカー一覧と商品数
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

  console.log(`\nDAIWA以外の全行数: ${allRows.length}`);

  // slug単位でユニーク化（同じ商品の色違い・ウェイト違いは1つ）
  const uniqueBySlug = new Map<string, { slug: string; name: string; manufacturer_slug: string; description: string | null }>();
  for (const row of allRows) {
    if (!uniqueBySlug.has(row.slug)) {
      uniqueBySlug.set(row.slug, row);
    }
  }

  console.log(`DAIWA以外のユニークslug数: ${uniqueBySlug.size}`);

  // descriptionがある（リライト対象）のslug数
  const withDesc = [...uniqueBySlug.values()].filter(r => r.description && r.description.trim().length > 0);
  const withoutDesc = [...uniqueBySlug.values()].filter(r => !r.description || r.description.trim().length === 0);

  console.log(`description あり: ${withDesc.length}`);
  console.log(`description なし: ${withoutDesc.length}`);

  // descriptionの長さ分布（リライト済みかの判定用）
  const lengths = withDesc.map(r => r.description!.trim().length);
  const short = lengths.filter(l => l <= 250);
  const medium = lengths.filter(l => l > 250 && l <= 500);
  const long = lengths.filter(l => l > 500);

  console.log(`\n--- description長さ分布 ---`);
  console.log(`250文字以下（リライト済みの可能性大）: ${short.length}`);
  console.log(`251-500文字: ${medium.length}`);
  console.log(`501文字以上（未リライトの可能性大）: ${long.length}`);

  // メーカー別集計
  const makerStats = new Map<string, { total: number; withDesc: number; shortDesc: number; longDesc: number }>();
  for (const row of uniqueBySlug.values()) {
    const ms = row.manufacturer_slug;
    if (!makerStats.has(ms)) {
      makerStats.set(ms, { total: 0, withDesc: 0, shortDesc: 0, longDesc: 0 });
    }
    const stat = makerStats.get(ms)!;
    stat.total++;
    if (row.description && row.description.trim().length > 0) {
      stat.withDesc++;
      if (row.description.trim().length <= 250) {
        stat.shortDesc++;
      } else {
        stat.longDesc++;
      }
    }
  }

  console.log(`\n--- メーカー別（DAIWA以外、slug単位） ---`);
  const sorted = [...makerStats.entries()].sort((a, b) => b[1].longDesc - a[1].longDesc);
  for (const [maker, stat] of sorted) {
    if (stat.longDesc > 0 || stat.withDesc === 0) {
      console.log(`${maker}: total=${stat.total}, desc有=${stat.withDesc}, 短(<=250)=${stat.shortDesc}, 長(>250)=${stat.longDesc}`);
    }
  }
}

main().catch(console.error);
