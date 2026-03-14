/**
 * ランキングスコア計算
 *
 * 5指標の正規化+重み付けで複合スコアを算出。
 * 各指標は同タイプ内での相対値（0-1）に正規化する。
 *
 * - カラー数 35%: メーカーの本気度（カラバリが多い = 売れ筋）
 * - 価格帯幅 20%: ラインナップの充実度（幅広い価格帯 = 多ターゲット）
 * - 重量帯幅 20%: サイズ展開の充実度
 * - モデル数 15%: weightバリエーション数（実質的なモデル展開）
 * - 魚種対応数 10%: 汎用性
 */
import type { LureSeries } from './types';

export interface RankingScore {
  total: number;
  breakdown: {
    colorScore: number;
    priceRangeScore: number;
    weightRangeScore: number;
    modelScore: number;
    fishScore: number;
  };
}

const WEIGHTS = {
  color: 0.35,
  priceRange: 0.20,
  weightRange: 0.20,
  model: 0.15,
  fish: 0.10,
} as const;

/** 0除算安全な正規化（max=0なら全て0） */
function normalize(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

/** シリーズのユニーク重量バリエーション数を算出 */
function countWeightVariants(series: LureSeries): number {
  const weights = new Set<number>();
  for (const color of series.colors) {
    for (const w of color.weights) {
      if (w.weight != null) weights.add(w.weight);
    }
  }
  return weights.size;
}

/** 価格帯の幅（max - min）を算出 */
function priceSpread(series: LureSeries): number {
  const { min, max } = series.price_range;
  if (min <= 0 || max <= 0) return 0;
  return max - min;
}

/** 重量帯の幅（max - min）を算出 */
function weightSpread(series: LureSeries): number {
  const { min, max } = series.weight_range;
  if (min == null || max == null) return 0;
  return Math.max(max - min, 0);
}

/**
 * 同タイプ内でスコアを計算して返す。
 * seriesには同一カテゴリ（魚種×タイプ）のシリーズ配列を渡す。
 */
export function computeRankingScores(series: LureSeries[]): Map<string, RankingScore> {
  if (series.length === 0) return new Map();

  // 各指標の生値を事前計算
  const raw = series.map(s => ({
    key: `${s.manufacturer_slug}/${s.slug}`,
    colorCount: s.color_count,
    priceSpread: priceSpread(s),
    weightSpread: weightSpread(s),
    modelCount: countWeightVariants(s),
    fishCount: s.target_fish.length,
  }));

  // 各指標の最大値（正規化用）
  const maxColor = Math.max(...raw.map(r => r.colorCount));
  const maxPrice = Math.max(...raw.map(r => r.priceSpread));
  const maxWeight = Math.max(...raw.map(r => r.weightSpread));
  const maxModel = Math.max(...raw.map(r => r.modelCount));
  const maxFish = Math.max(...raw.map(r => r.fishCount));

  const result = new Map<string, RankingScore>();

  for (const r of raw) {
    const colorScore = normalize(r.colorCount, maxColor);
    const priceRangeScore = normalize(r.priceSpread, maxPrice);
    const weightRangeScore = normalize(r.weightSpread, maxWeight);
    const modelScore = normalize(r.modelCount, maxModel);
    const fishScore = normalize(r.fishCount, maxFish);

    const total =
      colorScore * WEIGHTS.color +
      priceRangeScore * WEIGHTS.priceRange +
      weightRangeScore * WEIGHTS.weightRange +
      modelScore * WEIGHTS.model +
      fishScore * WEIGHTS.fish;

    result.set(r.key, {
      total,
      breakdown: {
        colorScore,
        priceRangeScore,
        weightRangeScore,
        modelScore,
        fishScore,
      },
    });
  }

  return result;
}
