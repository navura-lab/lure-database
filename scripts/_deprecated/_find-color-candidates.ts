#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getSearchAnalytics, daysAgo } from './lib/gsc-client.js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  // 1. DB: カラー数が多い人気ルアー（カラー15色以上）
  console.log('=== DB: カラー展開数上位 ===');
  const { data } = await sb
    .from('lures')
    .select('slug,series_name,manufacturer,type,color_count,target_fish')
    .gte('color_count', 15)
    .order('color_count', { ascending: false })
    .limit(80);

  if (data) {
    const jpFish = new Set(['シーバス', 'ブラックバス', 'トラウト', 'アジ', 'メバル', 'ヒラメ', '青物', 'クロダイ', 'マダイ', 'ヒラメ・マゴチ', 'タチウオ']);
    const filtered = data.filter(r => {
      const fish = Array.isArray(r.target_fish) ? r.target_fish as string[] : [];
      return fish.some(f => jpFish.has(f));
    });
    for (const r of filtered.slice(0, 30)) {
      const fish = Array.isArray(r.target_fish) ? (r.target_fish as string[]).join(',') : '';
      console.log(`${r.color_count}\t${r.slug}\t${r.series_name}\t${r.manufacturer}\t${r.type}\t${fish}`);
    }
  }

  // 2. GSC: カラー関連KW
  console.log('\n=== GSC: カラー関連KW ===');
  try {
    const rows = await getSearchAnalytics(
      daysAgo(30),
      daysAgo(2),
      ['query'],
      500,
    );
    const colorRows = rows
      .filter(r => r.keys[0].includes('カラー') || r.keys[0].includes('人気カラー'))
      .sort((a, b) => b.impressions - a.impressions);

    for (const r of colorRows.slice(0, 30)) {
      console.log(`${r.impressions}\t${r.clicks}\t${r.position.toFixed(1)}\t${r.keys[0]}`);
    }
    if (colorRows.length === 0) {
      console.log('カラー関連KWなし。全KWからインプレ上位を表示:');
      const topRows = rows
        .filter(r => r.keys[0].includes('おすすめ') || r.keys[0].includes('ランキング'))
        .sort((a, b) => b.impressions - a.impressions);
      for (const r of topRows.slice(0, 20)) {
        console.log(`${r.impressions}\t${r.clicks}\t${r.position.toFixed(1)}\t${r.keys[0]}`);
      }
    }
  } catch (e: any) {
    console.log('GSC error:', e.message);
  }
}

main();
