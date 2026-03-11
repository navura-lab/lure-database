import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // VIVA全商品取得（slug単位でユニーク）
  let allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from('lures')
      .select('slug, name, description, type, target_fish, source_url')
      .eq('manufacturer_slug', 'viva')
      .order('slug')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    offset += data.length;
    if (data.length < 1000) break;
  }

  // slug単位で重複排除
  const unique = new Map<string, any>();
  for (const r of allRows) {
    if (!unique.has(r.slug)) unique.set(r.slug, r);
  }

  const products = [...unique.values()];
  console.log(`VIVA商品数: ${products.length}`);

  // リライト対象（description > 250文字）
  const needsRewrite = products.filter(p => p.description && p.description.length > 250);
  console.log(`リライト対象: ${needsRewrite.length}件`);

  // 再分類対象（type = 'ルアー' のもの）
  const needsReclassify = products.filter(p => p.type === 'ルアー' || p.type === 'その他');
  console.log(`再分類対象: ${needsReclassify.length}件`);

  // JSON出力
  const rewriteData = needsRewrite.map(p => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    source_url: p.source_url,
  }));
  fs.writeFileSync('/tmp/viva-rewrite-input.json', JSON.stringify(rewriteData, null, 2));

  const reclassifyData = needsReclassify.map(p => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    type: p.type,
    target_fish: p.target_fish,
    source_url: p.source_url,
  }));
  fs.writeFileSync('/tmp/viva-reclassify-input.json', JSON.stringify(reclassifyData, null, 2));

  // 全商品のtype分布
  const typeDist = new Map<string, number>();
  for (const p of products) {
    typeDist.set(p.type, (typeDist.get(p.type) || 0) + 1);
  }
  console.log('\ntype分布:');
  for (const [t, n] of [...typeDist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`);
  }
}

main();
