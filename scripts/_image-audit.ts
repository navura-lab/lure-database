/**
 * 画像欠損監査スクリプト
 *
 * キャッシュデータから画像欠損を分析し、
 * メーカー別・シリーズ別のレポートを出力する。
 *
 * 使い方: npx tsx scripts/_image-audit.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface LureRecord {
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  images: string[] | null;
  color_name: string;
}

const cacheFile = join(import.meta.dirname, '..', '.cache', 'lures.json');
const lures: LureRecord[] = JSON.parse(readFileSync(cacheFile, 'utf-8'));

// --- メーカー別集計 ---
const mfgStats = new Map<string, { total: number; missing: number; slug: string }>();
for (const l of lures) {
  const key = l.manufacturer;
  const s = mfgStats.get(key) ?? { total: 0, missing: 0, slug: l.manufacturer_slug };
  s.total++;
  if (!l.images || l.images.length === 0) s.missing++;
  mfgStats.set(key, s);
}

// --- シリーズ別集計（画像欠損シリーズのみ） ---
const seriesStats = new Map<string, {
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  totalColors: number;
  missingColors: number;
  missingColorNames: string[];
}>();

for (const l of lures) {
  const key = l.slug;
  let s = seriesStats.get(key);
  if (!s) {
    s = {
      name: l.name,
      manufacturer: l.manufacturer,
      manufacturer_slug: l.manufacturer_slug,
      type: l.type,
      totalColors: 0,
      missingColors: 0,
      missingColorNames: [],
    };
    seriesStats.set(key, s);
  }
  s.totalColors++;
  if (!l.images || l.images.length === 0) {
    s.missingColors++;
    if (l.color_name && s.missingColorNames.length < 3) {
      s.missingColorNames.push(l.color_name);
    }
  }
}

// --- レポート出力 ---
console.log('=== 画像欠損監査レポート ===\n');
console.log(`全レコード: ${lures.length.toLocaleString()}`);
const totalMissing = lures.filter(l => !l.images || l.images.length === 0).length;
console.log(`画像欠損: ${totalMissing.toLocaleString()} (${(totalMissing / lures.length * 100).toFixed(1)}%)\n`);

// メーカー別（欠損率順）
console.log('--- メーカー別（欠損あり、欠損率順） ---');
const mfgSorted = [...mfgStats.entries()]
  .filter(([, s]) => s.missing > 0)
  .sort((a, b) => (b[1].missing / b[1].total) - (a[1].missing / a[1].total));

console.log('メーカー | 欠損/全件 | 欠損率 | slug');
console.log('---|---|---|---');
for (const [name, s] of mfgSorted) {
  const rate = (s.missing / s.total * 100).toFixed(1);
  console.log(`${name} | ${s.missing}/${s.total} | ${rate}% | ${s.slug}`);
}

// 全欠損シリーズ（全カラーが画像なし）
const fullyMissingSeries = [...seriesStats.entries()]
  .filter(([, s]) => s.missingColors === s.totalColors && s.totalColors > 0)
  .sort((a, b) => b[1].totalColors - a[1].totalColors);

console.log(`\n--- 全カラー画像なしシリーズ: ${fullyMissingSeries.length}件 ---`);
console.log('シリーズ | メーカー | タイプ | カラー数');
console.log('---|---|---|---');
for (const [slug, s] of fullyMissingSeries.slice(0, 50)) {
  console.log(`${s.name} | ${s.manufacturer} | ${s.type} | ${s.totalColors}`);
}
if (fullyMissingSeries.length > 50) {
  console.log(`... 他${fullyMissingSeries.length - 50}件`);
}

// JSON出力（スクレイパー修正用）
const reportData = {
  generated: new Date().toISOString(),
  summary: {
    totalRecords: lures.length,
    missingImages: totalMissing,
    missingRate: (totalMissing / lures.length * 100).toFixed(1) + '%',
    affectedManufacturers: mfgSorted.length,
    fullyMissingSeries: fullyMissingSeries.length,
  },
  byManufacturer: mfgSorted.map(([name, s]) => ({
    name,
    slug: s.slug,
    missing: s.missing,
    total: s.total,
    rate: (s.missing / s.total * 100).toFixed(1) + '%',
  })),
  fullyMissingSeries: fullyMissingSeries.map(([slug, s]) => ({
    slug,
    name: s.name,
    manufacturer: s.manufacturer,
    manufacturer_slug: s.manufacturer_slug,
    type: s.type,
    colorCount: s.totalColors,
  })),
};

const outPath = join(import.meta.dirname, '..', '.cache', 'image-audit-report.json');
writeFileSync(outPath, JSON.stringify(reportData, null, 2));
console.log(`\nJSON: ${outPath}`);
