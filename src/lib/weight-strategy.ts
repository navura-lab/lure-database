/**
 * ウェイトバリエーション戦略文ジェネレーター
 *
 * 実ウェイトデータから、フィールド×重量の使い分けアドバイスを生成。
 * データ駆動: ColorVariant.weights から実際のウェイト値を取得。
 */

import type { LureSeries } from './types';

export interface WeightStrategyEntry {
  /** 重量ラベル（例: "3-7g"） */
  label: string;
  /** 推奨フィールド/状況 */
  situation: string;
  /** アドバイス */
  advice: string;
}

// タイプ別の重量帯→状況マッピング
const SALTWATER_WEIGHT_MAP: { maxWeight: number; situation: string; advice: string }[] = [
  { maxWeight: 5, situation: '港湾ライトゲーム', advice: '常夜灯周りのメバル・アジに。軽量ジグヘッドでフォール主体の釣り' },
  { maxWeight: 10, situation: '港湾〜河口', advice: 'シーバスのナイトゲームに。流れに乗せるドリフトが効く重量帯' },
  { maxWeight: 20, situation: '河口〜サーフ', advice: '飛距離と操作性のバランスが良い。デイゲームのサーチに最適' },
  { maxWeight: 40, situation: 'サーフ〜磯', advice: '十分な飛距離でサーフからのフラットフィッシュ狙いに対応' },
  { maxWeight: 80, situation: '磯〜オフショア', advice: 'ショアジギングの中核。青物のワンピッチジャークに' },
  { maxWeight: 200, situation: 'オフショアジギング', advice: '水深のあるポイントでのバーチカルジギングに。潮流が速い場面で' },
  { maxWeight: 999, situation: 'ディープジギング', advice: '超深場や激流エリア専用。大型回遊魚狙い' },
];

const FRESHWATER_WEIGHT_MAP: { maxWeight: number; situation: string; advice: string }[] = [
  { maxWeight: 3, situation: 'クリアウォーター・ハイプレッシャー', advice: 'フィネスアプローチの極み。スピニングで繊細に操作' },
  { maxWeight: 7, situation: 'オカッパリ全般', advice: 'スピニングタックルで扱いやすい重量帯。多用途に使える' },
  { maxWeight: 14, situation: 'ベイトフィネス〜通常', advice: 'ベイトタックルで快適にキャスト。カバー周りの撃ちもの' },
  { maxWeight: 28, situation: 'カバー撃ち・巻き物', advice: 'パワーフィネスからレギュラータックル。濃いカバー攻略' },
  { maxWeight: 56, situation: 'ビッグベイト・ヘビーカバー', advice: '専用ヘビータックル必須。デカバス狙いの切り札' },
  { maxWeight: 999, situation: 'スーパービッグベイト', advice: 'マグナムクラス。ビッグベイト専用ロッドで使用' },
];

// ソルトウォーター向け魚種
const SALTWATER_FISH = ['シーバス', 'ヒラメ', '青物', 'マダイ', 'タチウオ', 'ヒラマサ', 'ブリ', 'カンパチ', 'マグロ', 'メバル', 'アジ', 'マゴチ', 'ハタ', 'イカ', 'タコ', 'ロックフィッシュ', 'チヌ', 'クロダイ', '雷魚'];

/**
 * ルアーシリーズのウェイトバリエーションから戦略文を生成
 */
export function generateWeightStrategy(series: LureSeries): WeightStrategyEntry[] {
  // 実ウェイトを収集
  const weights = new Set<number>();
  for (const color of (series.colors || [])) {
    for (const w of (color.weights || [])) {
      if (w.weight && w.weight > 0) weights.add(w.weight);
    }
  }
  if (weights.size < 2) return []; // 1ウェイトしかなければ不要

  const sorted = [...weights].sort((a, b) => a - b);

  // ソルト/フレッシュ判定
  const isSaltwater = (series.target_fish || []).some(f => SALTWATER_FISH.includes(f));
  const weightMap = isSaltwater ? SALTWATER_WEIGHT_MAP : FRESHWATER_WEIGHT_MAP;

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

  // 1グループしかなければ不要
  if (groups.length < 2) return [];

  return groups.map(g => {
    const min = g.weights[0];
    const max = g.weights[g.weights.length - 1];
    const label = min === max ? `${min}g` : `${min}-${max}g`;
    return { label, situation: g.situation, advice: g.advice };
  });
}
