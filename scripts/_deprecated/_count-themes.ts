import fs from 'fs';

const data = JSON.parse(fs.readFileSync('.cache/lures.json', 'utf8'));

// シリーズ単位でカウント（manufacturer+name でユニーク化）
const seriesSet = new Map<string, Set<string>>();
for (const l of data) {
  if (!l.target_fish || !l.type) continue;
  const ft = `${l.target_fish}×${l.type}`;
  if (!seriesSet.has(ft)) seriesSet.set(ft, new Set());
  seriesSet.get(ft)!.add(`${l.manufacturer}|${l.name}`);
}

const targets = [
  'シーバス×ジグヘッド', 'ヒラメ×ジグヘッド',
  'トラウト×バイブレーション', 'ヤリイカ×スッテ',
  'シーバス×スイムベイト', 'トラウト×スプーン',
  'アオリイカ×エギ', 'アジ×ジグヘッド',
  'メバル×ワーム', 'バス×ラバージグ',
  'タチウオ×メタルジグ', 'トラウト×ミノー',
  'シーバス×バイブレーション', 'ヒラメ×メタルジグ',
  'マダイ×タイラバ', 'マダイ×メタルジグ',
  'アジ×ワーム', 'メバル×ジグヘッド',
  'バス×クランクベイト', 'シーバス×シンキングペンシル',
];

console.log('=== 候補テーマのシリーズ数 ===');
for (const t of targets) {
  const count = seriesSet.get(t)?.size || 0;
  console.log(`${t}: ${count} series`);
}

console.log('\n=== 未カバーで30+シリーズの組み合わせ（上位20） ===');
const covered = new Set([
  'マゴチ×ワーム', 'シーバス×ポッパー', 'バス×スイムベイト',
  'メバル×ミノー', '青物×ワーム', 'ダイビングペンシル',
  'ヒラメ×バイブレーション', 'ハタ×ワーム', '青物×ポッパー',
  'チヌ×ワーム', 'シーバス×ペンシルベイト', 'シーバス×メタルジグ',
  'ヒラメ×ワーム', 'タコ×エギ', 'バス×スピナーベイト',
]);

const sorted = [...seriesSet.entries()]
  .filter(([k, v]) => v.size >= 30 && !covered.has(k))
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 20);

for (const [k, v] of sorted) {
  console.log(`${k}: ${v.size} series`);
}
