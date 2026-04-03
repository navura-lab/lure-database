import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-swimbait-2026',
  type: 'data-analysis',
  title: 'バス対応スイムベイト 全191種一覧【2026年版】',
  h1: 'ブラックバス対応スイムベイト 全191種一覧【2026年版】',
  description: 'CAST/LOGデータベースのブラックバス対応スイムベイト191種を集計。6th Senseが24種で最多、次いでLive Target（18種）、IMAKATSU（15種）。価格帯・重量帯・メーカー別内訳を掲載。',
  mainKeyword: 'バス スイムベイト 一覧',
  subKeywords: ['バス スイムベイト 種類', 'ブラックバス スイムベイト 2026', 'バス釣り スイムベイト 一覧', 'スイムベイト メーカー'],
  targetFish: ['ブラックバス'],
  targetTypes: ['スイムベイト'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応スイムベイトは191種（2026-04-04時点）。メーカー別では6th Senseが24種で最多、次いでLive Target（18種）、IMAKATSU（15種）の順。価格帯は1,001〜3,000円帯に集中し、重量帯は小型（14g以下）から大型（57g超）まで幅広く分布する。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP12',
      body: '191種をメーカー別に集計。6th Senseが24種で最多。Live Target（18種）、IMAKATSU（15種）、SPRO（12種）が続く。US系メーカーが上位に多く、国内ではIMAKATSU・HideUp・JACKALLが健闘。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['6th Sense', '24種'],
          ['Live Target', '18種'],
          ['IMAKATSU', '15種'],
          ['SPRO', '12種'],
          ['Googan Baits', '11種'],
          ['HideUp', '10種'],
          ['JACKALL', '9種'],
          ['X Zone Lures', '8種'],
          ['Rapala', '7種'],
          ['Megabass', '6種'],
          ['deps', '6種'],
          ['Strike King', '6種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-04-04時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている153種を価格帯別に集計。1,001〜2,000円帯と2,001〜3,000円帯がそれぞれ41種で最多（各26.8%）。5,001円以上のプレミアムモデルも16種存在し、クランクベイト等と比較して高価格帯の比率が高い傾向がある。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜1,000円', '31種'],
          ['1,001〜2,000円', '41種'],
          ['2,001〜3,000円', '41種'],
          ['3,001〜5,000円', '24種'],
          ['5,001円〜', '16種'],
          ['価格未登録', '38種'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-04-04時点）',
      },
    },
    {
      heading: '重量帯別の商品数',
      body: '重量が登録されている96種を重量帯別に集計。29〜56g（2oz以下）帯が28種で最多。57g超の大型モデルも25種あり、ビッグベイトに近いサイズ感の商品も多い。14g以下の小型スイムベイトも25種と一定数ある。',
      comparisonTable: {
        headers: ['重量帯', '商品数'],
        rows: [
          ['〜14g（1/2oz以下）', '25種'],
          ['15〜28g（1oz以下）', '18種'],
          ['29〜56g（2oz以下）', '28種'],
          ['57g〜（2oz超）', '25種'],
        ],
        criteria: 'CAST/LOGデータベースの重量帯集計（重量登録済み96種、2026-04-04時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているバス向けスイムベイトは何種類？',
      answer: '2026-04-04時点で191種。type=スイムベイトかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question: 'バス向けスイムベイトのメーカーで最も商品数が多いのは？',
      answer: '6th Senseが24種で最多。次いでLive Target18種、IMAKATSU15種の順（CAST/LOGデータベース2026-04-04時点）。',
    },
    {
      question: 'バス向けスイムベイトの価格帯で最も多いのは？',
      answer: '1,001〜2,000円帯と2,001〜3,000円帯がそれぞれ41種で最多（価格登録済み153種中各26.8%）（CAST/LOGデータベース2026-04-04時点）。',
    },
    {
      question: 'バス向けスイムベイトで最も多い重量帯は？',
      answer: '29〜56g（2oz以下）帯が28種で最多。57g超の大型モデルも25種登録されている（重量登録済み96種、CAST/LOGデータベース2026-04-04時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-worm-2026', 'bass-crankbait-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-04-04',
  updatedAt: '2026-04-04',
  dataAsOf: '2026-04-04',
};

export default article;
