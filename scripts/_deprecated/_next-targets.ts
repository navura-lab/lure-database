import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  
  // 既存エディトリアルのslugを取得
  const editDir = path.join(import.meta.dirname, '../src/data/seo/editorials');
  const existing = new Set(
    fs.readdirSync(editDir)
      .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
      .map(f => f.replace('.ts', ''))
  );
  
  // 人気メーカーのルアーを取得（slug単位でユニーク、カラー数順）
  const results: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from('lures')
      .select('slug, name, manufacturer, manufacturer_slug, type, target_fish, description, weight, price, color_name')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  
  // slugごとにグループ化
  const groups = new Map<string, { name: string; mfr: string; mfrSlug: string; type: string; fish: string[]; desc: string; colors: number; weight: string; price: number }>();
  for (const r of results) {
    if (existing.has(r.slug)) continue;
    const g = groups.get(r.slug);
    if (g) {
      g.colors++;
    } else {
      groups.set(r.slug, {
        name: r.name, mfr: r.manufacturer, mfrSlug: r.manufacturer_slug,
        type: r.type || 'その他', fish: r.target_fish || [],
        desc: (r.description || '').slice(0, 200),
        colors: 1, weight: r.weight ? `${r.weight}g` : '',
        price: r.price || 0,
      });
    }
  }
  
  // カラー数順（人気度の指標）でソート、上位100件
  const sorted = [...groups.entries()]
    .filter(([_, g]) => g.type !== 'その他' && g.desc.length > 10)
    .sort((a, b) => b[1].colors - a[1].colors)
    .slice(0, 100);
  
  for (const [slug, g] of sorted) {
    console.log(`${slug}|${g.mfrSlug}|${g.mfr}|${g.name}|${g.type}|${g.fish.join(',')}|${g.colors}|${g.price}|${g.weight}|${g.desc.replace(/\n/g, ' ').slice(0, 120)}`);
  }
}
main().catch(console.error);
