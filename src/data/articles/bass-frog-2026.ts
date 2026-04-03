import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-frog-2026',
  type: 'data-analysis',
  title: 'バス対応フロッグ 全121種一覧【2026年版】',
  h1: 'ブラックバス対応フロッグ 全121種一覧',
  description:
    'CAST/LOGデータベースのブラックバス対応フロッグ121種を集計。Lunkerhuntが17種で最多、Strike King（11種）、TIEMCO・SPRO（各10種）が続く。価格帯・メーカー別・重量帯の内訳を掲載。',
  mainKeyword: 'バス フロッグ 一覧',
  subKeywords: [
    'バス フロッグ 種類',
    'ブラックバス フロッグ 2026',
    'バス釣り フロッグ おすすめ',
    'バス フロッグ メーカー',
  ],
  targetFish: ['ブラックバス'],
  targetTypes: ['フロッグ'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応フロッグは121種（2026-04-04時点）。メーカー別ではLunkerhuntが17種で最多、次いでStrike King（11種）、TIEMCO・SPRO（各10種）の順。価格帯別・メーカー別・重量帯の内訳を集計した。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP12',
      body: '121種をメーカー別に集計。Lunkerhuntが17種で最多。Strike King（11種）、TIEMCO・SPRO（各10種）、Viva（9種）が続く。国内外合わせて30メーカーのフロッグが登録されている。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['Lunkerhunt', '17種'],
          ['Strike King', '11種'],
          ['TIEMCO', '10種'],
          ['SPRO', '10種'],
          ['Viva', '9種'],
          ['JACKALL', '7種'],
          ['EVERGREEN', '5種'],
          ['LiveTarget', '5種'],
          ['BOTTOMUP', '5種'],
          ['Gary Yamamoto', '5種'],
          ['Megabass', '4種'],
          ['Z-Man', '4種'],
        ],
        criteria:
          'CAST/LOGデータベースのメーカー別集計（2026-04-04時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている105種を価格帯別に集計。1,001〜2,000円帯が67種で最多（63.8%）。2,001〜3,000円帯が19種（18.1%）、1,000円以下が14種（13.3%）で続く。平均価格は1,804円。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜1,000円', '14種'],
          ['1,001〜2,000円', '67種'],
          ['2,001〜3,000円', '19種'],
          ['3,001円〜', '5種'],
          ['価格未登録', '16種'],
        ],
        criteria:
          'CAST/LOGデータベースの価格帯集計（2026-04-04時点）',
      },
    },
    {
      heading: '重量帯の分布',
      body: '重量が登録されている70種の重量帯は2.5g〜66.0g。フロッグはカバー攻略用のコンパクトな軽量モデルからビッグバス狙いの大型モデルまで幅広い重量帯で展開されている。',
    },
  ],
  faq: [
    {
      question:
        'CAST/LOGに登録されているバス向けフロッグは何種類？',
      answer:
        '2026-04-04時点で121種。type=フロッグかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question:
        'バス向けフロッグのメーカーで最も商品数が多いのは？',
      answer:
        'Lunkerhuntが17種で最多。次いでStrike King11種、TIEMCO・SPRO各10種の順（CAST/LOGデータベース2026-04-04時点）。',
    },
    {
      question: 'バス向けフロッグの価格帯で最も多いのは？',
      answer:
        '1,001〜2,000円帯が67種で最多（価格登録済み105種中63.8%）。平均価格は1,804円（CAST/LOGデータベース2026-04-04時点）。',
    },
    {
      question: 'バス向けフロッグの重量帯は？',
      answer:
        '重量登録済み70種で2.5g〜66.0g。コンパクトモデルからビッグフロッグまで幅広く登録されている（CAST/LOGデータベース2026-04-04時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-worm-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-04-04',
  updatedAt: '2026-04-04',
  dataAsOf: '2026-04-04',
};

export default article;
