/**
 * メーカー名の日本語（カタカナ）表記マッピング
 *
 * SEOのtitleやmeta descriptionでカタカナ検索に対応するため、
 * 英語表記のメーカー名に日本語（カタカナ）表記を紐づける。
 *
 * 使い方:
 *   import { getManufacturerNameJa } from './manufacturer-names-ja';
 *   const jaName = getManufacturerNameJa('jackall'); // 'ジャッカル'
 */

const MANUFACTURER_NAMES_JA: Record<string, string> = {
  // 日本メーカー（カタカナ表記）
  'tacklehouse': 'タックルハウス',
  'daiwa': 'ダイワ',
  'jackall': 'ジャッカル',
  'shimano': 'シマノ',
  'megabass': 'メガバス',
  'duo': 'デュオ',
  'ima': 'アイマ',
  'osp': 'オーエスピー',
  'evergreen': 'エバーグリーン',
  'deps': 'デプス',
  'gancraft': 'ガンクラフト',
  'imakatsu': 'イマカツ',
  'nories': 'ノリーズ',
  'tiemco': 'ティムコ',
  'zipbaits': 'ジップベイツ',
  'bassday': 'バスデイ',
  'smith': 'スミス',
  'palms': 'パームス',
  'jackson': 'ジャクソン',
  'valleyhill': 'バレーヒル',
  'blueblue': 'ブルーブルー',
  'majorcraft': 'メジャークラフト',
  'luckycraft': 'ラッキークラフト',
  'raid': 'レイドジャパン',
  'issei': 'イッセイ',
  'hideup': 'ハイドアップ',
  'duel': 'デュエル',
  'ecogear': 'エコギア',
  'geecrack': 'ジークラック',
  'viva': 'ビバ',
  'breaden': 'ブリーデン',
  'apia': 'アピア',
  'coreman': 'コアマン',
  'longin': 'ロンジン',
  'madness': 'マドネス',
  'mukai': 'ムカイ',
  'fisharrow': 'フィッシュアロー',
  'bottomup': 'ボトムアップ',
  'engine': 'エンジン',
  'dstyle': 'ディスタイル',
  'noike': 'ノイケ',
  'reins': 'レインズ',
  'tict': 'ティクト',
  'baitbreath': 'ベイトブレス',
  'hmkl': 'ハンクル',
  'attic': 'アティック',
  'keitech': 'ケイテック',
  'yamashita': 'ヤマシタ',
  'maria': 'マリア',
  'hayabusa': 'ハヤブサ',
  'jazz': 'ジャズ',
  'littlejack': 'リトルジャック',
  'dreemup': 'ドリームアップ',
  'pozidrive-garage': 'ポジドライブガレージ',
  'flash-union': 'フラッシュユニオン',
  'jumprize': 'ジャンプライズ',
  'pazdesign': 'パズデザイン',
  'harimitsu': 'ハリミツ',
  'forest': 'フォレスト',
  'zeake': 'ジーク',
  'valkein': 'ヴァルケイン',
  'pickup': 'ピックアップ',
  'sawamura': 'サワムラ',
  'rapala': 'ラパラ',
  'drt': 'ディーアールティー',
  'beat': 'ビート',
  'd-claw': 'ディークロウ',
  'xesta': 'ゼスタ',
  'hots': 'ホッツ',
  'bozles': 'ボーズレス',
  'souls': 'ソウルズ',
  'itocraft': 'イトウクラフト',
  'north-craft': 'ノースクラフト',
  'obasslive': 'オーバスライブ',
  'yarie': 'ヤリエ',
  'grassroots': 'グラスルーツ',
  'thirtyfour': 'サーティフォー',
  'carpenter': 'カーペンター',
  'deepliner': 'ディープライナー',
  'cb-one': 'シービーワン',
  'mc-works': 'エムシーワークス',
  'crazy-ocean': 'クレイジーオーシャン',
  'nature-boys': 'ネイチャーボーイズ',
  'seafloor-control': 'シーフロアコントロール',
  'dranckrazy': 'ドランクレイジー',
  'zero-dragon': 'ゼロドラゴン',
  'god-hands': 'ゴッドハンズ',
  // USメーカー（カタカナ表記）
  'gary-yamamoto': 'ゲーリーヤマモト',
  'strike-king': 'ストライクキング',
  'berkley': 'バークレイ',
  'berkley-us': 'バークレイ',
  'z-man': 'ジーマン',
  'zoom': 'ズーム',
  '6th-sense': 'シックスセンス',
  'googan-baits': 'グーガンベイツ',
  'lunkerhunt': 'ランカーハント',
  'missile-baits': 'ミサイルベイツ',
  'lunker-city': 'ランカーシティ',
  'riot-baits': 'ライオットベイツ',
  'xzone-lures': 'エックスゾーンルアーズ',
  'livetarget': 'ライブターゲット',
  'spro': 'スプロ',
};

/**
 * メーカーslugから日本語名を取得
 * マッピングにない場合はDB上のmanufacturer名をそのまま返す
 */
export function getManufacturerNameJa(slug: string, fallback?: string): string {
  return MANUFACTURER_NAMES_JA[slug] || fallback || slug;
}

/**
 * title用: 「ダイワ（DAIWA）」のように日本語名（英語名）を返す
 * 日本語名がない場合は英語名のみ
 */
export function getManufacturerForTitle(slug: string, englishName: string): string {
  const ja = MANUFACTURER_NAMES_JA[slug];
  if (!ja) return englishName;
  // 英語名と日本語名が同じ場合（ima=アイマ等）はそのまま
  if (ja === englishName) return ja;
  return ja;
}
