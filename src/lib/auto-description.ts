import type { LureSeries } from './types';

/**
 * description が null のシリーズ向けに、スペック情報から
 * 150-200文字程度の自然な説明文を自動生成する。
 */
export function generateAutoDescription(series: LureSeries): string {
  const parts: string[] = [];

  // メーカー名 + ルアー名 + タイプ + 対象魚種
  const fishLabel = series.target_fish.length > 0
    ? series.target_fish.slice(0, 3).join('・') + 'を対象とした'
    : '';
  parts.push(`${series.manufacturer}の${series.name}は、${fishLabel}${series.type}`);

  // 重量レンジ
  const wMin = series.weight_range.min;
  const wMax = series.weight_range.max;
  if (wMin != null && wMax != null) {
    parts.push(
      wMin === wMax
        ? `重量${wMin}g`
        : `重量${wMin}g〜${wMax}g`
    );
  } else if (wMin != null) {
    parts.push(`重量${wMin}g`);
  } else if (wMax != null) {
    parts.push(`重量${wMax}g`);
  }

  // サイズレンジ
  const lMin = series.length_range.min;
  const lMax = series.length_range.max;
  if (lMin != null && lMax != null) {
    parts.push(
      lMin === lMax
        ? `全長${lMin}mm`
        : `全長${lMin}mm〜${lMax}mm`
    );
  } else if (lMin != null) {
    parts.push(`全長${lMin}mm`);
  } else if (lMax != null) {
    parts.push(`全長${lMax}mm`);
  }

  // 潜行深度
  if (series.diving_depth) {
    parts.push(`潜行深度${series.diving_depth}`);
  }

  // アクション
  if (series.action_type) {
    parts.push(`${series.action_type}アクション`);
  }

  // 最初のパーツ（タイプまで）を文にし、残りのスペックを読点で繋ぐ
  const typePart = parts[0]; // 「〜は、〜タイプ」
  const specParts = parts.slice(1);

  let sentence = typePart;
  if (specParts.length > 0) {
    sentence += '。' + specParts.join('、');
  }

  // カラー数
  if (series.color_count > 0) {
    sentence += `。全${series.color_count}色のカラーバリエーションを展開`;
  }

  // 価格帯
  const pMin = series.price_range.min;
  const pMax = series.price_range.max;
  if (pMin > 0 && pMax > 0) {
    if (pMin === pMax) {
      sentence += `し、価格は¥${pMin.toLocaleString()}`;
    } else {
      sentence += `し、価格帯は¥${pMin.toLocaleString()}〜¥${pMax.toLocaleString()}`;
    }
  }

  sentence += '。';

  return sentence;
}
