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
  // === Batch 3 (2026-03-18) ===
  { slug: 'dex-cr53mr', manufacturerSlug: 'berkley', targetKeyword: 'DEX CR53MR', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'momopunch30g-45g', manufacturerSlug: 'jumprize', targetKeyword: 'モモパンチ', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'usachanjig-ex', manufacturerSlug: 'attic', targetKeyword: 'うさちゃんジグEX', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'shiriten50', manufacturerSlug: 'madness', targetKeyword: 'シリテン50', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'boom', manufacturerSlug: 'engine', targetKeyword: 'エンジン ブーム', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  // === Batch 4 (2026-03-18) ===
  { slug: 'money-badger-4-5-625-675-725', manufacturerSlug: 'berkley', targetKeyword: 'マネーバジャー', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'trout-btkswimmer35', manufacturerSlug: 'smith', targetKeyword: 'ボトムノックスイマー35', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'one-up-shad-5-2tone', manufacturerSlug: 'sawamura', targetKeyword: 'ワンナップシャッド 5インチ 2トーン', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'kaishin-blade', manufacturerSlug: 'noike', targetKeyword: '海神ブレード', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'lft145', manufacturerSlug: 'engine', targetKeyword: 'LFT145', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  // === Batch 5 (2026-03-18) ===
  { slug: '4-front-flapper-curly', manufacturerSlug: 'nories', targetKeyword: 'フロントフラッパーカーリー', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'outstar-120s', manufacturerSlug: 'blueblue', targetKeyword: 'アウトスター 120S', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'petit-bomber70s', manufacturerSlug: 'jumprize', targetKeyword: 'プチボンバー 70S', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'sj-pencil', manufacturerSlug: 'zeake', targetKeyword: 'SJペンシル', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'jigaro-superslide', manufacturerSlug: 'palms', targetKeyword: 'ジガロ スーパースライド', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'briliant12', manufacturerSlug: 'tict', targetKeyword: 'ブリリアント 1.2', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'messiah-semilong', manufacturerSlug: 'seafloor-control', targetKeyword: 'メサイア セミロング', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'plapan', manufacturerSlug: 'tict', targetKeyword: 'プラパン', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'k2rp', manufacturerSlug: 'tacklehouse', targetKeyword: 'K2RP', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  // === Batch 6 (2026-03-18) ===
  { slug: 'dex-cr55sr', manufacturerSlug: 'berkley', targetKeyword: 'DEX CR55SR バークレイ', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'helter-twister', manufacturerSlug: 'imakatsu', targetKeyword: 'ヘルターツイスター イマカツ', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'hydram-100s', manufacturerSlug: 'valkein', targetKeyword: 'ハイドラム100S ヴァルケイン', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'furifuri-usachan-jig', manufacturerSlug: 'attic', targetKeyword: 'ふりふりうさちゃんじぐ アティック', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'yarukinashi-stick-93', manufacturerSlug: 'valleyhill', targetKeyword: 'ヤルキナシスティック93', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'over-ride', manufacturerSlug: 'osp', targetKeyword: 'オーバーライド O.S.P', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'flesh-back-80sp', manufacturerSlug: 'palms', targetKeyword: 'フレッシュバック80SP パームス', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'i-fish-ft', manufacturerSlug: 'forest', targetKeyword: 'iFish FT フォレスト', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
  { slug: 'one-up-shad-3-2tone', manufacturerSlug: 'sawamura', targetKeyword: 'ワンナップシャッド 3インチ 2トーン', deployedAt: '2026-03-18', baselinePosition: null, baselineImpressions: null, status: 'deployed' },
];
