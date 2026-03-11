import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  // Strike Kingの全商品を取得（slug単位で重複排除）
  const { data } = await sb
    .from('lures')
    .select('slug,name,description,manufacturer_slug,type,target_fish')
    .eq('manufacturer_slug', 'strike-king');

  const seen = new Map<string, any>();
  for (const r of data ?? []) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  const entries = [...seen.values()];

  // 全件をJSON出力（英語→日本語リライト対象）
  const output = entries.map(e => ({
    slug: e.slug,
    name: e.name,
    manufacturer_slug: e.manufacturer_slug,
    type: e.type || 'その他',
    target_fish: e.target_fish || [],
    description: e.description || '',
  }));

  fs.writeFileSync('/tmp/strike-king-rewrite.json', JSON.stringify(output, null, 2));
  console.log(`Strike King リライト対象: ${entries.length}件`);
  console.log('出力: /tmp/strike-king-rewrite.json');
}

main().catch(console.error);
