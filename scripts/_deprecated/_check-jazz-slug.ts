import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // jazzのmanufacturer_slugを確認
  const { data } = await sb.from('lures')
    .select('manufacturer_slug')
    .ilike('manufacturer_slug', '%jazz%')
    .limit(3);
  console.log('jazz slug:', data);

  // その他のメーカーslug一覧
  const { data: d2 } = await sb.from('lures')
    .select('manufacturer_slug')
    .eq('type', 'その他')
    .limit(200);
  const makers = new Map<string, number>();
  for (const r of d2!) {
    makers.set(r.manufacturer_slug, (makers.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log('その他メーカー:', [...makers.entries()].sort((a, b) => b[1] - a[1]));

  // valleyhillの全商品数確認（90は多すぎ？）
  const { data: vh } = await sb.from('lures')
    .select('slug, name, type, target_fish')
    .eq('manufacturer_slug', 'valleyhill')
    .limit(500);
  const vhUnique = new Map<string, any>();
  for (const r of vh!) {
    if (!vhUnique.has(r.slug)) vhUnique.set(r.slug, r);
  }
  console.log('valleyhill unique:', vhUnique.size);
}
main();
