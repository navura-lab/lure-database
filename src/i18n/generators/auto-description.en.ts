/**
 * 英語版スペック説明文自動生成
 *
 * 元: src/lib/auto-description.ts の英語版。
 * descriptionがnullのシリーズ向けに英語説明文を生成。
 */
import type { LureSeries } from '../../lib/types';
import { LURE_TYPE_EN, FISH_NAME_EN } from '../dictionaries/fishing-terms';
import { formatPrice } from '../lib/t';

export function generateAutoDescriptionEn(series: LureSeries): string {
  const typeEn = LURE_TYPE_EN[series.type] ?? series.type;
  const fishEn = (series.target_fish || []).length > 0
    ? (series.target_fish || []).slice(0, 3).map(f => FISH_NAME_EN[f] ?? f).join(', ')
    : '';

  const parts: string[] = [];

  // メーカー名 + ルアー名 + タイプ + 対象魚種
  if (fishEn) {
    parts.push(`The ${series.manufacturer} ${series.name} is a ${typeEn.toLowerCase()} designed for ${fishEn}`);
  } else {
    parts.push(`The ${series.manufacturer} ${series.name} is a ${typeEn.toLowerCase()}`);
  }

  // スペック
  const specs: string[] = [];

  // 重量レンジ
  const wMin = series.weight_range.min;
  const wMax = series.weight_range.max;
  if (wMin != null && wMax != null) {
    specs.push(wMin === wMax ? `weighing ${wMin}g` : `weighing ${wMin}g–${wMax}g`);
  } else if (wMin != null) {
    specs.push(`weighing ${wMin}g`);
  } else if (wMax != null) {
    specs.push(`weighing ${wMax}g`);
  }

  // サイズレンジ
  const lMin = series.length_range.min;
  const lMax = series.length_range.max;
  if (lMin != null && lMax != null) {
    specs.push(lMin === lMax ? `${lMin}mm in length` : `${lMin}mm–${lMax}mm in length`);
  } else if (lMin != null) {
    specs.push(`${lMin}mm in length`);
  } else if (lMax != null) {
    specs.push(`${lMax}mm in length`);
  }

  // 潜行深度
  if (series.diving_depth) {
    specs.push(`with a diving depth of ${series.diving_depth}`);
  }

  // アクション
  if (series.action_type) {
    const actionEn = series.action_type; // action_typeは英語でも通じるものが多い
    specs.push(`featuring a ${actionEn.toLowerCase()} action`);
  }

  let sentence = parts[0];
  if (specs.length > 0) {
    sentence += ', ' + specs.join(', ');
  }
  sentence += '.';

  // カラー数
  if (series.color_count > 0) {
    sentence += ` Available in ${series.color_count} color variants.`;
  }

  // 価格帯
  const pMin = series.price_range.min;
  const pMax = series.price_range.max;
  if (pMin > 0 && pMax > 0) {
    if (pMin === pMax) {
      sentence += ` Priced at ${formatPrice(pMin, 'en')}.`;
    } else {
      sentence += ` Priced from ${formatPrice(pMin, 'en')} to ${formatPrice(pMax, 'en')}.`;
    }
  }

  return sentence;
}
