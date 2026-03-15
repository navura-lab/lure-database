/**
 * 翻訳ユーティリティ — CAST/LOG i18n
 */

import { UI, type UIDict } from '../dictionaries/ui';

export type Locale = 'ja' | 'en';

/**
 * ロケールに対応するUI辞書を取得
 */
export function getUI(locale: Locale): UIDict {
  return UI[locale];
}

/**
 * DBの日本語フィールド値 → 英語変換
 * key が辞書に存在しない場合はそのまま返す（固有名詞対応）
 */
export function translateField(
  value: string,
  dict: Record<string, string>,
  locale: Locale,
): string {
  if (locale === 'ja') return value;
  return dict[value] ?? value;
}

/**
 * 複数値（配列）を一括翻訳
 */
export function translateFields(
  values: string[],
  dict: Record<string, string>,
  locale: Locale,
): string[] {
  if (locale === 'ja') return values;
  return values.map(v => dict[v] ?? v);
}

/**
 * 価格を通貨付きでフォーマット
 * ja: ¥1,650  en: ¥1,650 (~$11)
 */
export function formatPrice(yen: number, locale: Locale): string {
  const yenStr = `¥${yen.toLocaleString()}`;
  if (locale === 'ja') return yenStr;
  const usd = Math.round(yen / 150); // 概算レート
  return `${yenStr} (~$${usd})`;
}

/**
 * 価格帯を通貨付きでフォーマット
 */
export function formatPriceRange(min: number, max: number, locale: Locale): string {
  if (min === max) return formatPrice(min, locale);
  return `${formatPrice(min, locale)}–${formatPrice(max, locale)}`;
}
