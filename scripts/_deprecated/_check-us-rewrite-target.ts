import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  // 全US商品を取得（slug単位で重複排除）
  const { data, error } = await sb
    .from('lures')
    .select('slug,name,description,manufacturer_slug,type,target_fish')
    .in('manufacturer_slug', ['strike-king', 'z-man', 'zoom']);

  if (error) { console.error('Error:', error); return; }

  const seen = new Map<string, any>();
  for (const r of data ?? []) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  const entries = [...seen.values()];

  // メーカー別集計
  const byMaker: Record<string, any[]> = {};
  for (const e of entries) {
    if (!byMaker[e.manufacturer_slug]) byMaker[e.manufacturer_slug] = [];
    byMaker[e.manufacturer_slug].push(e);
  }

  console.log('=== US商品 description リライト対象 ===');
  for (const [maker, items] of Object.entries(byMaker)) {
    const longDesc = items.filter(i => i.description && i.description.length > 250);
    const noDesc = items.filter(i => !i.description);
    const alreadyShort = items.filter(i => i.description && i.description.length <= 250);
    console.log(`\n${maker}: 合計 ${items.length} 商品`);
    console.log(`  250文字超え（要リライト）: ${longDesc.length}`);
    console.log(`  250文字以下（リライト不要？）: ${alreadyShort.length}`);
    console.log(`  description null: ${noDesc.length}`);
  }

  console.log(`\n合計: ${entries.length} 商品`);

  // JSON出力（リライト対象のみ）
  const targets = entries.filter(e => e.description && e.description.length > 250);
  const output = targets.map(e => ({
    slug: e.slug,
    name: e.name,
    manufacturer_slug: e.manufacturer_slug,
    type: e.type,
    target_fish: e.target_fish,
    description: e.description,
  }));

  const fs = await import('fs');
  fs.writeFileSync('/tmp/us-rewrite-targets.json', JSON.stringify(output, null, 2));
  console.log(`\nリライト対象JSON: /tmp/us-rewrite-targets.json (${targets.length}件)`);
}

main().catch(console.error);
