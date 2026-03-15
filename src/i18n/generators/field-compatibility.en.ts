/**
 * 英語版フィールド対応度マッピング
 *
 * 元: src/lib/field-compatibility.ts の英語版。
 * ルアータイプ別のフィールド適性理由を英語で提供。
 */
import type { FieldRating, FieldCompatibility } from '../../lib/field-compatibility';
import { FIELD_NAME_EN } from '../dictionaries/fishing-terms';

// タイプ別のフィールドデフォルト適性（英語版）
const TYPE_FIELD_MAP_EN: Record<string, Record<string, { rating: FieldRating; reason: string }>> = {
  'ミノー': {
    '港湾・堤防': { rating: '◎', reason: 'Excellent depth control around pier lights' },
    '河川・河口': { rating: '◎', reason: 'Drift presentations are highly effective' },
    'サーフ': { rating: '○', reason: 'Long-casting models work well near rip currents' },
    '磯': { rating: '△', reason: 'Snag risk exists but useful for surface attacks' },
    'ボート・オフショア': { rating: '△', reason: 'Viable for casting games' },
  },
  'メタルジグ': {
    '港湾・堤防': { rating: '○', reason: 'Can probe vertically but watch for snags' },
    '河川・河口': { rating: '△', reason: 'Hard to maintain bottom contact in current' },
    'サーフ': { rating: '◎', reason: 'Outstanding casting distance covers vast areas' },
    '磯': { rating: '◎', reason: 'Elevated position ideal for jigging' },
    'ボート・オフショア': { rating: '◎', reason: 'The standard for vertical jigging' },
  },
  'バイブレーション': {
    '港湾・堤防': { rating: '◎', reason: 'Efficient area searching with lift & fall' },
    '河川・河口': { rating: '○', reason: 'Effective for daytime reaction bites' },
    'サーフ': { rating: '○', reason: 'Good distance and bottom exploration' },
    '磯': { rating: '△', reason: 'High snag risk' },
    'ボート・オフショア': { rating: '○', reason: 'Usable for casting games' },
  },
  'シンキングペンシル': {
    '港湾・堤防': { rating: '◎', reason: 'Perfect for drifting around bridge pillars' },
    '河川・河口': { rating: '◎', reason: 'Most effective when drifted with the current' },
    'サーフ': { rating: '○', reason: 'Good for surface-to-mid depth coverage' },
    '磯': { rating: '○', reason: 'Useful for shallow zone attacks' },
    'ボート・オフショア': { rating: '△', reason: 'Limited applications' },
  },
  'ポッパー': {
    '港湾・堤防': { rating: '○', reason: 'Effective during feeding frenzies and dawn/dusk' },
    '河川・河口': { rating: '○', reason: 'Great for surface baitfish patterns' },
    'サーフ': { rating: '△', reason: 'Difficult to operate in waves' },
    '磯': { rating: '◎', reason: 'Top-choice for surface attacks on amberjack and seabass' },
    'ボート・オフショア': { rating: '◎', reason: 'A staple for offshore casting' },
  },
  'ワーム': {
    '港湾・堤防': { rating: '◎', reason: 'Finesse jighead presentations excel' },
    '河川・河口': { rating: '○', reason: 'Drift along the bottom for flatfish' },
    'サーフ': { rating: '○', reason: 'Effective jighead presentations for flatfish' },
    '磯': { rating: '△', reason: 'Not ideal for snag-prone terrain' },
    'ボート・オフショア': { rating: '○', reason: 'Can be used swimbait-style' },
  },
  'スピンテールジグ': {
    '港湾・堤防': { rating: '◎', reason: 'Steady retrieve for daytime area searching' },
    '河川・河口': { rating: '○', reason: 'Blade flash cuts through murky water' },
    'サーフ': { rating: '◎', reason: 'Good distance; also catches flatfish' },
    '磯': { rating: '△', reason: 'Snag risk present' },
    'ボート・オフショア': { rating: '○', reason: 'Usable for casting applications' },
  },
  'メタルバイブレーション': {
    '港湾・堤防': { rating: '◎', reason: 'Daytime lift & fall is highly effective' },
    '河川・河口': { rating: '◎', reason: 'A winter reaction bite staple' },
    'サーフ': { rating: '○', reason: 'Good distance for bottom exploration' },
    '磯': { rating: '△', reason: 'Difficult to retrieve from snags' },
    'ボート・オフショア': { rating: '○', reason: 'Vertical approaches also work' },
  },
  'エギ': {
    '港湾・堤防': { rating: '◎', reason: 'Stable footing makes piers ideal for eging' },
    '河川・河口': { rating: '△', reason: 'Depends on squid migration' },
    'サーフ': { rating: '○', reason: 'Surf eging for large specimens' },
    '磯': { rating: '◎', reason: 'Deep eging for trophy bigfin reef squid' },
    'ボート・オフショア': { rating: '◎', reason: 'A staple for tip-run eging' },
  },
  'クランクベイト': {
    '港湾・堤防': { rating: '△', reason: 'Limited use outside bass fishing' },
    '河川・河口': { rating: '○', reason: 'Effective for shallow attacks' },
    'サーフ': { rating: '—', reason: 'Depth and field mismatch' },
    '磯': { rating: '—', reason: 'Impossible due to snags' },
    '湖・池・管理釣り場': { rating: '◎', reason: 'The standard for structure fishing' },
  },
  'スプーン': {
    '港湾・堤防': { rating: '△', reason: 'Small spoons for mebaru/aji light game' },
    '河川・河口': { rating: '◎', reason: 'Stream drift is a classic technique' },
    'サーフ': { rating: '△', reason: 'Lacks casting distance' },
    '磯': { rating: '△', reason: 'Limited applications' },
    '湖・池・管理釣り場': { rating: '◎', reason: 'The fundamental lure for area trout' },
  },
  'スピナーベイト': {
    '湖・池・管理釣り場': { rating: '◎', reason: 'Excels in murky water and around cover' },
    '河川・河口': { rating: '○', reason: 'For targeting bass in current' },
    '港湾・堤防': { rating: '—', reason: 'Virtually no saltwater applications' },
    'サーフ': { rating: '—', reason: 'Field mismatch' },
    '磯': { rating: '—', reason: 'Field mismatch' },
  },
  'ラバージグ': {
    '湖・池・管理釣り場': { rating: '◎', reason: 'The king of cover flipping' },
    '河川・河口': { rating: '○', reason: 'Pitch into tetrapods and holes' },
    '港湾・堤防': { rating: '○', reason: 'Viable for bottom-bouncing sea bream' },
    'サーフ': { rating: '—', reason: 'Field mismatch' },
    '磯': { rating: '△', reason: 'Can work for rockfish' },
  },
  'タイラバ': {
    'ボート・オフショア': { rating: '◎', reason: 'The dedicated lure for tai rubber fishing' },
    '港湾・堤防': { rating: '△', reason: 'Possible from shore if water is deep enough' },
    '河川・河口': { rating: '—', reason: 'Field mismatch' },
    'サーフ': { rating: '—', reason: 'Field mismatch' },
    '磯': { rating: '○', reason: 'Viable from reefs with deep water at your feet' },
  },
  'ダイビングペンシル': {
    'ボート・オフショア': { rating: '◎', reason: 'A mainstay of offshore casting' },
    '磯': { rating: '◎', reason: 'Ideal for shore plugging' },
    'サーフ': { rating: '○', reason: 'For targeting bluerunner surface feeds' },
    '港湾・堤防': { rating: '△', reason: 'Large plugs need elevated positions' },
    '河川・河口': { rating: '—', reason: 'Field mismatch' },
  },
  'ジグヘッド': {
    '港湾・堤防': { rating: '◎', reason: 'The foundation of light game fishing' },
    '河川・河口': { rating: '○', reason: 'Drift presentations also possible' },
    'サーフ': { rating: '○', reason: 'For flatfish targeting' },
    '磯': { rating: '△', reason: 'Snag-prone' },
    'ボート・オフショア': { rating: '○', reason: 'Effective for boat mebaru etc.' },
  },
  'ペンシルベイト': {
    '港湾・堤防': { rating: '○', reason: 'Walk-the-dog surface attacks' },
    '河川・河口': { rating: '○', reason: 'For surface baitfish patterns' },
    'サーフ': { rating: '△', reason: 'Calm conditions only' },
    '磯': { rating: '○', reason: 'Topwater game applications' },
    '湖・池・管理釣り場': { rating: '◎', reason: 'A bass topwater classic' },
  },
  'フロッグ': {
    '湖・池・管理釣り場': { rating: '◎', reason: 'The dedicated heavy cover lure' },
    '河川・河口': { rating: '○', reason: 'Around lily pads' },
    '港湾・堤防': { rating: '—', reason: 'No saltwater applications' },
    'サーフ': { rating: '—', reason: 'Field mismatch' },
    '磯': { rating: '—', reason: 'Field mismatch' },
  },
};

// フィールドの表示順
const FIELD_ORDER = ['港湾・堤防', '河川・河口', 'サーフ', '磯', 'ボート・オフショア', '湖・池・管理釣り場'];

/**
 * タイプから推定フィールド適性を英語で返す
 */
export function getFieldCompatibilityEn(typeName: string): FieldCompatibility[] {
  const map = TYPE_FIELD_MAP_EN[typeName];
  if (!map) return [];

  return FIELD_ORDER
    .filter(field => map[field])
    .map(field => ({
      field: FIELD_NAME_EN[field] ?? field,
      rating: map[field].rating,
      reason: map[field].reason,
    }));
}
