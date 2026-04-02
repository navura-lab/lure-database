import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-spinnerbait-2026',
  type: 'data-analysis',
  title: 'バス対応スピナーベイト 全160種一覧【2026年版】',
  h1: 'ブラックバス対応スピナーベイト全160種一覧',
  description: 'CAST/LOGデータベースのブラックバス対応スピナーベイト160種を集計。Strike Kingが58種で最多、次いでBerkley US（9種）、ノリーズ・VIVA・エンジン（各6種）。価格帯・メーカー別内訳を掲載。',
  mainKeyword: 'バス スピナーベイト 一覧',
  subKeywords: ['バス スピナーベイト 種類', 'ブラックバス スピナーベイト 2026', 'バス釣り スピナーベイト 一覧', 'スピナーベイト メーカー'],
  targetFish: ['ブラックバス'],
  targetTypes: ['スピナーベイト'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応スピナーベイトは160種（2026-04-03時点）。メーカー別ではStrike Kingが58種で圧倒的最多、次いでBerkley US（9種）、ノリーズ・VIVA・エンジン（各6種）の順。価格帯では1,001〜1,500円帯が71種で最多。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP12',
      body: '160種をメーカー別に集計。Strike Kingが58種で全体の36.3%を占め圧倒的最多。Berkley US（9種）、ノリーズ・VIVA・エンジン（各6種）が続く。国内メーカーではノリーズ・VIVA・エンジンが同数で並ぶ。33メーカーが登録されており、1〜2種のみのメーカーが16社ある。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['Strike King', '58種'],
          ['Berkley US', '9種'],
          ['ノリーズ', '6種'],
          ['VIVA', '6種'],
          ['エンジン', '6種'],
          ['Evergreen', '5種'],
          ['O.S.P', '5種'],
          ['BOTTOMUP', '5種'],
          ['D-STYLE', '5種'],
          ['JACKALL', '5種'],
          ['deps', '5種'],
          ['Googan Baits', '4種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-04-03時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている153種を価格帯別に集計。1,001〜1,500円帯が71種で最多（46.4%）。1,000円以下が28種（18.3%）、1,501〜2,000円帯が38種（24.8%）。2,000円以下で合計137種（89.5%）を占める。3,001円以上の高価格帯は3種のみ。',
      comparisonTable: {
        headers: ['価格帯', '商品数', '構成比'],
        rows: [
          ['〜1,000円', '28種', '18.3%'],
          ['1,001〜1,500円', '71種', '46.4%'],
          ['1,501〜2,000円', '38種', '24.8%'],
          ['2,001〜2,500円', '11種', '7.2%'],
          ['2,501〜3,000円', '2種', '1.3%'],
          ['3,001円〜', '3種', '2.0%'],
          ['価格未登録', '7種', '—'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-04-03時点）',
      },
    },
    {
      heading: '国内メーカー vs 海外メーカー',
      body: 'スピナーベイトは海外メーカーの商品数が目立つカテゴリ。Strike King・Berkley US・Googan Baits・Lunkerhunt・6th Sense・Z-Man・SPRO・Riot Baitsの米国8メーカーで計81種（50.6%）を占める。国内メーカーはノリーズ・VIVA・エンジン・Evergreen・O.S.P等25社で79種（49.4%）。ほぼ半々の構成。',
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているバス向けスピナーベイトは何種類？',
      answer: '2026-04-03時点で160種。type=スピナーベイトかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question: 'バス向けスピナーベイトのメーカーで最も商品数が多いのは？',
      answer: 'Strike Kingが58種で最多。次いでBerkley US9種、ノリーズ・VIVA・エンジン各6種の順（CAST/LOGデータベース2026-04-03時点）。',
    },
    {
      question: 'バス向けスピナーベイトの価格帯で最も多いのは？',
      answer: '1,001〜1,500円帯が71種で最多（価格登録済み153種中46.4%）。2,000円以下が全体の89.5%を占める（CAST/LOGデータベース2026-04-03時点）。',
    },
    {
      question: 'スピナーベイトの国内・海外メーカー比率は？',
      answer: '米国8メーカーが81種（50.6%）、国内25メーカーが79種（49.4%）とほぼ半々（CAST/LOGデータベース2026-04-03時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-worm-2026', 'bass-crankbait-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-04-03',
  updatedAt: '2026-04-03',
  dataAsOf: '2026-04-03',
};

export default article;
