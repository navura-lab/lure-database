/**
 * 釣り用語辞書 — CAST/LOG i18n の核心
 *
 * DBに格納されている日本語値 → 英語表示名のマッピング。
 * category-slugs.ts の TYPE_SLUG_MAP / FISH_SLUG_MAP と対になる。
 */

// ── ルアータイプ（33タイプ + アクセサリー）──
export const LURE_TYPE_EN: Record<string, string> = {
  'ミノー': 'Minnow',
  'クランクベイト': 'Crankbait',
  'シャッド': 'Shad',
  'バイブレーション': 'Vibration',
  'メタルバイブ': 'Metal Vib',
  'ペンシルベイト': 'Pencil Bait',
  'シンキングペンシル': 'Sinking Pencil',
  'ダイビングペンシル': 'Diving Pencil',
  'ポッパー': 'Popper',
  'トップウォーター': 'Topwater',
  'プロップベイト': 'Prop Bait',
  'クローラーベイト': 'Crawler Bait',
  'i字系': 'I-Shape',
  'スイムベイト': 'Swimbait',
  'ビッグベイト': 'Big Bait',
  'ジョイントベイト': 'Jointed Bait',
  'フロッグ': 'Frog',
  'スピナーベイト': 'Spinnerbait',
  'チャターベイト': 'Chatterbait',
  'バズベイト': 'Buzzbait',
  'スピンテール': 'Spintail Jig',
  'ブレードベイト': 'Blade Bait',
  'メタルジグ': 'Metal Jig',
  'スプーン': 'Spoon',
  'スピナー': 'Spinner',
  'ワーム': 'Soft Plastic / Worm',
  'ラバージグ': 'Rubber Jig',
  'ジグヘッド': 'Jig Head',
  'エギ': 'Egi (Squid Jig)',
  'スッテ': 'Sutte (Squid Jig)',
  'タイラバ': 'Tai Rubber',
  'テンヤ': 'Tenya',
  'ジャークベイト': 'Jerkbait',
  'ルアーアクセサリー': 'Lure Accessory',
  'その他': 'Other',
};

// ── 対象魚 ──
export const FISH_NAME_EN: Record<string, string> = {
  'ブラックバス': 'Largemouth Bass',
  'シーバス': 'Japanese Seabass (Suzuki)',
  '青物': 'Bluerunner / Pelagics',
  'トラウト': 'Trout',
  'バス': 'Bass',
  'ヒラマサ': 'Yellowtail Amberjack',
  'カンパチ': 'Greater Amberjack',
  'ブリ': 'Japanese Yellowtail (Buri)',
  'マダイ': 'Red Sea Bream (Madai)',
  'ヒラメ': 'Japanese Flounder (Hirame)',
  'ロックフィッシュ': 'Rockfish',
  'マグロ': 'Tuna',
  'アジ': 'Horse Mackerel (Aji)',
  'メバル': 'Japanese Rockfish (Mebaru)',
  'イカ': 'Squid',
  'アオリイカ': 'Bigfin Reef Squid',
  'マゴチ': 'Bartail Flathead (Magochi)',
  'クロダイ': 'Black Sea Bream (Kurodai)',
  'ヒラメ・マゴチ': 'Flounder / Flathead',
  'タチウオ': 'Largehead Hairtail',
  'タコ': 'Octopus',
  'GT': 'Giant Trevally (GT)',
  'カサゴ': 'Scorpionfish (Kasago)',
  'ナマズ': 'Catfish',
  '鮎': 'Ayu (Sweetfish)',
  'アユ': 'Ayu (Sweetfish)',
  'シイラ': 'Mahi-Mahi (Dorado)',
  'サワラ': 'Japanese Spanish Mackerel',
  '雷魚': 'Snakehead',
  'アイナメ': 'Greenling (Ainame)',
  'ハタ': 'Grouper (Hata)',
  'サーモン': 'Salmon',
  'サケ': 'Salmon',
  'サクラマス': 'Cherry Salmon (Masu)',
  'チヌ': 'Black Sea Bream (Chinu)',
  'ケンサキイカ': 'Swordtip Squid',
  'ヤリイカ': 'Spear Squid',
  'コウイカ': 'Cuttlefish',
  'ハゼ': 'Goby',
  'タラ': 'Cod',
  'ソルト': 'Saltwater',
  'オフショア': 'Offshore',
  // 複合名
  '青物（ブリ、ヒラマサ、カンパチ等）': 'Bluerunner (Yellowtail, Amberjack, etc.)',
  'ロックフィッシュ（カサゴ、アイナメ等）': 'Rockfish (Kasago, Ainame, etc.)',
  'トラウト（管理釣り場・ネイティブ含む）': 'Trout (Managed & Native)',
  'イカ（アオリイカ、ヤリイカ等）': 'Squid (Aori-ika, Yari-ika, etc.)',
  'チヌ・クロダイ': 'Black Sea Bream',
  // 北米魚種
  'ウォールアイ': 'Walleye',
  'クラッピー': 'Crappie',
  'シートラウト': 'Seatrout',
  'ストライパー': 'Striped Bass',
  'スヌーク': 'Snook',
  'パイク': 'Pike',
  'パンフィッシュ': 'Panfish',
  'パーチ': 'Perch',
  'レッドフィッシュ': 'Redfish',
  'ブルーフィッシュ': 'Bluefish',
};

// ── アクション ──
export const ACTION_TYPE_EN: Record<string, string> = {
  'ウォブリング': 'Wobbling',
  'ローリング': 'Rolling',
  'ウォブンロール': 'Wobble & Roll',
  'ダート': 'Darting',
  'バイブレーション': 'Vibrating',
  'フラッタリング': 'Fluttering',
  'フォール': 'Falling',
  'スラローム': 'S-Action (Slalom)',
  'ドッグウォーク': 'Walk-the-Dog',
  'スイミング': 'Swimming',
  'テールスピン': 'Tail Spin',
  // タイプ表示に使われるケースも
  'フローティング': 'Floating',
  'シンキング': 'Sinking',
  'サスペンド': 'Suspending',
  'スローシンキング': 'Slow Sinking',
  'ファストシンキング': 'Fast Sinking',
  'スローフローティング': 'Slow Floating',
};

// ── フィールド名 ──
export const FIELD_NAME_EN: Record<string, string> = {
  '港湾・堤防': 'Harbor / Pier',
  '河川・河口': 'River / Estuary',
  'サーフ': 'Surf (Beach)',
  '磯': 'Rocky Shore',
  'ボート・オフショア': 'Offshore / Boat',
  '管理釣り場': 'Managed Fishing Area',
  '渓流': 'Mountain Stream',
  '湖': 'Lake',
  '野池': 'Farm Pond',
  'リザーバー': 'Reservoir',
};

// ── 季節 ──
export const SEASON_NAME_EN: Record<string, string> = {
  '春': 'Spring',
  '夏': 'Summer',
  '秋': 'Autumn',
  '冬': 'Winter',
  '通年': 'Year-round',
};

// ── 価格ポジション（5段階）──
export const PRICE_POSITION_EN: Record<string, string> = {
  'エントリーモデル（カテゴリ内で価格帯が低め）': 'Entry Level (budget-friendly in category)',
  'コスパ良好（カテゴリ平均以下の価格帯）': 'Great Value (below category average)',
  'スタンダード（カテゴリ平均的な価格帯）': 'Standard (category average)',
  'ハイスペック（カテゴリ平均以上の価格帯）': 'High-End (above category average)',
  'プレミアムクラス（カテゴリ最上位の価格帯）': 'Premium (top tier in category)',
};

// ── カラー系統 ──
export const COLOR_CATEGORY_EN: Record<string, string> = {
  'ナチュラル系': 'Natural / Baitfish',
  'チャート系': 'Chartreuse',
  'グロー・ケイムラ系': 'Glow / UV',
  'レッド系': 'Red',
  'ゴールド系': 'Gold',
  'シルバー系': 'Silver / Chrome',
  'ピンク系': 'Pink',
  'オレンジ系': 'Orange',
  'ブルー系': 'Blue',
  'グリーン系': 'Green',
  'パープル系': 'Purple',
  'その他': 'Other',
};

// ── 釣法・テクニック用語 ──
export const TECHNIQUE_EN: Record<string, string> = {
  'ただ巻き': 'Steady Retrieve',
  'ストップ＆ゴー': 'Stop & Go',
  'トゥイッチ': 'Twitching',
  'ジャーク': 'Jerking',
  'リフト＆フォール': 'Lift & Fall',
  'フォール': 'Fall / Drop',
  'ボトムバンプ': 'Bottom Bumping',
  'デッドスティック': 'Dead Stick',
  'ドリフト': 'Drifting',
  'スキッピング': 'Skipping',
  'ドッグウォーク': 'Walk-the-Dog',
  'シェイク': 'Shaking',
  'ミドスト': 'Mid-Strolling',
  'ネコリグ': 'Neko Rig',
  'ダウンショット': 'Drop Shot',
  'テキサスリグ': 'Texas Rig',
  'キャロライナリグ': 'Carolina Rig',
  'ノーシンカー': 'Weightless (No Sinker)',
  'ワッキーリグ': 'Wacky Rig',
  'バチ抜け': 'Worm Hatch Pattern',
  'コノシロパターン': 'Gizzard Shad Pattern',
  'マイクロベイト': 'Micro Baitfish Pattern',
  'ショアジギング': 'Shore Jigging',
  'オフショアジギング': 'Offshore Jigging',
  'エギング': 'Eging (Squid Jigging)',
  'アジング': 'Ajing (Horse Mackerel)',
  'メバリング': 'Mebaring (Rockfish)',
  'チニング': 'Chining (Sea Bream)',
  'タイラバ': 'Tai Rubber Fishing',
  'シーバスゲーム': 'Seabass Game',
  'ロックフィッシュゲーム': 'Rockfish Game',
  'サーフゲーム': 'Surf Fishing',
};

// ── フィールド対応度マーク ──
export const RATING_EN: Record<string, string> = {
  '◎': '◎ Excellent',
  '○': '○ Good',
  '△': '△ Fair',
  '×': '× Poor',
};
