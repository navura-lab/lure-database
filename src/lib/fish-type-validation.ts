/**
 * L1 魚種×ルアータイプ バリデーション
 *
 * 2層のフィルタリングで不正な魚種×タイプ組み合わせを除去:
 * 1. 許可リスト (TYPE_ALLOWED_FISH): 特殊タイプは listed fish のみ通す
 * 2. 拒否リスト (TYPE_DENIED_FISH): 汎用タイプで明らかに不正な魚種を除外
 *
 * 対象外タイプ（ミノー、ワーム等）は制限なし。
 *
 * @see /Users/user/clawd/obsidian/10_プロジェクト/CASTLOG/lure-page-enrichment-ideas.md
 */

// ========== 許可リスト方式（厳格: ここに無い魚種は全て除去） ==========
const TYPE_ALLOWED_FISH: Record<string, Set<string>> = {
  // エギ → イカ類 + タコのみ
  'エギ': new Set([
    'イカ', 'アオリイカ', 'ヤリイカ', 'ケンサキイカ', 'コウイカ', 'タコ',
    'イカ（アオリイカ、ヤリイカ等）',
  ]),
  // スッテ・イカメタル → イカ類のみ（タコは通常スッテで狙わない）
  'スッテ': new Set([
    'イカ', 'アオリイカ', 'ヤリイカ', 'ケンサキイカ', 'コウイカ',
    'イカ（アオリイカ、ヤリイカ等）',
  ]),
  // タイラバ → 底物・中層の海水魚（バス・トラウト・イカ・シーバスは不正）
  'タイラバ': new Set([
    'マダイ', '青物', 'ブリ', 'ヒラマサ', 'カンパチ',
    'ハタ', 'ロックフィッシュ', 'カサゴ', 'アイナメ',
    'チヌ', 'クロダイ', 'ヒラメ', 'マゴチ', 'タチウオ',
    'サワラ', 'タラ',
    '青物（ブリ、ヒラマサ、カンパチ等）',
    'ロックフィッシュ（カサゴ、アイナメ等）',
    'チヌ・クロダイ', 'ヒラメ・マゴチ',
  ]),
  // テンヤ → 鯛・底物メイン
  'テンヤ': new Set([
    'マダイ', 'タコ', 'ヒラメ', 'マゴチ',
    'ロックフィッシュ', 'カサゴ', 'ハタ', 'アイナメ',
    'タチウオ', '青物',
    'ロックフィッシュ（カサゴ、アイナメ等）',
    'ヒラメ・マゴチ',
  ]),
  // フロッグ → バス・雷魚・ナマズのみ（淡水カバーゲーム専用）
  'フロッグ': new Set([
    'ブラックバス', 'バス', 'ナマズ', '雷魚', 'ライギョ',
  ]),
  // クローラーベイト → バス・雷魚・ナマズ（淡水トップウォーター）
  'クローラーベイト': new Set([
    'ブラックバス', 'バス', 'ナマズ', '雷魚', 'ライギョ', 'シーバス',
  ]),
  // バズベイト → 淡水カバーゲーム専用（表層バジング）
  'バズベイト': new Set([
    'ブラックバス', 'バス', 'ナマズ', '雷魚', 'ライギョ',
  ]),
  // ダイビングペンシル → 大型回遊魚（オフショア/ショアキャスティング）
  'ダイビングペンシル': new Set([
    '青物', 'シーバス', 'マグロ', 'GT', 'ヒラマサ', 'カンパチ', 'ブリ',
    'シイラ', 'マダイ', 'クロダイ', 'ヒラメ', 'サワラ', 'タチウオ',
    '青物（ブリ、ヒラマサ、カンパチ等）', 'チヌ・クロダイ', 'ヒラメ・マゴチ',
  ]),
  // スピンテールジグ → データ上バスのみ（30件）
  'スピンテールジグ': new Set([
    'ブラックバス', 'バス',
  ]),
  // ビッグベイト → バスフィッシング専用（淡水大型ゲーム）
  'ビッグベイト': new Set([
    'ブラックバス', 'バス', '雷魚', 'ライギョ', 'ナマズ',
  ]),
  // メタルバイブレーション → ソルト＋バス（鉄板バイブ）
  'メタルバイブレーション': new Set([
    'シーバス', 'ヒラメ', 'マゴチ', 'ブラックバス', 'バス',
    'ヒラメ・マゴチ',
  ]),
  // ジョイントベイト → 淡水大型ゲーム
  'ジョイントベイト': new Set([
    'ブラックバス', 'バス', '雷魚', 'ライギョ',
  ]),
  // ルアーアクセサリー → 魚種なし（全拒否。group-luresでも除外される）
  'ルアーアクセサリー': new Set([]),
};

// ========== 拒否リスト方式（部分除去: 汎用タイプの明らかな不正のみ） ==========
const TYPE_DENIED_FISH: Record<string, Set<string>> = {
  // クランクベイト: マダイは不正（チニング=クロダイはOK）
  'クランクベイト': new Set(['マダイ']),
  // スプーン: ハゼは不正（スプーンでハゼは狙わない）
  'スプーン': new Set(['ハゼ']),
  // ワーム: マダイは不正（ワームでマダイは非典型的）
  'ワーム': new Set(['マダイ']),
  // ポッパー: トラウトは不正（ポッパーでトラウトは非典型的）
  'ポッパー': new Set(['トラウト']),
};

/**
 * ルアータイプに基づいて target_fish から不正な魚種を除去
 *
 * 優先順位: 許可リスト > 拒否リスト > 制限なし
 */
export function filterInvalidFishForType(type: string, targetFish: string[]): string[] {
  // 1. 許可リストがあるタイプ → listed fish のみ通す
  const allowed = TYPE_ALLOWED_FISH[type];
  if (allowed) {
    return targetFish.filter(fish => allowed.has(fish));
  }

  // 2. 拒否リストがあるタイプ → listed fish を除去
  const denied = TYPE_DENIED_FISH[type];
  if (denied) {
    return targetFish.filter(fish => !denied.has(fish));
  }

  // 3. どちらにもないタイプ → 制限なし
  return targetFish;
}

/**
 * 環境・メソッド系の非魚種エントリを除外
 * 「ソルト」「オフショア」は魚種ではなくフィールド区分
 */
const NON_FISH_ENTRIES = new Set(['ソルト', 'オフショア']);

export function removeNonFishEntries(targetFish: string[]): string[] {
  return targetFish.filter(fish => !NON_FISH_ENTRIES.has(fish));
}

/** ビルドから除外すべきタイプ（ルアーではない製品） */
export const EXCLUDED_TYPES = new Set(['ルアーアクセサリー']);

/**
 * 非ルアー製品の名前パターン検出
 * シンカー/ウェイト単体、フック単体、ロッド、交換パーツ等を除外
 * 偽陽性ゼロのパターンのみ（「Blade」「Line」「Cover」「Ring」等の曖昧なものは含めない）
 */
const EXCLUDED_NAME_PATTERNS = [
  // ===================== 日本語: 確実な非ルアー =====================

  // アフターパーツ・スペアパーツ
  /アフターパーツ/,
  /スペアパーツ/,
  /カスタムパーツ/,

  // ロッド
  /(?:キャスティング|ジギング|ベイト|スピニング|ショアジギング)ロッド/,

  // フック単体
  /フックユニット/,
  /アシストフック/,

  // シンカー
  /シンカー/,
  /オフセット.*シンカー/,

  // アパレル
  /グローブ$/,
  /ショルダーバッグ/,
  /Tシャツ/,

  // ===================== 英語: シンカー/ウェイト単体 =====================
  /\b(?:flipping|drop\s*shot|casting|neko|wacky|splitshot|split\s*ball|lead\s+wacky|nail)\s*weight\b/i,
  /\btungsten\s*worm\s*weight\b/i,
  /dome\s*neko\s*weight/i,
  /offset\s*sinker/i,

  // ===================== 英語: フック単体 =====================
  /keel\s*weighted\s*hook/i,
  /\bswimbait\s*hook\b/i,
  /\bewg\s*hook\b/i,
  /\bflippin.*hook\b/i,
  /\bbandito\s*flippin/i,
  /\blive\s*minnow\s*hook\b/i,
  /\bjugular.*hook\b/i,
  /\b(?:dart|treble|worm|widegap|finesse\s+wacky|finesse|toad)\s+hook\b/i,
  /\bhook\s+\d+\/bag\b/i,

  // ===================== 英語: ジグヘッド単体 =====================
  /\bline[- ]?thru\s*jig\s*head\b/i,
  /\blite\s+jig\s+heads?\b/i,
  /\btube\s*jig\b/i,
  /\bned\s*rig\s*jig\b/i,
  /\b(?:wacky|neko)\s*(?:rig\s*)?(?:jig\s*)?head\b/i,

  // ===================== 英語: ロッド =====================
  /\b(?:spinning|casting|travel)\s+rod\b/i,
  /^ROD$/i,

  // ===================== 英語: 釣り糸 =====================
  /\bfishing\s+line\b/i,

  // ===================== 英語: バッグ・ケース =====================
  /\bgear\s+bag\b/i,
  /\btackle\s+(?:box|bag)\b/i,

  // ===================== 英語: アパレル =====================
  /\bapparel\b/i,

  // ===================== 英語: スイベル =====================
  /\bswivel\b/i,

  // ===================== 英語: 交換パーツ/アクセサリー =====================
  /\breplacement\s+(?:tail|fin)\b/i,
  /\bsilicone\s+skirt\b/i,
  /\baccessory\s*kit\b/i,
  /\bspare\s+parts?\b/i,
  /スペアパーツ/,
  /\bfishing\s*tool\b/i,

  // ===================== 集魚剤・ケミカル =====================
  /\bbite\s+powder\b/i,
  /\bbite\s+liquid\b/i,
  /\battractant\b/i,
  /\bfish\s+scent\b/i,
  /\bscent\s+spray\b/i,
  /\bchum\b/i,

  // ===================== 特定型番 =====================
  /^ZF-/i,  // Zero Dragon ロッド型番
  /キャスティングロッド/,
];

/** スクレイプ時に誤って取り込まれた非ルアー製品のslug */
const EXCLUDED_SLUGS = new Set([
  'runway-xr',       // XESTAロッド
  'venus-crew-2026', // XESTAレディースウェアブランド
  // Shimano アフターパーツ
  'a155f00000cehq0qan',
  'a155f00000cehnbqan',
  // Viva
  'metalmagic-spare-parts',
  'aw-offset-sinker',
  'datchak-hookunit',
  'aw-shoulderbag',
  'hansude-glove',
  'spark-assist-hook',
  // 釣り糸
  'trout-dsline',
  // キャップ
  'north-craft-cap',
  // バッグ
  'ice-gear-bag',
  'bite-powder-or-bite-liquid',
]);

/** 製品名またはslugが非ルアー（アクセサリー/パーツ/ロッド/ウェア）かどうかを判定 */
export function isNonLureProduct(name: string, slug?: string): boolean {
  if (slug && EXCLUDED_SLUGS.has(slug)) return true;
  return EXCLUDED_NAME_PATTERNS.some(pattern => pattern.test(name));
}
