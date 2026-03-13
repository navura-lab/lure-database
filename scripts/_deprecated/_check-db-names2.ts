#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  // 日本メーカーのルアーを検索（メーカー名にDAIWA, Shimano等含む）
  const jpMakers = ['DAIWA', 'Shimano', 'Major Craft', 'Megabass', 'JACKALL', 'DUO', 'ima', 'TACKLE HOUSE', 'Blue Blue', 'Apia', 'SMITH', 'Deps', 'OSP', 'GANCRAFT', 'Lucky Craft', 'Zip Baits', 'BREADEN', 'MUKAI', 'DUEL', 'Maria'];

  for (const maker of jpMakers) {
    const { data } = await sb
      .from('lures')
      .select('slug, name, manufacturer, type, target_fish')
      .ilike('manufacturer', `%${maker}%`)
      .limit(1);  // まず1件だけ

    if (data && data.length > 0) {
      // このメーカーの全slug集計
      const { data: allData } = await sb
        .from('lures')
        .select('slug, name, type, target_fish')
        .ilike('manufacturer', `%${maker}%`);
      
      if (!allData) continue;

      // slug集約
      const slugs = new Map<string, { name: string; type: string; fish: string[]; count: number }>();
      for (const d of allData) {
        const ex = slugs.get(d.slug);
        if (!ex) {
          slugs.set(d.slug, { name: d.name, type: d.type, fish: d.target_fish || [], count: 1 });
        } else {
          ex.count++;
        }
      }

      // カラー数上位5件
      const top = [...slugs.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);

      console.log(`\n=== ${data[0].manufacturer} (${slugs.size}シリーズ) ===`);
      for (const [slug, s] of top) {
        console.log(`  ${s.count}色 | ${s.name} | ${s.type} | ${s.fish.join(',')} | slug:${slug}`);
      }
    }
  }
}

main();
