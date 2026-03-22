/**
 * KWパターン自動生成モジュール
 *
 * ルアーの属性（name / type / target_fish）から
 * Google検索でヒットしやすいクエリパターンを生成する。
 */

/** ルアータイプの日本語表記マッピング */
const TYPE_JA: Record<string, string> = {
  minnow: 'ミノー',
  jig: 'ジグ',
  vibe: 'バイブレーション',
  vibration: 'バイブレーション',
  popper: 'ポッパー',
  pencil: 'ペンシル',
  topwater: 'トップウォーター',
  swimbait: 'スイムベイト',
  spoon: 'スプーン',
  spinner: 'スピナー',
  crankbait: 'クランク',
  soft: 'ワーム',
  worm: 'ワーム',
  shad: 'シャッド',
};

/** 対象魚の日本語表記マッピング */
const FISH_JA: Record<string, string> = {
  seabass: 'シーバス',
  bass: 'バス',
  trout: 'トラウト',
  salmon: 'サーモン',
  bluegill: 'ブルーギル',
  tuna: 'マグロ',
  yellowtail: 'ブリ',
  amberjack: 'ヒラマサ',
  flounder: 'ヒラメ',
  rockfish: 'ロックフィッシュ',
  aji: 'アジ',
  mackerel: 'サバ',
  tachiuo: 'タチウオ',
  saurel: 'アジ',
};

function toJa(value: string): string {
  const lower = value.toLowerCase();
  return TYPE_JA[lower] ?? FISH_JA[lower] ?? value;
}

export interface LureAttributes {
  name: string;
  type: string;
  target_fish?: string[] | null;
}

/**
 * ルアー属性からKWパターン一覧を生成
 *
 * 基本パターン（5件） + 対象魚別パターン（最大2件）
 */
export function generateKeywordPatterns(lure: LureAttributes): string[] {
  const { name, type, target_fish } = lure;
  const typeJa = toJa(type);

  const patterns: string[] = [
    name,
    `${name} インプレ`,
    `${name} 使い方`,
    `${name} カラー おすすめ`,
    `${name} レビュー`,
  ];

  // 対象魚別パターン（最大2魚種）
  const fishList = (target_fish ?? []).slice(0, 2);
  for (const fish of fishList) {
    const fishJa = toJa(fish);
    patterns.push(`${fishJa} ${typeJa} おすすめ`);
  }

  return patterns;
}

/**
 * シリーズ名からシリーズKWパターンを生成（オプション）
 * 例: 「コモモ SF-145」→「コモモ」シリーズのパターンも生成
 */
export function generateSeriesPatterns(seriesName: string, type: string): string[] {
  const typeJa = toJa(type);
  return [
    seriesName,
    `${seriesName} インプレ`,
    `${seriesName} ${typeJa}`,
    `${seriesName} カラー`,
  ];
}
