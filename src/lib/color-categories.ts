/**
 * カラー名 → 系統カテゴリ分類ユーティリティ
 *
 * ルアー詳細ページのカラー系統分析セクションで使用。
 * ビルド時に全6,160シリーズのカラー名を分類する。
 */

export interface ColorCategory {
  id: string;
  label: string;
  pattern: RegExp;
  /** CSSバーチャート用カラー */
  cssColor: string;
}

/**
 * 12カテゴリの定義。先頭から順にマッチし、最初にヒットしたカテゴリに分類。
 * 'other' は最後のフォールバック。
 */
export const COLOR_CATEGORIES: ColorCategory[] = [
  { id: 'natural', label: 'ナチュラル系', pattern: /イワシ|サバ|アジ|ボラ|コノシロ|キビナゴ|サンマ|カタクチ|マイワシ|ベイト|リアル|ハゼ|ワカサギ|シラス|エビ|甲殻/i, cssColor: '#6B8E6B' },
  { id: 'chart', label: 'チャート系', pattern: /チャート|chart|蛍光|ライム|レモン/i, cssColor: '#C8E64A' },
  { id: 'glow', label: 'グロー・ケイムラ系', pattern: /グロー|ケイムラ|glow|keimura|夜光|蓄光|UV/i, cssColor: '#B8A9E8' },
  { id: 'red', label: 'レッド系', pattern: /レッド|赤|red|ブラッディ|アカキン|レッドヘッド/i, cssColor: '#E05252' },
  { id: 'gold', label: 'ゴールド系', pattern: /ゴールド|金|gold|ミドキン/i, cssColor: '#DAA520' },
  { id: 'silver', label: 'シルバー系', pattern: /シルバー|銀|silver|ミラー|メッキ|ホロ/i, cssColor: '#A8B8C8' },
  { id: 'pink', label: 'ピンク系', pattern: /ピンク|pink|桜|サクラ/i, cssColor: '#F48FB1' },
  { id: 'orange', label: 'オレンジ系', pattern: /オレンジ|orange/i, cssColor: '#FF9800' },
  { id: 'blue', label: 'ブルー系', pattern: /ブルー|青|blue|ブルピン/i, cssColor: '#5B9BD5' },
  { id: 'green', label: 'グリーン系', pattern: /グリーン|緑|green|オリーブ/i, cssColor: '#66BB6A' },
  { id: 'purple', label: 'パープル系', pattern: /パープル|紫|purple|バイオレット/i, cssColor: '#9C6ADE' },
  { id: 'other', label: 'その他', pattern: /.*/, cssColor: '#9E9E9E' },
];

/** カラー名を系統カテゴリIDに分類 */
export function classifyColor(name: string): string {
  for (const cat of COLOR_CATEGORIES) {
    if (cat.pattern.test(name)) return cat.id;
  }
  return 'other';
}

export interface ColorBreakdownEntry {
  id: string;
  label: string;
  count: number;
  pct: number;
  cssColor: string;
}

/** カラー名配列から系統別集計を返す（count降順、0件カテゴリ除外） */
export function computeColorBreakdown(names: string[]): ColorBreakdownEntry[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const id = classifyColor(name);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const total = names.length || 1;
  return COLOR_CATEGORIES
    .map(cat => ({
      id: cat.id,
      label: cat.label,
      count: counts.get(cat.id) || 0,
      pct: Math.round(((counts.get(cat.id) || 0) / total) * 100),
      cssColor: cat.cssColor,
    }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count);
}
