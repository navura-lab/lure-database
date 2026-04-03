import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'trout-minnow-2026',
  type: 'data-analysis',
  title: 'トラウト対応ミノー 全285種一覧【2026年版】',
  h1: 'トラウト対応ミノー 全285種一覧【2026年版】',
  description: 'CAST/LOGデータベースのトラウト対応ミノー285種を集計。Rapalaが46種で最多、次いでSmith（30種）、TIEMCO（28種）。価格帯は1,001〜2,000円が171種で最多（75.3%）。メーカー別・価格帯別の内訳を掲載。',
  mainKeyword: 'トラウト ミノー 一覧',
  subKeywords: ['トラウト ミノー 種類', 'トラウト ミノー 2026', '渓流 ミノー 一覧', 'トラウト ミノー メーカー'],
  targetFish: ['トラウト'],
  targetTypes: ['ミノー'],
  lead: 'CAST/LOGデータベースに登録されているトラウト対応ミノーは285種（2026-04-03時点）。メーカー別ではRapalaが46種で最多、次いでSmith（30種）、TIEMCO（28種）の順。価格帯別では1,001〜2,000円帯が171種（75.3%）を占める。メーカー別・価格帯別の集計データを掲載する。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP15',
      body: '285種をメーカー別に集計。Rapalaが46種で最多。Smith（30種）、TIEMCO（28種）、Bassday（21種）、JACKALL（17種）が続く。トラウトルアーの老舗メーカーが上位に並ぶ構成となっている。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['Rapala', '46種'],
          ['Smith', '30種'],
          ['TIEMCO', '28種'],
          ['Bassday', '21種'],
          ['JACKALL', '17種'],
          ['HMKL', '16種'],
          ['DAIWA', '15種'],
          ['Pazdesign', '11種'],
          ['Palms', '10種'],
          ['Jackson', '10種'],
          ['Lucky Craft', '9種'],
          ['SHIMANO', '9種'],
          ['ima', '9種'],
          ['ZipBaits', '9種'],
          ['DUO', '8種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-04-03時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている227種を価格帯別に集計。1,001〜2,000円帯が171種で最多（75.3%）。2,001〜3,000円帯が46種（20.3%）で続く。1,000円以下は5種、3,001円以上も5種と少数。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜1,000円', '5種'],
          ['1,001〜2,000円', '171種'],
          ['2,001〜3,000円', '46種'],
          ['3,001円〜', '5種'],
          ['価格未登録', '58種'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-04-03時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているトラウト向けミノーは何種類？',
      answer: '2026-04-03時点で285種。type=ミノーかつ対象魚にトラウトを含む商品を集計している。',
    },
    {
      question: 'トラウト向けミノーのメーカーで最も商品数が多いのは？',
      answer: 'Rapalaが46種で最多。次いでSmith30種、TIEMCO28種の順（CAST/LOGデータベース2026-04-03時点）。',
    },
    {
      question: 'トラウト向けミノーの価格帯で最も多いのは？',
      answer: '1,001〜2,000円帯が171種で最多（価格登録済み227種中75.3%）（CAST/LOGデータベース2026-04-03時点）。',
    },
    {
      question: 'トラウト向けミノーで3,000円を超える商品はある？',
      answer: '3,001円以上の商品が5種登録されている（CAST/LOGデータベース2026-04-03時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['trout-lures-2026', 'trout-spoon-2026'],
  publishedAt: '2026-04-03',
  updatedAt: '2026-04-03',
  dataAsOf: '2026-04-03',
};

export default article;
