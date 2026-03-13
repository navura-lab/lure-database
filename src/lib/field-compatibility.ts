/**
 * フィールド対応度マッピング
 *
 * ルアータイプ×魚種から推定フィールド適性を返す。
 * データ駆動: タイプの特性（重量・レンジ・アクション）に基づく客観的判定。
 *
 * ◎ = 最適, ○ = 適, △ = 条件付き, — = 非推奨
 */

export type FieldRating = '◎' | '○' | '△' | '—';

export interface FieldCompatibility {
  /** フィールド名 */
  field: string;
  /** 適性 */
  rating: FieldRating;
  /** 理由（1行） */
  reason: string;
}

// タイプ別のフィールドデフォルト適性
const TYPE_FIELD_MAP: Record<string, Record<string, { rating: FieldRating; reason: string }>> = {
  'ミノー': {
    '港湾・堤防': { rating: '◎', reason: 'レンジキープしやすく常夜灯周りで威力を発揮' },
    '河川・河口': { rating: '◎', reason: 'ドリフトでの流し込みが効果的' },
    'サーフ': { rating: '○', reason: '飛距離が出るモデルなら離岸流狙いに有効' },
    '磯': { rating: '△', reason: '根掛かりリスクがあるが表層攻略には使える' },
    'ボート・オフショア': { rating: '△', reason: 'キャスティングゲームなら出番あり' },
  },
  'メタルジグ': {
    '港湾・堤防': { rating: '○', reason: 'バーチカルに探れるが根掛かり注意' },
    '河川・河口': { rating: '△', reason: '流れがあると底取りが難しい' },
    'サーフ': { rating: '◎', reason: '圧倒的な飛距離で広範囲をサーチ' },
    '磯': { rating: '◎', reason: '足場の高さを活かしたジギングに最適' },
    'ボート・オフショア': { rating: '◎', reason: 'バーチカルジギングの定番' },
  },
  'バイブレーション': {
    '港湾・堤防': { rating: '◎', reason: '広範囲サーチとリフト＆フォールで効率的' },
    '河川・河口': { rating: '○', reason: 'デイゲームのリアクション狙いに有効' },
    'サーフ': { rating: '○', reason: '飛距離が出てボトム付近を探れる' },
    '磯': { rating: '△', reason: '根掛かりリスクが高い' },
    'ボート・オフショア': { rating: '○', reason: 'キャスティングで使用可能' },
  },
  'シンキングペンシル': {
    '港湾・堤防': { rating: '◎', reason: 'ドリフトで橋脚明暗部を攻略' },
    '河川・河口': { rating: '◎', reason: '流れに乗せるドリフトが最も効果的' },
    'サーフ': { rating: '○', reason: '表層〜中層のレンジキープに向く' },
    '磯': { rating: '○', reason: 'シャローの攻略に使える' },
    'ボート・オフショア': { rating: '△', reason: '出番は少なめ' },
  },
  'ポッパー': {
    '港湾・堤防': { rating: '○', reason: 'ボイル打ちやマヅメ時に有効' },
    '河川・河口': { rating: '○', reason: '水面のベイト追い回しパターンに' },
    'サーフ': { rating: '△', reason: '波がある条件では操作しにくい' },
    '磯': { rating: '◎', reason: 'ヒラスズキやヒラマサの表層攻略に' },
    'ボート・オフショア': { rating: '◎', reason: 'オフショアキャスティングの定番' },
  },
  'ワーム': {
    '港湾・堤防': { rating: '◎', reason: 'ジグヘッドでフィネスに攻められる' },
    '河川・河口': { rating: '○', reason: 'ドリフトさせてボトム付近を攻略' },
    'サーフ': { rating: '○', reason: 'ジグヘッドで底物狙いに有効' },
    '磯': { rating: '△', reason: '根掛かりしやすい地形では不向き' },
    'ボート・オフショア': { rating: '○', reason: 'スイムベイト的な使い方も可能' },
  },
  'スピンテールジグ': {
    '港湾・堤防': { rating: '◎', reason: 'デイゲームのただ巻きで広範囲サーチ' },
    '河川・河口': { rating: '○', reason: 'ブレードのフラッシングで濁りに強い' },
    'サーフ': { rating: '◎', reason: '飛距離が出てフラットフィッシュも狙える' },
    '磯': { rating: '△', reason: '根掛かりリスクがある' },
    'ボート・オフショア': { rating: '○', reason: 'キャスティングで使用可能' },
  },
  'メタルバイブレーション': {
    '港湾・堤防': { rating: '◎', reason: 'デイゲームのリフト＆フォールが効果的' },
    '河川・河口': { rating: '◎', reason: '冬のリアクション狙いの定番' },
    'サーフ': { rating: '○', reason: '飛距離が出てボトム攻略に向く' },
    '磯': { rating: '△', reason: '根掛かりで回収困難' },
    'ボート・オフショア': { rating: '○', reason: 'バーチカルな使い方も可能' },
  },
  'エギ': {
    '港湾・堤防': { rating: '◎', reason: '足場が良くエギングに最適' },
    '河川・河口': { rating: '△', reason: 'イカの回遊次第' },
    'サーフ': { rating: '○', reason: 'サーフエギングで大型狙い' },
    '磯': { rating: '◎', reason: 'ディープエギングで大型アオリ狙い' },
    'ボート・オフショア': { rating: '◎', reason: 'ティップランエギングの定番' },
  },
  'クランクベイト': {
    '港湾・堤防': { rating: '△', reason: 'バス釣り以外での出番は少ない' },
    '河川・河口': { rating: '○', reason: 'シャローを攻めるのに有効' },
    'サーフ': { rating: '—', reason: 'レンジとフィールドが合わない' },
    '磯': { rating: '—', reason: '根掛かりで使用不可' },
    '湖・池・管理釣り場': { rating: '◎', reason: 'ストラクチャー攻略の定番' },
  },
  'スプーン': {
    '港湾・堤防': { rating: '△', reason: 'メバリング・アジングに小型スプーン' },
    '河川・河口': { rating: '◎', reason: '渓流でのドリフトが王道' },
    'サーフ': { rating: '△', reason: '飛距離が不足しがち' },
    '磯': { rating: '△', reason: '用途が限定的' },
    '湖・池・管理釣り場': { rating: '◎', reason: 'エリアトラウトの基本ルアー' },
  },
  'スピナーベイト': {
    '湖・池・管理釣り場': { rating: '◎', reason: '濁り水やカバー周りで威力を発揮' },
    '河川・河口': { rating: '○', reason: '流れの中のバス攻略に' },
    '港湾・堤防': { rating: '—', reason: 'ソルトでの出番はほぼない' },
    'サーフ': { rating: '—', reason: 'フィールドが合わない' },
    '磯': { rating: '—', reason: 'フィールドが合わない' },
  },
  'ラバージグ': {
    '湖・池・管理釣り場': { rating: '◎', reason: 'カバー撃ちの王道' },
    '河川・河口': { rating: '○', reason: 'テトラ周りの穴釣りに' },
    '港湾・堤防': { rating: '○', reason: 'チヌのボトムゲームに使える' },
    'サーフ': { rating: '—', reason: 'フィールドが合わない' },
    '磯': { rating: '△', reason: '根魚狙いなら出番あり' },
  },
  'タイラバ': {
    'ボート・オフショア': { rating: '◎', reason: 'タイラバゲームの専用ルアー' },
    '港湾・堤防': { rating: '△', reason: '水深があれば岸からも可能' },
    '河川・河口': { rating: '—', reason: 'フィールドが合わない' },
    'サーフ': { rating: '—', reason: 'フィールドが合わない' },
    '磯': { rating: '○', reason: '足元に水深がある磯なら可能' },
  },
  'ダイビングペンシル': {
    'ボート・オフショア': { rating: '◎', reason: 'オフショアキャスティングの主力' },
    '磯': { rating: '◎', reason: '磯からのショアプラッギングに最適' },
    'サーフ': { rating: '○', reason: '青物のナブラ打ちに' },
    '港湾・堤防': { rating: '△', reason: '大型プラグは足場が必要' },
    '河川・河口': { rating: '—', reason: 'フィールドが合わない' },
  },
  'ジグヘッド': {
    '港湾・堤防': { rating: '◎', reason: 'ライトゲームの基本' },
    '河川・河口': { rating: '○', reason: 'ドリフトで流す釣り方も可能' },
    'サーフ': { rating: '○', reason: 'フラットフィッシュ狙いに' },
    '磯': { rating: '△', reason: '根掛かりしやすい' },
    'ボート・オフショア': { rating: '○', reason: 'ボートメバルなどで活躍' },
  },
  'ペンシルベイト': {
    '港湾・堤防': { rating: '○', reason: 'ドッグウォークで表層攻略' },
    '河川・河口': { rating: '○', reason: '水面のベイトパターンに' },
    'サーフ': { rating: '△', reason: '凪のコンディション限定' },
    '磯': { rating: '○', reason: 'トップウォーターゲームに' },
    '湖・池・管理釣り場': { rating: '◎', reason: 'バスのトップウォーターの定番' },
  },
  'フロッグ': {
    '湖・池・管理釣り場': { rating: '◎', reason: 'ヘビーカバー攻略の専用ルアー' },
    '河川・河口': { rating: '○', reason: 'リリーパッド周りに' },
    '港湾・堤防': { rating: '—', reason: 'ソルトでの出番はない' },
    'サーフ': { rating: '—', reason: 'フィールドが合わない' },
    '磯': { rating: '—', reason: 'フィールドが合わない' },
  },
};

// フィールドの表示順
const FIELD_ORDER = ['港湾・堤防', '河川・河口', 'サーフ', '磯', 'ボート・オフショア', '湖・池・管理釣り場'];

/**
 * タイプから推定フィールド適性を返す
 * 該当なしの場合は空配列
 */
export function getFieldCompatibility(typeName: string): FieldCompatibility[] {
  const map = TYPE_FIELD_MAP[typeName];
  if (!map) return [];

  return FIELD_ORDER
    .filter(field => map[field])
    .map(field => ({
      field,
      rating: map[field].rating,
      reason: map[field].reason,
    }));
}

/** rating→CSSクラス */
export function ratingColor(rating: FieldRating): string {
  switch (rating) {
    case '◎': return 'text-green-600 font-bold';
    case '○': return 'text-blue-600';
    case '△': return 'text-amber-600';
    case '—': return 'text-gray-400';
  }
}
