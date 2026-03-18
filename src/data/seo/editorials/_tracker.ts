/**
 * エディトリアルデプロイ追跡
 *
 * 各エディトリアルのデプロイ日・ターゲットKW・デプロイ時のGSC順位を記録。
 * 効果測定スクリプト（scripts/seo/measure-editorials.ts）がこのデータを参照。
 */

export interface EditorialDeployRecord {
  slug: string;
  manufacturerSlug: string;
  targetKeyword: string;
  deployedAt: string;
  baselinePosition: number | null;
  baselineImpressions: number | null;
  status: 'deployed' | 'improved' | 'unchanged' | 'declined';
}

export const editorialDeployLog: EditorialDeployRecord[] = [
  // === Batch 1 (2026-03-18) ===
  { slug: 'huggos', manufacturerSlug: 'littlejack', targetKeyword: 'ハグゴス', deployedAt: '2026-03-18', baselinePosition: 7.4, baselineImpressions: 348, status: 'deployed' },
  { slug: 'gillary-01--01', manufacturerSlug: 'littlejack', targetKeyword: 'ギラリー01', deployedAt: '2026-03-18', baselinePosition: 8.0, baselineImpressions: 140, status: 'deployed' },
  { slug: 'masukurouto-loki', manufacturerSlug: 'nories', targetKeyword: 'ノリーズ ロキ', deployedAt: '2026-03-18', baselinePosition: 7.5, baselineImpressions: 78, status: 'deployed' },
  // === Batch 2 (2026-03-18) ===
  { slug: 'fs417', manufacturerSlug: 'hayabusa', targetKeyword: 'ジャックアイマキマキ', deployedAt: '2026-03-18', baselinePosition: 8.4, baselineImpressions: 51, status: 'deployed' },
  { slug: 'powerfluffy', manufacturerSlug: 'engine', targetKeyword: 'パワーフラッフィー', deployedAt: '2026-03-18', baselinePosition: 4.7, baselineImpressions: 33, status: 'deployed' },
  { slug: 'kattobi-bow130br', manufacturerSlug: 'jumprize', targetKeyword: 'かっ飛び棒130BR', deployedAt: '2026-03-18', baselinePosition: 4.8, baselineImpressions: 9, status: 'deployed' },
  { slug: 'piccolo', manufacturerSlug: 'evergreen', targetKeyword: 'ピッコロ エバーグリーン', deployedAt: '2026-03-18', baselinePosition: 10.7, baselineImpressions: 6, status: 'deployed' },
  { slug: 'buttobi-kun95s', manufacturerSlug: 'jumprize', targetKeyword: 'ぶっ飛び君95S', deployedAt: '2026-03-18', baselinePosition: 10.2, baselineImpressions: 5, status: 'deployed' },
  { slug: 'clear-s-popper', manufacturerSlug: 'jackson', targetKeyword: 'クリアSポッパー', deployedAt: '2026-03-18', baselinePosition: 4.1, baselineImpressions: 18, status: 'deployed' },
  { slug: 'one-up-curly-35', manufacturerSlug: 'sawamura', targetKeyword: 'ワンナップカーリー', deployedAt: '2026-03-18', baselinePosition: 8.6, baselineImpressions: 11, status: 'deployed' },
  { slug: 'tiny-kaishin', manufacturerSlug: 'noike', targetKeyword: 'タイニー海神', deployedAt: '2026-03-18', baselinePosition: 9.6, baselineImpressions: 9, status: 'deployed' },
  { slug: 'ebiran-bg', manufacturerSlug: 'xesta', targetKeyword: 'エビランBG', deployedAt: '2026-03-18', baselinePosition: 3.7, baselineImpressions: 6, status: 'deployed' },
  { slug: 'kingbousougaeru', manufacturerSlug: 'engine', targetKeyword: 'KING房総蛙', deployedAt: '2026-03-18', baselinePosition: 8.7, baselineImpressions: 19, status: 'deployed' },
  { slug: 'nichika167f', manufacturerSlug: 'osp', targetKeyword: 'ニチカ167F', deployedAt: '2026-03-18', baselinePosition: 7.4, baselineImpressions: 9, status: 'deployed' },
  { slug: 'toukichirou-lead', manufacturerSlug: 'bozles', targetKeyword: '藤吉郎 鉛', deployedAt: '2026-03-18', baselinePosition: 5.3, baselineImpressions: 11, status: 'deployed' },
  { slug: 'gyokotsu', manufacturerSlug: 'breaden', targetKeyword: 'ブリーデン 魚骨', deployedAt: '2026-03-18', baselinePosition: 8.8, baselineImpressions: 5, status: 'deployed' },
];
