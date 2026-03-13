/**
 * 30テーマ分のトップ4ルアースラグを一括取得
 * 出力: JSON形式で fish, type, series_count, top4 slugs (with name/manufacturer)
 */
import fs from 'node:fs';

const themes = [
  // Batch 5
  { fish: 'ブラックバス', type: 'クランクベイト', slug: 'bass-crankbait' },
  { fish: 'ブラックバス', type: 'ラバージグ', slug: 'bass-rubberjig' },
  { fish: 'ブラックバス', type: 'ミノー', slug: 'bass-minnow' },
  { fish: 'トラウト', type: 'ミノー', slug: 'trout-minnow' },
  { fish: 'ブラックバス', type: 'トップウォーター', slug: 'bass-topwater' },
  { fish: 'ブラックバス', type: 'フロッグ', slug: 'bass-frog' },
  { fish: '青物', type: 'ミノー', slug: 'aomono-minnow' },
  { fish: 'トラウト', type: 'クランクベイト', slug: 'trout-crankbait' },
  { fish: 'ブラックバス', type: 'バイブレーション', slug: 'bass-vibration' },
  { fish: 'カンパチ', type: 'メタルジグ', slug: 'kanpachi-metaljig' },
  // Batch 6
  { fish: 'ヒラマサ', type: 'メタルジグ', slug: 'hiramasa-metaljig' },
  { fish: 'ブリ', type: 'メタルジグ', slug: 'buri-metaljig' },
  { fish: 'トラウト', type: 'ワーム', slug: 'trout-worm' },
  { fish: 'マダイ', type: 'メタルジグ', slug: 'madai-metaljig' },
  { fish: 'マグロ', type: 'メタルジグ', slug: 'maguro-metaljig' },
  { fish: 'ブラックバス', type: 'ジグヘッド', slug: 'bass-jighead' },
  { fish: 'アジ', type: 'ワーム', slug: 'aji-worm' },
  { fish: 'イカ', type: 'エギ', slug: 'ika-egi' },
  { fish: 'ブラックバス', type: 'シャッド', slug: 'bass-shad' },
  { fish: 'ブラックバス', type: 'チャターベイト', slug: 'bass-chatterbait' },
  // Batch 7
  { fish: 'ブラックバス', type: 'ペンシルベイト', slug: 'bass-pencilbait' },
  { fish: 'ブラックバス', type: 'バズベイト', slug: 'bass-buzzbait' },
  { fish: 'ブラックバス', type: 'ジョイントベイト', slug: 'bass-jointedbait' },
  { fish: '青物', type: 'シンキングペンシル', slug: 'aomono-sinkingpencil' },
  { fish: 'シーバス', type: 'スイムベイト', slug: 'seabass-swimbait' },
  { fish: 'ヒラメ', type: 'ミノー', slug: 'hirame-minnow' },
  { fish: 'シーバス', type: 'シャッド', slug: 'seabass-shad' },
  { fish: 'ブラックバス', type: 'ポッパー', slug: 'bass-popper' },
  { fish: '青物', type: 'タイラバ', slug: 'aomono-tairaba' },
  { fish: 'シーバス', type: 'ジグヘッド', slug: 'seabass-jighead' },
];

interface Lure {
  slug: string;
  name: string;
  manufacturer: string;
  type: string;
  target_fish: string[];
  colors: { color_name: string }[];
}

const raw = fs.readFileSync('.cache/lures.json', 'utf-8');
const lures: Lure[] = JSON.parse(raw);

// シリーズごとに集約
const seriesMap = new Map<string, { slug: string; name: string; manufacturer: string; type: string; target_fish: string[]; colorCount: number }>();
for (const l of lures) {
  const existing = seriesMap.get(l.slug);
  if (existing) {
    existing.colorCount++;
  } else {
    seriesMap.set(l.slug, {
      slug: l.slug,
      name: l.name,
      manufacturer: l.manufacturer,
      type: l.type,
      target_fish: Array.isArray(l.target_fish) ? l.target_fish : [l.target_fish],
      colorCount: 1,
    });
  }
}

const allSeries = [...seriesMap.values()];

const results: Record<string, { seriesCount: number; top4: { slug: string; name: string; manufacturer: string; colorCount: number }[] }> = {};

for (const theme of themes) {
  const matching = allSeries.filter(s => {
    if (s.type !== theme.type) return false;
    return s.target_fish.includes(theme.fish);
  });
  matching.sort((a, b) => b.colorCount - a.colorCount);
  const top4 = matching.slice(0, 4).map(s => ({
    slug: s.slug,
    name: s.name,
    manufacturer: s.manufacturer,
    colorCount: s.colorCount,
  }));
  results[theme.slug] = { seriesCount: matching.length, top4 };
}

console.log(JSON.stringify(results, null, 2));
