import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'seabass-swimbait-2026',
  type: 'data-analysis',
  title: 'シーバス対応スイムベイト 全19種一覧【2026年版】',
  h1: 'シーバス対応スイムベイト 全19種一覧【2026年版】',
  description: 'CAST/LOGデータベースのシーバス対応スイムベイト19種を集計。BlueBlue（4種）・Major Craft（3種）が最多。ウェイト別では30g超が10種と半数超。価格帯・メーカー別の内訳を掲載。',
  mainKeyword: 'シーバス スイムベイト',
  subKeywords: ['シーバス スイムベイト 一覧', 'シーバス スイムベイト 種類', 'シーバス スイムベイト 2026'],
  targetFish: ['シーバス'],
  targetTypes: ['スイムベイト'],
  lead: 'CAST/LOGデータベースに登録されているシーバス対応スイムベイトは19種（2026-03-31時点）。メーカー別・ウェイト帯別・価格帯別の内訳を集計した。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数（全9メーカー）',
      body: 'シーバス対応スイムベイトを持つメーカーは9社。BlueBlueが4種で最多、次いでMajor Craft（3種）。DAIWAとFish Arrow、HIDEUP、Megabass、Rapalaがそれぞれ2種を持つ。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['BlueBlue', '4種'],
          ['Major Craft', '3種'],
          ['DAIWA', '2種'],
          ['Fish Arrow', '2種'],
          ['HIDEUP', '2種'],
          ['Megabass', '2種'],
          ['Rapala', '2種'],
          ['がまかつ', '1種'],
          ['Gary Yamamoto', '1種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-03-31時点）',
      },
    },
    {
      heading: 'ウェイト帯別の商品数',
      body: 'ウェイトが登録されている19種を帯域別に集計。30g超が10種（52.6%）と半数超を占める。10g以下の軽量モデルも3種存在する。',
      comparisonTable: {
        headers: ['ウェイト帯', '商品数', '割合'],
        rows: [
          ['10g以下', '3種', '15.8%'],
          ['11〜20g', '1種', '5.3%'],
          ['21〜30g', '1種', '5.3%'],
          ['30g超', '10種', '52.6%'],
          ['ウェイト未登録', '4種', '21.1%'],
        ],
        criteria: 'CAST/LOGデータベースのウェイト集計（2026-03-31時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている16種を価格帯別に集計。3,001円以上の高価格帯が9種（56.3%）で過半数を占める。501〜1,000円帯に3種、1,001〜2,000円帯に4種存在する。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜500円', '0種'],
          ['501〜1,000円', '3種'],
          ['1,001〜2,000円', '4種'],
          ['2,001〜3,000円', '0種'],
          ['3,001円〜', '9種'],
          ['価格未登録', '3種'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-03-31時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているシーバス向けスイムベイトは何種類？',
      answer: '2026-03-31時点で19種。シーバスを対象魚に含み、タイプがスイムベイトの商品を集計している。',
    },
    {
      question: 'シーバス向けスイムベイトのメーカーで最も商品数が多いのは？',
      answer: 'BlueBlueが4種で最多。次いでMajor Craft3種、DAIWA・Fish Arrow・HIDEUP・Megabass・Rapalaが各2種（CAST/LOGデータベース2026-03-31時点）。',
    },
    {
      question: 'シーバス向けスイムベイトのウェイト帯で最も多いのは？',
      answer: '30g超が10種（52.6%）で最多。ビッグベイト寄りのヘビーモデルが主流（CAST/LOGデータベース2026-03-31時点）。',
    },
    {
      question: 'シーバス向けスイムベイトの価格帯で最も多いのは？',
      answer: '3,001円以上が9種（価格登録済み16種中56.3%）で最多。スイムベイトは他のタイプと比べ高価格帯の割合が高い（CAST/LOGデータベース2026-03-31時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['lure-type-share'],
  publishedAt: '2026-03-31',
  updatedAt: '2026-03-31',
  dataAsOf: '2026-03-31',
};

export default article;
