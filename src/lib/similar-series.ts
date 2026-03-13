/**
 * 類似シリーズ検索 + 比較文生成
 *
 * 同タイプ・同魚種のシリーズからスペック的に近いものを抽出し、
 * 差分を自然言語で生成する。内部リンク強化 + 比較系キーワード対応。
 */
import type { LureSeries } from './types';

export interface SimilarSeriesEntry {
  series: LureSeries;
  score: number;
  comparisonText: string; // 1-2文の比較文
}

/**
 * タイプ別にシリーズをpre-groupして返す（O(n^2)回避用）
 */
export function buildTypeIndex(allSeries: LureSeries[]): Map<string, LureSeries[]> {
  const index = new Map<string, LureSeries[]>();
  for (const s of allSeries) {
    if (!s.type) continue;
    const arr = index.get(s.type) || [];
    arr.push(s);
    index.set(s.type, arr);
  }
  return index;
}

/**
 * 類似シリーズを検索し、比較文を生成する
 */
export function findSimilarSeries(
  current: LureSeries,
  typeIndex: Map<string, LureSeries[]>,
  maxCount: number = 3,
): SimilarSeriesEntry[] {
  if (!current.type) return [];

  const candidates = typeIndex.get(current.type) || [];
  if (candidates.length < 2) return [];

  // 自分自身を除外してスコア計算
  const scored: { series: LureSeries; score: number }[] = [];

  for (const candidate of candidates) {
    // 自分自身をスキップ
    if (candidate.slug === current.slug && candidate.manufacturer_slug === current.manufacturer_slug) {
      continue;
    }

    let score = 0;

    // 同タイプは必須（typeIndexで既にフィルタ済み）: +5
    score += 5;

    // 同魚種: +3 per overlap
    const currentFish = new Set(current.target_fish);
    for (const fish of candidate.target_fish) {
      if (currentFish.has(fish)) score += 3;
    }

    // 同メーカー: +1
    if (candidate.manufacturer_slug === current.manufacturer_slug) {
      score += 1;
    }

    // 価格帯近い（±30%以内）: +2
    const curAvgPrice = (current.price_range.min + current.price_range.max) / 2;
    const canAvgPrice = (candidate.price_range.min + candidate.price_range.max) / 2;
    if (curAvgPrice > 0 && canAvgPrice > 0) {
      const ratio = canAvgPrice / curAvgPrice;
      if (ratio >= 0.7 && ratio <= 1.3) score += 2;
    }

    // 重量帯近い（±50%以内）: +2
    const curAvgWeight = ((current.weight_range.min || 0) + (current.weight_range.max || 0)) / 2;
    const canAvgWeight = ((candidate.weight_range.min || 0) + (candidate.weight_range.max || 0)) / 2;
    if (curAvgWeight > 0 && canAvgWeight > 0) {
      const ratio = canAvgWeight / curAvgWeight;
      if (ratio >= 0.5 && ratio <= 1.5) score += 2;
    }

    scored.push({ series: candidate, score });
  }

  // スコア降順ソート
  scored.sort((a, b) => b.score - a.score);

  // 同メーカーは最大1件（他メーカー優先）
  const result: SimilarSeriesEntry[] = [];
  let sameManufacturerCount = 0;

  for (const item of scored) {
    if (result.length >= maxCount) break;

    const isSameManufacturer = item.series.manufacturer_slug === current.manufacturer_slug;
    if (isSameManufacturer) {
      if (sameManufacturerCount >= 1) continue;
      sameManufacturerCount++;
    }

    result.push({
      series: item.series,
      score: item.score,
      comparisonText: generateComparisonText(current, item.series),
    });
  }

  return result;
}

/**
 * 2シリーズ間の比較文を生成
 */
function generateComparisonText(current: LureSeries, other: LureSeries): string {
  const parts: string[] = [];

  // 重量差
  const curWeight = ((current.weight_range.min || 0) + (current.weight_range.max || 0)) / 2;
  const otherWeight = ((other.weight_range.min || 0) + (other.weight_range.max || 0)) / 2;
  if (curWeight > 0 && otherWeight > 0) {
    const diff = +(curWeight - otherWeight).toFixed(1);
    if (Math.abs(diff) >= 0.5) {
      parts.push(diff > 0
        ? `${other.name}より${Math.abs(diff)}g重い`
        : `${other.name}より${Math.abs(diff)}g軽量`);
    }
  }

  // 価格差
  const curPrice = Math.round((current.price_range.min + current.price_range.max) / 2);
  const otherPrice = Math.round((other.price_range.min + other.price_range.max) / 2);
  if (curPrice > 0 && otherPrice > 0) {
    const diff = curPrice - otherPrice;
    const absDiff = Math.abs(diff);
    if (absDiff < curPrice * 0.05) {
      parts.push(`${other.name}と同価格帯`);
    } else {
      // 100円単位に丸める
      const rounded = Math.round(absDiff / 100) * 100;
      if (rounded > 0) {
        parts.push(diff > 0
          ? `${other.name}より約${rounded.toLocaleString()}円高い`
          : `${other.name}より約${rounded.toLocaleString()}円安い`);
      }
    }
  }

  // カラー数差
  if (current.color_count > 0 && other.color_count > 0 && current.color_count !== other.color_count) {
    parts.push(`カラーバリエーションは${other.name}の${other.color_count}色に対し${current.color_count}色`);
  }

  // サイズ差（length_rangeがある場合のみ）
  const curLength = ((current.length_range.min || 0) + (current.length_range.max || 0)) / 2;
  const otherLength = ((other.length_range.min || 0) + (other.length_range.max || 0)) / 2;
  if (curLength > 0 && otherLength > 0) {
    const diff = +(curLength - otherLength).toFixed(0);
    if (Math.abs(diff) >= 1) {
      parts.push(diff > 0
        ? `全長は${other.name}より${Math.abs(diff)}mm長い`
        : `全長は${other.name}より${Math.abs(diff)}mm短い`);
    }
  }

  // 最大2つの差分を文にまとめる
  if (parts.length === 0) {
    return `${other.name}と同タイプの${other.type}。${other.manufacturer}製。`;
  }
  return parts.slice(0, 2).join('。') + '。';
}
