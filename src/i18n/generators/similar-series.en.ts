/**
 * 英語版 類似シリーズ比較文生成
 *
 * 元: src/lib/similar-series.ts の generateComparisonText の英語版。
 * スコア計算ロジックは元ファイルを使い、比較文のみ英語で生成。
 */
import type { LureSeries } from '../../lib/types';
import type { SimilarSeriesEntry } from '../../lib/similar-series';
import { formatPrice } from '../lib/t';
import { LURE_TYPE_EN } from '../dictionaries/fishing-terms';

/**
 * 2シリーズ間の英語比較文を生成
 */
export function generateComparisonTextEn(current: LureSeries, other: LureSeries): string {
  const parts: string[] = [];

  // 重量差
  const curWeight = ((current.weight_range.min || 0) + (current.weight_range.max || 0)) / 2;
  const otherWeight = ((other.weight_range.min || 0) + (other.weight_range.max || 0)) / 2;
  if (curWeight > 0 && otherWeight > 0) {
    const diff = +(curWeight - otherWeight).toFixed(1);
    if (Math.abs(diff) >= 0.5) {
      parts.push(diff > 0
        ? `${Math.abs(diff)}g heavier than the ${other.name}`
        : `${Math.abs(diff)}g lighter than the ${other.name}`);
    }
  }

  // 価格差
  const curPrice = Math.round((current.price_range.min + current.price_range.max) / 2);
  const otherPrice = Math.round((other.price_range.min + other.price_range.max) / 2);
  if (curPrice > 0 && otherPrice > 0) {
    const diff = curPrice - otherPrice;
    const absDiff = Math.abs(diff);
    if (absDiff < curPrice * 0.05) {
      parts.push(`similarly priced to the ${other.name}`);
    } else {
      const rounded = Math.round(absDiff / 100) * 100;
      if (rounded > 0) {
        const usdDiff = Math.round(rounded / 150);
        parts.push(diff > 0
          ? `about ¥${rounded.toLocaleString()} (~$${usdDiff}) more than the ${other.name}`
          : `about ¥${rounded.toLocaleString()} (~$${usdDiff}) less than the ${other.name}`);
      }
    }
  }

  // カラー数差
  if (current.color_count > 0 && other.color_count > 0 && current.color_count !== other.color_count) {
    parts.push(`${current.color_count} colors vs ${other.color_count} colors for the ${other.name}`);
  }

  // サイズ差
  const curLength = ((current.length_range.min || 0) + (current.length_range.max || 0)) / 2;
  const otherLength = ((other.length_range.min || 0) + (other.length_range.max || 0)) / 2;
  if (curLength > 0 && otherLength > 0) {
    const diff = +(curLength - otherLength).toFixed(0);
    if (Math.abs(diff) >= 1) {
      parts.push(diff > 0
        ? `${Math.abs(diff)}mm longer than the ${other.name}`
        : `${Math.abs(diff)}mm shorter than the ${other.name}`);
    }
  }

  // 最大2つの差分を文にまとめる
  if (parts.length === 0) {
    const typeEn = LURE_TYPE_EN[other.type] ?? other.type;
    return `A ${typeEn.toLowerCase()} in the same category. Made by ${other.manufacturer}.`;
  }
  return parts.slice(0, 2).join('; ') + '.';
}

/**
 * 類似シリーズ結果に英語の比較文を上書きする
 * ※ findSimilarSeries()で生成したSimilarSeriesEntry[]を後から英語化するユーティリティ
 */
export function localizeSimilarSeries(
  entries: SimilarSeriesEntry[],
  current: LureSeries,
): SimilarSeriesEntry[] {
  return (entries || []).map(entry => ({
    ...entry,
    comparisonText: generateComparisonTextEn(current, entry.series),
  }));
}
