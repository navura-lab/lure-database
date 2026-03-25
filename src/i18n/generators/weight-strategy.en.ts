/**
 * 英語版ウェイトバリエーション戦略文ジェネレーター
 *
 * 元: src/lib/weight-strategy.ts の英語版。
 * 実ウェイトデータから英語のフィールド×重量の使い分けアドバイスを生成。
 */
import type { LureSeries } from '../../lib/types';
import type { WeightStrategyEntry } from '../../lib/weight-strategy';

// タイプ別の重量帯→状況マッピング（英語版）
const SALTWATER_WEIGHT_MAP_EN: { maxWeight: number; situation: string; advice: string }[] = [
  { maxWeight: 5, situation: 'Harbor light game', advice: 'For mebaru and aji around pier lights. Focus on fall-based presentations with lightweight jigheads' },
  { maxWeight: 10, situation: 'Harbor to estuary', advice: 'Night game for seabass. This weight range excels when drifted with the current' },
  { maxWeight: 20, situation: 'Estuary to surf', advice: 'Great balance of distance and control. Ideal for daytime search patterns' },
  { maxWeight: 40, situation: 'Surf to rocky shore', advice: 'Sufficient casting distance for surf flatfish and shore game' },
  { maxWeight: 80, situation: 'Rocky shore to offshore', advice: 'The core weight for shore jigging. Perfect for one-pitch jerking on bluerunners' },
  { maxWeight: 200, situation: 'Offshore jigging', advice: 'For vertical jigging in deep water. Essential in strong current conditions' },
  { maxWeight: 999, situation: 'Deep jigging', advice: 'For ultra-deep or heavy-current zones. Targeting large pelagic species' },
];

const FRESHWATER_WEIGHT_MAP_EN: { maxWeight: number; situation: string; advice: string }[] = [
  { maxWeight: 3, situation: 'Clear water / high pressure', advice: 'The ultimate finesse approach. Operate delicately on spinning tackle' },
  { maxWeight: 7, situation: 'General bank fishing', advice: 'The most versatile weight range for spinning gear. Multi-purpose applications' },
  { maxWeight: 14, situation: 'Bait finesse to standard', advice: 'Comfortable casting on baitcasting gear. Cover pitching and flipping' },
  { maxWeight: 28, situation: 'Cover punching / moving baits', advice: 'Power finesse to regular tackle. For attacking heavy cover' },
  { maxWeight: 56, situation: 'Big bait / heavy cover', advice: 'Requires dedicated heavy tackle. The trump card for trophy bass' },
  { maxWeight: 999, situation: 'Super big bait', advice: 'Magnum class. Requires a dedicated big bait rod' },
];

// ソルトウォーター向け魚種
const SALTWATER_FISH = ['シーバス', 'ヒラメ', '青物', 'マダイ', 'タチウオ', 'ヒラマサ', 'ブリ', 'カンパチ', 'マグロ', 'メバル', 'アジ', 'マゴチ', 'ハタ', 'イカ', 'タコ', 'ロックフィッシュ', 'チヌ', 'クロダイ', '雷魚'];

/**
 * ルアーシリーズのウェイトバリエーションから英語の戦略文を生成
 */
export function generateWeightStrategyEn(series: LureSeries): WeightStrategyEntry[] {
  // 実ウェイトを収集
  const weights = new Set<number>();
  for (const color of (series.colors || [])) {
    for (const w of (color.weights || [])) {
      if (w.weight && w.weight > 0) weights.add(w.weight);
    }
  }
  if (weights.size < 2) return [];

  const sorted = [...weights].sort((a, b) => a - b);

  // ソルト/フレッシュ判定
  const isSaltwater = (series.target_fish || []).some(f => SALTWATER_FISH.includes(f));
  const weightMap = isSaltwater ? SALTWATER_WEIGHT_MAP_EN : FRESHWATER_WEIGHT_MAP_EN;

  // 重量をグループ化
  const groups: { weights: number[]; situation: string; advice: string }[] = [];
  let currentGroup: { weights: number[]; situation: string; advice: string } | null = null;

  for (const w of sorted) {
    const mapping = weightMap.find(m => w <= m.maxWeight) || weightMap[weightMap.length - 1];
    if (currentGroup && currentGroup.situation === mapping.situation) {
      currentGroup.weights.push(w);
    } else {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { weights: [w], situation: mapping.situation, advice: mapping.advice };
    }
  }
  if (currentGroup) groups.push(currentGroup);

  if (groups.length < 2) return [];

  return groups.map(g => {
    const min = g.weights[0];
    const max = g.weights[g.weights.length - 1];
    const label = min === max ? `${min}g` : `${min}–${max}g`;
    return { label, situation: g.situation, advice: g.advice };
  });
}
