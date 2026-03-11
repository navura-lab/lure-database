import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // 全行取得（ページネーション）
  let allData: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from('lures')
      .select('manufacturer_slug, slug')
      .order('manufacturer_slug')
      .range(offset, offset + 999);
    if (error) { console.error(error); return; }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // ユニークslug
  const seen = new Map<string, any>();
  for (const r of allData) {
    const k = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(k)) seen.set(k, r);
  }
  console.log('ユニークslug数（≈ページ数）:', seen.size);
  console.log('DB行数:', allData.length);
  console.log('平均行/slug:', (allData.length / seen.size).toFixed(1));

  // メーカー別
  const byMaker = new Map<string, number>();
  for (const [, r] of seen) {
    byMaker.set(r.manufacturer_slug, (byMaker.get(r.manufacturer_slug) || 0) + 1);
  }
  const sorted = [...byMaker.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\nメーカー別slug数 Top20:');
  for (const [maker, count] of sorted.slice(0, 20)) {
    console.log(`  ${maker}: ${count}`);
  }
  console.log('メーカー数:', byMaker.size);
}
main();
