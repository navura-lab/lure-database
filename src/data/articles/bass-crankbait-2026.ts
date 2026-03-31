import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-crankbait-2026',
  type: 'data-analysis',
  title: 'バス対応クランクベイト 全105種一覧【2026年版】',
  h1: 'ブラックバス対応クランクベイト 全105種一覧【2026年版】',
  description: 'CAST/LOGデータベースのブラックバス対応クランクベイト105種を集計。6th Senseが20種で最多、次いでO.S.P（12種）、HideUp（10種）、Evergreen（9種）。価格帯・メーカー別内訳を掲載。',
  mainKeyword: 'バス クランクベイト 一覧',
  subKeywords: ['バス クランクベイト 種類', 'ブラックバス クランク 2026', 'バス釣り クランクベイト 一覧', 'バス クランク メーカー'],
  targetFish: ['ブラックバス'],
  targetTypes: ['クランクベイト'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応クランクベイトは105種（2026-03-31時点）。メーカー別では6th Senseが20種で最多、次いでO.S.P（12種）、HideUp（10種）の順。価格帯別・メーカー別の内訳を集計した。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP12',
      body: '105種をメーカー別に集計。6th Senseが20種で最多。O.S.P（12種）、HideUp（10種）、Evergreen（9種）、DAIWA（7種）が続く。国内外双方のメーカーが上位に並ぶ。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['6th Sense', '20種'],
          ['O.S.P', '12種'],
          ['HideUp', '10種'],
          ['Evergreen', '9種'],
          ['DAIWA', '7種'],
          ['Strike King', '6種'],
          ['JACKALL', '5種'],
          ['IMAKATSU', '5種'],
          ['Megabass', '4種'],
          ['GANCRAFT', '4種'],
          ['VIVA', '3種'],
          ['RAID', '3種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-03-31時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている92種を価格帯別に集計。1,001〜2,000円帯が72種で最多（78.3%）。2,001〜3,000円帯が16種（17.4%）で続く。3,001円以上は3種、1,000円以下は1種のみ。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜1,000円', '1種'],
          ['1,001〜2,000円', '72種'],
          ['2,001〜3,000円', '16種'],
          ['3,001円〜', '3種'],
          ['価格未登録', '13種'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-03-31時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているバス向けクランクベイトは何種類？',
      answer: '2026-03-31時点で105種。type=クランクベイトかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question: 'バス向けクランクベイトのメーカーで最も商品数が多いのは？',
      answer: '6th Senseが20種で最多。次いでO.S.P12種、HideUp10種の順（CAST/LOGデータベース2026-03-31時点）。',
    },
    {
      question: 'バス向けクランクベイトの価格帯で最も多いのは？',
      answer: '1,001〜2,000円帯が72種で最多（価格登録済み92種中78.3%）（CAST/LOGデータベース2026-03-31時点）。',
    },
    {
      question: 'バス向けクランクベイトのうち3,000円を超える商品はある？',
      answer: '3,001円以上の商品が3種登録されている（CAST/LOGデータベース2026-03-31時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-worm-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-03-31',
  updatedAt: '2026-03-31',
  dataAsOf: '2026-03-31',
};

export default article;
