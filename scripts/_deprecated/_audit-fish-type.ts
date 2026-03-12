/**
 * _audit-fish-type.ts — fish×type 不整合監査スクリプト
 *
 * .cache/lures.json からシリーズ単位で集計し、
 * 全fish×type組み合わせと不整合(L1ブラックリスト)を出力する。
 *
 * 使い方:
 *   npx tsx scripts/_audit-fish-type.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_FILE = join(ROOT, '.cache', 'lures.json');

// ─── 型定義 ───
interface LureRow {
  id: string;
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  target_fish: string[] | null;
}

interface SeriesInfo {
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  target_fish: string[];
}

// ─── L1ブラックリスト: 明らかに不正な fish×type 組み合わせ ───
// キー: type, 値: そのtypeで許可されない魚種セット
const L1_BLACKLIST: Record<string, { allowed?: Set<string>; denied?: Set<string>; rule: string }> = {
  'エギ': {
    allowed: new Set(['イカ', 'タコ']),
    rule: 'エギはイカ・タコ専用',
  },
  'スッテ': {
    allowed: new Set(['イカ']),
    rule: 'スッテはイカ専用',
  },
  'タイラバ': {
    denied: new Set(['シーバス', 'ブラックバス', 'トラウト', 'イカ', 'タコ', 'ナマズ', 'ライギョ']),
    rule: 'タイラバにシーバス/バス/トラウト/イカ/タコは不正',
  },
  'フロッグ': {
    allowed: new Set(['ブラックバス', 'ナマズ', 'ライギョ']),
    rule: 'フロッグはバス/ナマズ/ライギョ専用',
  },
};

// ─── データ読み込み ───
console.log('⏳ .cache/lures.json を読み込み中...');
const raw: LureRow[] = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
console.log(`✅ ${raw.length.toLocaleString()} 行 読み込み完了`);

// ─── シリーズ単位に集約 ───
const seriesMap = new Map<string, SeriesInfo>();

for (const row of raw) {
  if (!row.slug || !row.type) continue;

  const existing = seriesMap.get(row.slug);
  if (existing) {
    // target_fishをマージ
    if (row.target_fish) {
      for (const fish of row.target_fish) {
        if (!existing.target_fish.includes(fish)) {
          existing.target_fish.push(fish);
        }
      }
    }
  } else {
    seriesMap.set(row.slug, {
      slug: row.slug,
      name: row.name,
      manufacturer: row.manufacturer,
      manufacturer_slug: row.manufacturer_slug,
      type: row.type,
      target_fish: row.target_fish ? [...row.target_fish] : [],
    });
  }
}

const allSeries = Array.from(seriesMap.values());
console.log(`📦 ${allSeries.length.toLocaleString()} シリーズに集約\n`);

// ─── 1. fish×type マトリクス集計 ───
const fishTypeMatrix = new Map<string, number>(); // "fish|type" → count
const fishCounts = new Map<string, number>();
const typeCounts = new Map<string, number>();

for (const s of allSeries) {
  typeCounts.set(s.type, (typeCounts.get(s.type) || 0) + 1);

  if (s.target_fish.length === 0) {
    const key = `(なし)|${s.type}`;
    fishTypeMatrix.set(key, (fishTypeMatrix.get(key) || 0) + 1);
    fishCounts.set('(なし)', (fishCounts.get('(なし)') || 0) + 1);
  } else {
    for (const fish of s.target_fish) {
      const key = `${fish}|${s.type}`;
      fishTypeMatrix.set(key, (fishTypeMatrix.get(key) || 0) + 1);
      fishCounts.set(fish, (fishCounts.get(fish) || 0) + 1);
    }
  }
}

// ─── マトリクス出力 ───
console.log('═══════════════════════════════════════════════════════════════');
console.log('  FISH × TYPE マトリクス（全組み合わせ・シリーズ数）');
console.log('═══════════════════════════════════════════════════════════════');

// タイプ別にソート
const sortedTypes = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);
const sortedFish = Array.from(fishCounts.entries()).sort((a, b) => b[1] - a[1]);

console.log(`\n--- タイプ別シリーズ数 (${sortedTypes.length} タイプ) ---`);
for (const [type, count] of sortedTypes) {
  console.log(`  ${type.padEnd(20)} ${count}`);
}

console.log(`\n--- 魚種別シリーズ数 (${sortedFish.length} 魚種) ---`);
for (const [fish, count] of sortedFish) {
  console.log(`  ${fish.padEnd(20)} ${count}`);
}

// 全組み合わせをテーブル出力
const sortedMatrix = Array.from(fishTypeMatrix.entries()).sort((a, b) => b[1] - a[1]);
console.log(`\n--- fish×type 全組み合わせ (${sortedMatrix.length} 組) ---`);
console.log('  魚種                 タイプ               件数');
console.log('  ──────────────────── ──────────────────── ────');
for (const [key, count] of sortedMatrix) {
  const [fish, type] = key.split('|');
  console.log(`  ${fish.padEnd(20)} ${type.padEnd(20)} ${count}`);
}

// ─── 2. L1ブラックリスト違反検出 ───
console.log('\n');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  L1 ブラックリスト違反（明らかな不整合）');
console.log('═══════════════════════════════════════════════════════════════');

interface Violation {
  slug: string;
  name: string;
  manufacturer: string;
  type: string;
  fish: string;
  rule: string;
}

const violations: Violation[] = [];

for (const s of allSeries) {
  const blacklist = L1_BLACKLIST[s.type];
  if (!blacklist) continue;

  for (const fish of s.target_fish) {
    let isViolation = false;

    if (blacklist.allowed && !blacklist.allowed.has(fish)) {
      isViolation = true;
    }
    if (blacklist.denied && blacklist.denied.has(fish)) {
      isViolation = true;
    }

    if (isViolation) {
      violations.push({
        slug: s.slug,
        name: s.name,
        manufacturer: s.manufacturer,
        type: s.type,
        fish,
        rule: blacklist.rule,
      });
    }
  }
}

if (violations.length === 0) {
  console.log('\n  ✅ L1ブラックリスト違反なし');
} else {
  // ルール別にグループ化
  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const group = byRule.get(v.rule) || [];
    group.push(v);
    byRule.set(v.rule, group);
  }

  // 影響シリーズ数（ユニーク）
  const affectedSlugs = new Set(violations.map(v => v.slug));

  console.log(`\n  🚨 ${violations.length} 件の違反（${affectedSlugs.size} シリーズ）\n`);

  for (const [rule, items] of byRule) {
    console.log(`  ── ${rule} ──`);
    // fish×type でサブグループ
    const subgroups = new Map<string, Violation[]>();
    for (const item of items) {
      const key = `${item.fish}×${item.type}`;
      const group = subgroups.get(key) || [];
      group.push(item);
      subgroups.set(key, group);
    }

    for (const [combo, comboItems] of subgroups) {
      console.log(`    ${combo} (${comboItems.length}件):`);
      for (const item of comboItems) {
        console.log(`      - ${item.slug} | ${item.name} | ${item.manufacturer}`);
      }
    }
    console.log('');
  }

  // サマリー
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  サマリー');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  全シリーズ数:     ${allSeries.length.toLocaleString()}`);
  console.log(`  違反シリーズ数:   ${affectedSlugs.size}`);
  console.log(`  違反 fish×type 数: ${violations.length}`);
  console.log(`  違反率:           ${(affectedSlugs.size / allSeries.length * 100).toFixed(2)}%`);
  console.log('');
  console.log('  違反ルール別内訳:');
  for (const [rule, items] of byRule) {
    const slugs = new Set(items.map(i => i.slug));
    console.log(`    ${rule}: ${slugs.size}シリーズ, ${items.length}件`);
  }
}

console.log('\n✅ 監査完了');
