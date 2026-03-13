#!/usr/bin/env npx tsx
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);

async function main() {
  // 検索ボリュームが高そうな人気ルアーを見つける
  // 条件: 日本メーカー、カラー展開が多い（＝人気の証拠）、魚種が主要ターゲット
  const { data, error } = await sb
    .from('lures')
    .select('slug, name, manufacturer, type, target_fish, color_name')
    .order('slug');

  if (error) { console.error(error); return; }
  if (!data) return;

  // slugごとに集約
  const seriesMap = new Map<string, {
    name: string;
    manufacturer: string;
    type: string;
    targetFish: string[];
    colorCount: number;
  }>();

  for (const row of data) {
    const existing = seriesMap.get(row.slug);
    if (!existing) {
      seriesMap.set(row.slug, {
        name: row.name,
        manufacturer: row.manufacturer,
        type: row.type,
        targetFish: row.target_fish || [],
        colorCount: 1,
      });
    } else {
      existing.colorCount++;
    }
  }

  // カラーガイドで使用済みのslugを除外
  const usedSlugs = ['jpv', 'kontakuto-fyido-poppa', 'rollingbait', 'jz4hubt', 'bguc4bu'];

  // 日本市場向け主要魚種
  const jpFish = ['シーバス', 'ブラックバス', 'マダイ', 'ヒラメ', 'タチウオ', 'サワラ', 'ブリ', 'アジ', 'メバル', 'チヌ', 'イカ', 'トラウト'];

  // フィルタ＆ソート
  const candidates = Array.from(seriesMap.entries())
    .filter(([slug, s]) => {
      if (usedSlugs.includes(slug)) return false;
      // 日本市場の魚種を含む
      const hasJpFish = s.targetFish.some(f => jpFish.some(jf => f.includes(jf)));
      return hasJpFish && s.colorCount >= 10;
    })
    .sort((a, b) => b[1].colorCount - a[1].colorCount)
    .slice(0, 50);

  console.log('=== レビュー分析記事 候補 TOP50 ===\n');
  for (const [slug, s] of candidates) {
    console.log(`${s.colorCount}色 | ${s.manufacturer} | ${s.name} | ${s.type} | ${s.targetFish.join(',')} | slug: ${slug}`);
  }

  // タイプ別集計
  const typeCounts = new Map<string, number>();
  for (const [, s] of candidates) {
    typeCounts.set(s.type, (typeCounts.get(s.type) || 0) + 1);
  }
  console.log('\n=== タイプ別分布 ===');
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${type}: ${count}`);
  }
}

main();
