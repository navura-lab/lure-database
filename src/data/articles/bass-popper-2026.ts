import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-popper-2026',
  type: 'data-analysis',
  title: 'バス対応ポッパー 全59種一覧【2026年版】',
  h1: 'ブラックバス対応ポッパー 全59種一覧',
  description:
    'CAST/LOGデータベースのブラックバス対応ポッパー59種を集計。Smithが9種で最多、EVERGREEN（6種）、Megabass・deps（各5種）が続く。22メーカーの価格帯・重量帯の内訳を掲載。',
  mainKeyword: 'バス ポッパー 一覧',
  subKeywords: [
    'バス ポッパー 種類',
    'ブラックバス ポッパー 2026',
    'バス釣り ポッパー メーカー',
    'バス ポッパー おすすめ',
  ],
  targetFish: ['ブラックバス'],
  targetTypes: ['ポッパー'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応ポッパーは59種（2026-04-06時点）。メーカー別ではSmithが9種で最多、次いでEVERGREEN（6種）、Megabass・deps（各5種）の順。国内外22メーカーのポッパーが登録されている。価格帯別・メーカー別・重量帯の内訳を集計した。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP12',
      body: '59種をメーカー別に集計。Smithが9種で最多。EVERGREEN（6種）、Megabass・deps（各5種）、O.S.P・imakatsu（各4種）が続く。国内メーカーが中心だが、Lucky Craft・Gary Yamamoto・Berkley・Strike King・SPROなど海外展開ブランドも登録されている。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['Smith', '9種'],
          ['EVERGREEN', '6種'],
          ['Megabass', '5種'],
          ['deps', '5種'],
          ['O.S.P', '4種'],
          ['imakatsu', '4種'],
          ['Lucky Craft', '3種'],
          ['SHIMANO', '3種'],
          ['Gary Yamamoto', '3種'],
          ['Berkley', '2種'],
          ['JACKALL', '2種'],
          ['TIEMCO', '2種'],
        ],
        criteria:
          'CAST/LOGデータベースのメーカー別集計（2026-04-06時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている36種を価格帯別に集計。1,001〜2,000円帯が15種で最多（41.7%）。2,001〜3,000円帯が11種（30.6%）で続く。平均価格は2,350円。最安は650円、最高は8,800円で、大型ポッパーほど高価格帯に位置する傾向がある。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜1,000円', '5種'],
          ['1,001〜2,000円', '15種'],
          ['2,001〜3,000円', '11種'],
          ['3,001円〜', '5種'],
          ['価格未登録', '23種'],
        ],
        criteria:
          'CAST/LOGデータベースの価格帯集計（2026-04-06時点）',
      },
    },
    {
      heading: '重量帯の分布',
      body: '重量が登録されている44種の重量帯は2.6g〜107g。バス用ポッパーはフィネスな小型モデルからビッグベイト級の大型モデルまで幅広い重量帯で展開されている。トップウォーター全般に言えることだが、軽量モデルはスピニングタックル、重量級モデルはベイトタックルでの使用が前提となる。',
    },
  ],
  faq: [
    {
      question:
        'CAST/LOGに登録されているバス向けポッパーは何種類？',
      answer:
        '2026-04-06時点で59種。type=ポッパーかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question:
        'バス向けポッパーのメーカーで最も商品数が多いのは？',
      answer:
        'Smithが9種で最多。次いでEVERGREEN 6種、Megabass・deps各5種の順（CAST/LOGデータベース2026-04-06時点）。',
    },
    {
      question: 'バス向けポッパーの価格帯で最も多いのは？',
      answer:
        '1,001〜2,000円帯が15種で最多（価格登録済み36種中41.7%）。平均価格は2,350円（CAST/LOGデータベース2026-04-06時点）。',
    },
    {
      question: 'バス向けポッパーの重量帯は？',
      answer:
        '重量登録済み44種で2.6g〜107g。小型フィネスポッパーからビッグベイト級まで幅広く登録されている（CAST/LOGデータベース2026-04-06時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-worm-2026', 'bass-frog-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-04-06',
  updatedAt: '2026-04-06',
  dataAsOf: '2026-04-06',
};

export default article;
