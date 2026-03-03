/**
 * ルアータイプ・対象魚の日本語名 ↔ URLスラッグ マッピング
 */

// ── ルアータイプ ──
export const TYPE_SLUG_MAP: Record<string, string> = {
  'ルアー': 'lure',
  'ワーム': 'worm',
  'ミノー': 'minnow',
  'メタルジグ': 'metal-jig',
  'クランクベイト': 'crankbait',
  'バイブレーション': 'vibration',
  'スプーン': 'spoon',
  'トップウォーター': 'topwater',
  'プラグ': 'plug',
  'シンキングペンシル': 'sinking-pencil',
  'エギ': 'egi',
  'シャッド': 'shad',
  'ビッグベイト': 'bigbait',
  'ペンシルベイト': 'pencilbait',
  'ジグヘッド': 'jighead',
  'タイラバ': 'tai-rubber',
  'ラバージグ': 'rubber-jig',
  'ポッパー': 'popper',
  'ブレードベイト': 'blade-bait',
  'スピナーベイト': 'spinnerbait',
  'その他': 'other',
  'ショアジギング': 'shore-jigging',
  'スッテ': 'sutte',
  'エリアクランク': 'area-crank',
  'バズベイト': 'buzzbait',
  'フロッグ': 'frog',
  'プロップベイト': 'propbait',
  'スイムベイト': 'swimbait',
  'スピンテール': 'spintail',
  'ワイヤーベイト': 'wire-bait',
  'トラウトルアー': 'trout-lure',
  'アジング': 'ajing',
  'メタルバイブ': 'metal-vib',
  'ジョイントベイト': 'jointed-bait',
  'スピナー': 'spinner',
  'フローティングミノー': 'floating-minnow',
  'テンヤ': 'tenya',
  'クローラーベイト': 'crawler-bait',
  'ダイビングペンシル': 'diving-pencil',
  'キャスティングプラグ': 'casting-plug',
  'ジグ': 'jig',
  'エリアスプーン': 'area-spoon',
  'シーバスルアー': 'seabass-lure',
  'サーフルアー': 'surf-lure',
  'メバリング': 'mebaring',
  'チニング': 'chining',
  'ブレードジグ': 'blade-jig',
  'エリアトラウトルアー': 'area-trout-lure',
  'ロックフィッシュ': 'rockfish-lure',
  'メタルスッテ': 'metal-sutte',
  'シンキングミノー': 'sinking-minnow',
  'バイブレーションジグヘッド': 'vibration-jighead',
  'メタルバイブレーション': 'metal-vibration',
  'チャターベイト': 'chatterbait',
  'ひとつテンヤ': 'hitotsu-tenya',
  'フロート': 'float',
  'タコベイト': 'octopus-bait',
  'エリアミノー': 'area-minnow',
  'ペンシル': 'pencil',
  'i字系': 'i-shape',
  '鮎ルアー': 'ayu-lure',
  'タチウオルアー': 'tachiuo-lure',
  'ルアーパーツ': 'lure-parts',
  'ローリングジグヘッド': 'rolling-jighead',
  'スピンテールジグ': 'spintail-jig',
  'タコエギ': 'octopus-egi',
  'ナマズルアー': 'catfish-lure',
  'アイアンジグヘッド': 'iron-jighead',
  'ドジャー': 'dodger',
  'エリアトップウォーター': 'area-topwater',
  'ジグミノー': 'jig-minnow',
  'スイムジグ': 'swim-jig',
  'シンカー': 'sinker',
  '鯛ラバ': 'tai-raba',
  'ケイムラ': 'keimura',
  'ウェイクベイト': 'wakebait',
  'フェザージグ': 'feather-jig',
  'スキップベイト': 'skipbait',
  'スピンジグ': 'spin-jig',
  'チャタベイト': 'chata-bait',
  'ネイティブミノー': 'native-minnow',
  'フック': 'hook',
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
