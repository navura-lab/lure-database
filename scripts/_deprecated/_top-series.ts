import fs from 'fs';

const data = JSON.parse(fs.readFileSync('.cache/lures.json', 'utf8'));

function topSeries(fishName: string, typeName: string) {
  const series = new Map<string, { slug: string; mfr: string; name: string; colors: number; mfr_slug: string }>();
  for (const l of data) {
    if (!Array.isArray(l.target_fish) || !l.target_fish.includes(fishName) || l.type !== typeName) continue;
    const key = l.manufacturer_slug + '|' + l.slug;
    const existing = series.get(key);
    if (existing) {
      existing.colors++;
    } else {
      series.set(key, { slug: l.slug, mfr: l.manufacturer, name: l.name, colors: 1, mfr_slug: l.manufacturer_slug });
    }
  }
  return [...series.values()].sort((a, b) => b.colors - a.colors).slice(0, 4);
}

const combos: [string, string][] = [
  ['シーバス', 'ミノー'],
  ['トラウト', 'スプーン'],
  ['シーバス', 'シンキングペンシル'],
  ['青物', 'メタルジグ'],
  ['マダイ', 'タイラバ'],
];

for (const [fish, type] of combos) {
  console.log(`\n=== ${fish}×${type} ===`);
  const top = topSeries(fish, type);
  for (const s of top) {
    console.log(`  '${s.slug}',  // ${s.mfr} ${s.name}(${s.colors}色)`);
  }
}
