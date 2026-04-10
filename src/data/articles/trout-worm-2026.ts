import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'trout-worm-2026',
  type: 'data-analysis',
  title: 'トラウト用ワーム 全94種一覧【2026年版】',
  h1: 'トラウト用ワーム 全94種一覧【2026年版】',
  description: 'CAST/LOGデータベースのトラウト用ワーム94種を集計。Berkley (US)が71種で全体の75.5%を占め圧倒的最多。価格帯は500〜800円が62種（66.0%）。カラー展開数・メーカー別分析も掲載。',
  mainKeyword: 'トラウト ワーム 一覧',
  subKeywords: ['トラウト ワーム おすすめ', 'トラウト ソフトベイト 種類', 'PowerBait トラウト', 'トラウト ワーム メーカー'],
  targetFish: ['トラウト'],
  targetTypes: ['ワーム'],
  lead: 'CAST/LOGデータベースに登録されているトラウト対応ワーム（ソフトベイト）は94種（2026-04-10時点）。トラウト用ワーム市場はBerkley (US)のPowerBait・Gulp!シリーズが圧倒的なシェアを占めるのが特徴で、全94種中71種がBerkley製品。メーカー別・価格帯別・カラー展開数の集計を行った。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数（全10社）',
      body: '94種を製造メーカー別に集計。Berkley (US)が71種で全体の75.5%を占め圧倒的。Z-Man（10種）が2位、Jackson（3種）が3位。国内メーカーはJackson・Viva・Bassday・HMKL・ZIPBAITSなど6社が参入しているが、合計10種にとどまる。トラウト用ワームはBerkleyのPowerBait・Gulp!ブランドがカテゴリの標準となっている。',
      comparisonTable: {
        headers: ['メーカー', '商品数', '割合'],
        rows: [
          ['Berkley (US)', '71種', '75.5%'],
          ['Z-Man', '10種', '10.6%'],
          ['Jackson', '3種', '3.2%'],
          ['Viva', '2種', '2.1%'],
          ['Lunker City', '2種', '2.1%'],
          ['Lunkerhunt', '2種', '2.1%'],
          ['Bassday', '1種', '1.1%'],
          ['Palms', '1種', '1.1%'],
          ['HMKL', '1種', '1.1%'],
          ['ZIPBAITS', '1種', '1.1%'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-04-10時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '全94種に価格が登録されている。最安値は385円（Viva N\'Saturn R）、最高値は2,508円（ZIPBAITS リッジ 90MNシークレット）。500〜800円帯が62種で最多（66.0%）。Berkley製品の多くがこの価格帯に集中しており、トラウト用ワームは比較的手頃な価格帯が主流。1,000円以上は14種で全体の14.9%。',
      comparisonTable: {
        headers: ['価格帯', '商品数', '割合'],
        rows: [
          ['〜500円', '3種', '3.2%'],
          ['501〜800円', '62種', '66.0%'],
          ['801〜1,000円', '15種', '16.0%'],
          ['1,001〜1,500円', '6種', '6.4%'],
          ['1,501円〜', '8種', '8.5%'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-04-10時点・全94種）',
      },
    },
    {
      heading: 'カラー展開数 TOP10',
      body: 'DBに登録されているカラーバリエーション数の上位10商品。Berkley PowerBait Pre-Rigged Atomic Teasersが78色で最多、同Atomic Tubesが72色で続く。Gulp! Alive! Minnowが60色、国内メーカーではViva N\'Saturn Rが53色と健闘。トラウト用ワームはカラーローテーションが重要なため、定番モデルほどカラー展開が豊富になる傾向がある。',
      comparisonTable: {
        headers: ['商品名', 'メーカー', 'カラー数'],
        rows: [
          ['PowerBait® Pre-Rigged Atomic Teasers', 'Berkley (US)', '78色'],
          ['PowerBait® Pre-Rigged Atomic Tubes', 'Berkley (US)', '72色'],
          ['Gulp! Alive!® Minnow', 'Berkley (US)', '60色'],
          ['Viva N\'Saturn R（サターンR）', 'Viva', '53色'],
          ['Gulp!® Minnow', 'Berkley (US)', '33色'],
          ['PowerBait® Trout Bait', 'Berkley (US)', '33色'],
          ['PowerBait® The Champ Minnow', 'Berkley (US)', '27色'],
          ['PowerBait® Natural Glitter Trout Bait', 'Berkley (US)', '25色'],
          ['1.5" Hellgie', 'Lunker City', '24色'],
          ['PowerBait® Power® Floating Trout Worm', 'Berkley (US)', '24色'],
        ],
        criteria: 'CAST/LOGデータベースのカラー登録数（2026-04-10時点）',
      },
    },
    {
      heading: 'Berkleyブランド別の内訳',
      body: 'Berkley (US)の71種をブランド別に分類。PowerBaitシリーズが44種（62.0%）で最多、Gulp!シリーズが19種（26.8%）、Gulp! Alive!シリーズが8種（11.3%）。PowerBaitは練りエサタイプ（Dough/Bait）からワーム型・エッグ型まで幅広い形状をカバー。Gulp!は生分解性素材を使用した匂い付きソフトベイトで、Alive!はリキッド保存タイプの上位版。',
      comparisonTable: {
        headers: ['ブランド', '商品数', '割合（Berkley内）'],
        rows: [
          ['PowerBait®', '44種', '62.0%'],
          ['Gulp!®', '19種', '26.8%'],
          ['Gulp! Alive!®', '8種', '11.3%'],
        ],
        criteria: 'CAST/LOGデータベースのBerkley (US)製品71種のブランド別集計（2026-04-10時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているトラウト用ワームは何種類？',
      answer: '2026-04-10時点で94種。対象魚にトラウトを含むワーム（ソフトベイト）を集計している。',
    },
    {
      question: 'トラウト用ワームで最も商品数が多いメーカーは？',
      answer: 'Berkley (US)が71種（75.5%）で圧倒的最多。PowerBait・Gulp!・Gulp! Alive!の3ブランドで展開している（CAST/LOGデータベース2026-04-10時点）。',
    },
    {
      question: 'トラウト用ワームの価格帯で最も多いのは？',
      answer: '501〜800円帯が62種（66.0%）で最多。Berkley製品の大半がこの価格帯に集中している（CAST/LOGデータベース2026-04-10時点）。',
    },
    {
      question: 'カラー展開が最も豊富なトラウト用ワームは？',
      answer: 'Berkley PowerBait Pre-Rigged Atomic Teasersの78色が最多。Atomic Tubes 72色、Gulp! Alive! Minnow 60色が続く（CAST/LOGデータベース2026-04-10時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['trout-lures-2026', 'trout-spoon-2026', 'trout-minnow-2026', 'trout-crankbait-2026'],
  publishedAt: '2026-04-10',
  updatedAt: '2026-04-10',
  dataAsOf: '2026-04-10',
};

export default article;
