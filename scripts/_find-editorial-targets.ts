/**
 * エディトリアル未生成ルアーの中から優先ターゲットを特定する
 * GSCインプレッション順 → description有り → メーカー分散
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readdirSync, writeFileSync } from 'fs';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

// 既存エディトリアルのslug一覧
const existingSlugs = new Set(
  readdirSync('src/data/seo/editorials')
    .filter(f => !f.startsWith('_') && f.endsWith('.ts'))
    .map(f => f.replace('.ts', ''))
);
console.log('既存エディトリアル:', existingSlugs.size);

// DBからルアーデータを全件取得
const allLures: any[] = [];
let from = 0;
while (true) {
  const { data } = await sb.from('lures')
    .select('slug, manufacturer_slug, name, type, target_fish, description, weight, price')
    .range(from, from + 999);
  if (!data?.length) break;
  allLures.push(...data);
  from += 1000;
  if (data.length < 1000) break;
}

// slug単位でグループ化
const slugMap = new Map<string, any>();
for (const r of allLures) {
  if (!slugMap.has(r.slug)) {
    slugMap.set(r.slug, {
      slug: r.slug,
      manufacturer_slug: r.manufacturer_slug,
      name: r.name,
      type: r.type,
      target_fish: r.target_fish,
      description: r.description,
      weight: r.weight,
      price: r.price,
    });
  }
}

// エディトリアル未生成 & descriptionあり
const candidates = [...slugMap.values()].filter(r =>
  !existingSlugs.has(r.slug) &&
  r.description && r.description.length > 30
);
console.log('エディトリアル未生成 & description有り:', candidates.length);

// メーカー別に分散させて200件取得
const makerCount = new Map<string, number>();
const targets: any[] = [];
// まずdescriptionが長いもの優先（情報量が多い）
candidates.sort((a, b) => (b.description?.length || 0) - (a.description?.length || 0));

for (const c of candidates) {
  const count = makerCount.get(c.manufacturer_slug) || 0;
  if (count >= 8) continue; // 同一メーカーは最大8件
  makerCount.set(c.manufacturer_slug, count + 1);
  targets.push(c);
  if (targets.length >= 200) break;
}

console.log('ターゲット選定:', targets.length, '件');
console.log('メーカー数:', new Set(targets.map(t => t.manufacturer_slug)).size);

writeFileSync('/tmp/editorial-targets.json', JSON.stringify(targets, null, 2));
console.log('→ /tmp/editorial-targets.json に保存');

// 上位10件プレビュー
targets.slice(0, 10).forEach(t => 
  console.log(' ', t.manufacturer_slug, t.slug, t.type, (t.description||'').slice(0, 40))
);
