/**
 * AI分類結果を統合するスクリプト
 * /tmp/type-ai-result-{0..6}.json → /tmp/type-ai-classifications.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const CANONICAL_TYPES = new Set([
  'ミノー', 'クランクベイト', 'シャッド', 'バイブレーション', 'メタルバイブ',
  'ペンシルベイト', 'シンキングペンシル', 'ダイビングペンシル', 'ポッパー',
  'トップウォーター', 'プロップベイト', 'クローラーベイト', 'i字系',
  'スイムベイト', 'ビッグベイト', 'ジョイントベイト', 'フロッグ',
  'スピナーベイト', 'チャターベイト', 'バズベイト', 'スピンテール',
  'ブレードベイト', 'メタルジグ', 'スプーン', 'スピナー', 'ワーム',
  'ラバージグ', 'ジグヘッド', 'エギ', 'スッテ', 'タイラバ', 'テンヤ', 'その他',
]);

const merged: Record<string, string> = {};
let totalItems = 0;
let invalidTypes = 0;
const typeCounts = new Map<string, number>();

for (let i = 0; i <= 6; i++) {
  const path = `/tmp/type-ai-result-${i}.json`;
  if (!existsSync(path)) {
    console.error(`⚠️ Missing: ${path}`);
    continue;
  }

  const raw = readFileSync(path, 'utf8');
  let data: Record<string, string>;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`❌ JSON parse error in ${path}: ${e}`);
    continue;
  }

  const count = Object.keys(data).length;
  console.log(`✅ Batch ${i}: ${count} items`);

  for (const [key, type] of Object.entries(data)) {
    if (!CANONICAL_TYPES.has(type)) {
      console.warn(`  ⚠️ Invalid type "${type}" for ${key}`);
      invalidTypes++;
      // Try to fix common variations
      if (type === 'メタルバイブレーション') merged[key] = 'メタルバイブ';
      else if (type === 'ペンシル') merged[key] = 'ペンシルベイト';
      else merged[key] = 'その他';
    } else {
      merged[key] = type;
    }
    typeCounts.set(merged[key], (typeCounts.get(merged[key]) || 0) + 1);
    totalItems++;
  }
}

// Write merged results
const outPath = '/tmp/type-ai-classifications.json';
writeFileSync(outPath, JSON.stringify(merged, null, 2));

console.log(`\n=== 統合結果 ===`);
console.log(`合計: ${totalItems} items`);
console.log(`無効タイプ修正: ${invalidTypes} items`);
console.log(`出力: ${outPath}\n`);

// Type distribution
const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log('── タイプ別分布 ──');
for (const [type, count] of sorted) {
  const pct = ((count / totalItems) * 100).toFixed(1);
  console.log(`  ${type.padEnd(20)} ${count.toString().padStart(5)} (${pct}%)`);
}
