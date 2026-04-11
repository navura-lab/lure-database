import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-shad-2026',
  type: 'data-analysis',
  title: 'バス対応シャッド 全60種一覧【2026年版】',
  h1: 'ブラックバス対応シャッド 全60種一覧',
  description: 'CAST/LOGデータベースのブラックバス対応シャッド60種を集計。O.S.PとMegabassが各7種で最多、次いでViva（6種）、EVERGREEN（5種）。価格帯・メーカー別・カラー展開数の内訳を掲載。',
  mainKeyword: 'バス シャッド 一覧',
  subKeywords: ['バス シャッド 種類', 'ブラックバス シャッド 2026', 'バス釣り シャッド おすすめ', 'シャッド ルアー メーカー'],
  targetFish: ['ブラックバス'],
  targetTypes: ['シャッド'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応シャッドは60種（2026-04-11時点）。メーカー別ではO.S.PとMegabassが各7種で最多、次いでViva（6種）、EVERGREEN INTERNATIONAL（5種）の順。価格帯は1,501〜2,000円が33種で最多。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数',
      body: '60種を22メーカー別に集計。O.S.PとMegabassが各7種で最多。Viva（6種）、EVERGREEN INTERNATIONAL（5種）、IMAKATSU・RAID JAPAN（各4種）が続く。国内メーカーが中心だが、LUCKY CRAFTは3種で7位タイに位置する。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['O.S.P', '7種'],
          ['Megabass', '7種'],
          ['Viva', '6種'],
          ['EVERGREEN INTERNATIONAL', '5種'],
          ['IMAKATSU', '4種'],
          ['RAID JAPAN', '4種'],
          ['LUCKY CRAFT', '3種'],
          ['Nories', '3種'],
          ['ZIPBAITS', '3種'],
          ['Flash Union', '2種'],
          ['JACKALL', '2種'],
          ['HIDEUP', '2種'],
          ['DUEL', '2種'],
          ['DSTYLE', '2種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-04-11時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている50種を価格帯別に集計。1,501〜2,000円帯が33種で最多（66.0%）。2,001〜3,000円帯が7種（14.0%）、1,000円以下が6種（12.0%）で続く。平均価格は1,765円。最安はWriggle Shad（Viva）の440円、最高はエスフラット フローティング（EVERGREEN）の4,950円。',
      comparisonTable: {
        headers: ['価格帯', '商品数', '構成比'],
        rows: [
          ['〜1,000円', '6種', '12.0%'],
          ['1,001〜1,500円', '3種', '6.0%'],
          ['1,501〜2,000円', '33種', '66.0%'],
          ['2,001〜3,000円', '7種', '14.0%'],
          ['3,001円〜', '1種', '2.0%'],
          ['価格未登録', '10種', '—'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-04-11時点）',
      },
    },
    {
      heading: 'カラー展開数 TOP10',
      body: 'カラーバリエーションが多い上位10種。ベビーシャッド（LUCKY CRAFT）が392色で突出。Wobty（LUCKY CRAFT、68色）、GekiasaShad（IMAKATSU、58色）が続く。O.S.PのDUNKシリーズはDUNK 48 SP（47色）、POWER DUNK 57 SP（45色）、HighCut F（38色）と上位に3種がランクインしている。',
      comparisonTable: {
        headers: ['商品名', 'メーカー', 'カラー数', '価格'],
        rows: [
          ['ベビーシャッド', 'LUCKY CRAFT', '392色', '—'],
          ['Wobty', 'LUCKY CRAFT', '68色', '—'],
          ['GekiasaShad', 'IMAKATSU', '58色', '—'],
          ['Dilemma 60', 'IMAKATSU', '48色', '—'],
          ['DUNK 48 SP', 'O.S.P', '47色', '1,760円'],
          ['POWER DUNK 57 SP', 'O.S.P', '45色', '1,870円'],
          ['HighCut F', 'O.S.P', '38色', '1,870円'],
          ['SparkTail90', 'Viva', '36色', '946円'],
          ['EVOKE SHAD', 'deps', '36色', '1,760円'],
          ['HighCut DR SP', 'O.S.P', '33色', '1,870円'],
        ],
        criteria: 'CAST/LOGデータベースのカラー展開数集計（2026-04-11時点）',
      },
    },
    {
      heading: '他のバス向けハードベイトとの比較',
      body: 'シャッド60種は、バス向けハードベイトの中でクランクベイト（280種）やミノー（166種）に次ぐ規模。バイブレーション（76種）やペンシルベイト（63種）と同程度の商品数となっている。シャッドはクランクベイトよりタイトなウォブリングアクションで、低水温期やクリアウォーターで使われることが多い。',
      comparisonTable: {
        headers: ['タイプ', '商品数（バス向け）'],
        rows: [
          ['クランクベイト', '280種'],
          ['ミノー', '166種'],
          ['バイブレーション', '76種'],
          ['ペンシルベイト', '63種'],
          ['シャッド', '60種'],
          ['ジョイントベイト', '59種'],
          ['ポッパー', '54種'],
        ],
        criteria: 'CAST/LOGデータベースのバス対応ハードベイト集計（2026-04-11時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているバス向けシャッドは何種類？',
      answer: '2026-04-11時点で60種。type=シャッドかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question: 'バス向けシャッドのメーカーで最も商品数が多いのは？',
      answer: 'O.S.PとMegabassが各7種で同率最多。次いでViva6種、EVERGREEN INTERNATIONAL5種の順（CAST/LOGデータベース2026-04-11時点）。',
    },
    {
      question: 'バス向けシャッドの価格帯で最も多いのは？',
      answer: '1,501〜2,000円帯が33種で最多（価格登録済み50種中66.0%）。平均価格は1,765円（CAST/LOGデータベース2026-04-11時点）。',
    },
    {
      question: 'カラー展開が最も多いシャッドは？',
      answer: 'LUCKY CRAFTのベビーシャッドが392色で最多。廃番カラーを含む累計数のため、現行カラーはメーカー公式を確認のこと（CAST/LOGデータベース2026-04-11時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-crankbait-2026', 'bass-vibration-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-04-11',
  updatedAt: '2026-04-11',
  dataAsOf: '2026-04-11',
};

export default article;
