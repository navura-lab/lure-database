#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const queries = [
  { label: 'bass-metal-vib', fish: 'ブラックバス', type: 'メタルバイブ' },
  { label: 'seabass-worm', fish: 'シーバス', type: 'ワーム' },
  { label: 'aji-jighead', fish: 'アジ', type: 'ジグヘッド' },
  { label: 'tachiuo-metaljig', fish: 'タチウオ', type: 'メタルジグ' },
  { label: 'bass-bigbait', fish: 'ブラックバス', type: 'ビッグベイト' },
  { label: 'mebaru-jighead', fish: 'メバル', type: 'ジグヘッド' },
  { label: 'seabass-vibration', fish: 'シーバス', type: 'バイブレーション' },
  { label: 'hirame-metaljig', fish: 'ヒラメ', type: 'メタルジグ' },
  { label: 'mebaru-worm', fish: 'メバル', type: 'ワーム' },
  { label: 'rockfish-worm', fish: 'ロックフィッシュ', type: 'ワーム' },
];

async function main() {
  for (const q of queries) {
    // シリーズ単位でカラー数の多い順に取得
    const { data, error } = await sb
      .from('lure_series')
      .select('slug, name, manufacturer_slug, color_count')
      .contains('target_fish', [q.fish])
      .eq('type', q.type)
      .order('color_count', { ascending: false })
      .limit(5);

    if (error) {
      // lure_seriesビューがない場合、luresテーブルからグルーピング
      const { data: raw } = await sb
        .from('lures')
        .select('slug, name, manufacturer_slug')
        .contains('target_fish', [q.fish])
        .eq('type', q.type)
        .limit(500);
      
      if (!raw || raw.length === 0) {
        console.log(`${q.label}: NO DATA`);
        continue;
      }
      
      // slugでグルーピングしてカラー数カウント
      const counts = new Map<string, { slug: string; name: string; mfg: string; cnt: number }>();
      for (const r of raw) {
        const key = r.slug;
        if (!counts.has(key)) {
          counts.set(key, { slug: r.slug, name: r.name, mfg: r.manufacturer_slug, cnt: 0 });
        }
        counts.get(key)!.cnt++;
      }
      
      const sorted = [...counts.values()].sort((a, b) => b.cnt - a.cnt).slice(0, 5);
      console.log(`\n=== ${q.label} ===`);
      for (const s of sorted) {
        console.log(`  '${s.slug}', // ${s.name} (${s.mfg}, ${s.cnt}色)`);
      }
      continue;
    }

    console.log(`\n=== ${q.label} ===`);
    for (const s of (data || [])) {
      console.log(`  '${s.slug}', // ${s.name} (${s.manufacturer_slug}, ${s.color_count}色)`);
    }
  }
}

main().catch(console.error);
