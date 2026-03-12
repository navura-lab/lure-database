/**
 * ルアータイプ・対象魚の日本語名 ↔ URLスラッグ マッピング
 */

// ── ルアータイプ（カノニカル33タイプ）──
// 2026-03-04 type-migration.ts で77→33に正規化
export const TYPE_SLUG_MAP: Record<string, string> = {
  'ミノー': 'minnow',
  'クランクベイト': 'crankbait',
  'シャッド': 'shad',
  'バイブレーション': 'vibration',
  'メタルバイブ': 'metal-vib',
  'ペンシルベイト': 'pencilbait',
  'シンキングペンシル': 'sinking-pencil',
  'ダイビングペンシル': 'diving-pencil',
  'ポッパー': 'popper',
  'トップウォーター': 'topwater',
  'プロップベイト': 'propbait',
  'クローラーベイト': 'crawler-bait',
  'i字系': 'i-shape',
  'スイムベイト': 'swimbait',
  'ビッグベイト': 'bigbait',
  'ジョイントベイト': 'jointed-bait',
  'フロッグ': 'frog',
  'スピナーベイト': 'spinnerbait',
  'チャターベイト': 'chatterbait',
  'バズベイト': 'buzzbait',
  'スピンテール': 'spintail',
  'ブレードベイト': 'blade-bait',
  'メタルジグ': 'metal-jig',
  'スプーン': 'spoon',
  'スピナー': 'spinner',
  'ワーム': 'worm',
  'ラバージグ': 'rubber-jig',
  'ジグヘッド': 'jighead',
  'エギ': 'egi',
  'スッテ': 'sutte',
  'タイラバ': 'tai-rubber',
  'テンヤ': 'tenya',
  'その他': 'other',
  // 追加タイプ（2026-03-12）
  'ジャークベイト': 'jerkbait',
  'ルアーアクセサリー': 'lure-accessory',
};

// ── 対象魚 ──
export const FISH_SLUG_MAP: Record<string, string> = {
  'ブラックバス': 'black-bass',
  'シーバス': 'seabass',
  '青物': 'bluerunner',
  'トラウト': 'trout',
  'バス': 'bass',
  'ヒラマサ': 'hiramasa',
  'カンパチ': 'kampachi',
  'ブリ': 'yellowtail',
  'マダイ': 'madai',
  'ヒラメ': 'hirame',
  'ロックフィッシュ': 'rockfish',
  'マグロ': 'tuna',
  'アジ': 'aji',
  'メバル': 'mebaru',
  'イカ': 'squid',
  'オフショア': 'offshore',
  'アオリイカ': 'aori-ika',
  'マゴチ': 'magochi',
  'クロダイ': 'kurodai',
  'ヒラメ・マゴチ': 'hirame-magochi',
  'タチウオ': 'tachiuo',
  'タコ': 'octopus',
  'GT': 'gt',
  'カサゴ': 'kasago',
  'ソルト': 'saltwater',
  'ナマズ': 'catfish',
  '鮎': 'ayu',
  'アユ': 'sweetfish',
  'シイラ': 'mahi-mahi',
  'ケンサキイカ': 'kensaki-ika',
  'ヤリイカ': 'yari-ika',
  'チヌ': 'chinu',
  'サワラ': 'sawara',
  'ハゼ': 'goby',
  'サクラマス': 'sakuramasu',
  'コウイカ': 'cuttlefish',
  'サーモン': 'salmon',
  '雷魚': 'snakehead',
  'サケ': 'sake',
  'アイナメ': 'ainame',
  'タラ': 'cod',
  'ハタ': 'hata',
  // 複合名・北米魚種（2026-03-12追加）
  '青物（ブリ、ヒラマサ、カンパチ等）': 'bluerunner-all',
  'ロックフィッシュ（カサゴ、アイナメ等）': 'rockfish-all',
  'トラウト（管理釣り場・ネイティブ含む）': 'trout-all',
  'イカ（アオリイカ、ヤリイカ等）': 'squid-all',
  'チヌ・クロダイ': 'chinu-kurodai',
  'ウォールアイ': 'walleye',
  'クラッピー': 'crappie',
  'シートラウト': 'seatrout',
  'ストライパー': 'striped-bass',
  'スヌーク': 'snook',
  'パイク': 'pike',
  'パンフィッシュ': 'panfish',
  'パーチ': 'perch',
  'レッドフィッシュ': 'redfish',
  'ブルーフィッシュ': 'bluefish',
};

// 逆引き: slug → 日本語名
export const TYPE_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_SLUG_MAP).map(([name, slug]) => [slug, name])
);

export const FISH_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FISH_SLUG_MAP).map(([name, slug]) => [slug, name])
);

/** 日本語タイプ名 → URLスラッグ (未登録の場合はencodeURIComponent) */
export function getTypeSlug(typeName: string): string {
  return TYPE_SLUG_MAP[typeName] ?? encodeURIComponent(typeName);
}

/** 日本語対象魚名 → URLスラッグ */
export function getFishSlug(fishName: string): string {
  return FISH_SLUG_MAP[fishName] ?? encodeURIComponent(fishName);
}
