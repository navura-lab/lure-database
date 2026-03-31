import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'lightgame-jighead-2026',
  type: 'data-analysis',
  title: 'ライトゲーム（メバル・アジ）対応ジグヘッド 全30種一覧【2026年版】',
  h1: 'ライトゲーム対応ジグヘッド 全30種一覧【2026年版】',
  description: 'CAST/LOGデータベースのメバル・アジ対応ジグヘッド30種を集計。JAZZが8種・Shimanoが7種で上位。価格帯は501〜1,000円帯が最多11種。メーカー別・価格帯別内訳を掲載。',
  mainKeyword: 'メバル アジ ジグヘッド 一覧',
  subKeywords: ['ライトゲーム ジグヘッド 種類', 'メバル ジグヘッド 2026', 'アジング ジグヘッド 一覧', 'ジグヘッド メバリング'],
  targetFish: ['メバル', 'アジ'],
  targetTypes: ['ジグヘッド'],
  lead: 'CAST/LOGデータベースに登録されているメバル・アジ対応ジグヘッドは30種（2026-03-31時点）。メーカー別ではJAZZが8種で最多、次いでShimano（7種）、DreemUP（4種）の順。価格帯は501〜1,000円帯が最多。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数',
      body: 'メバル・アジ対応ジグヘッドを持つメーカーは10社。JAZZが8種で最多、Shimanoが7種で続く。DreemUP（4種）、JACKALL（3種）がそれぞれ続き、以降は2〜1種。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['JAZZ', '8種'],
          ['Shimano', '7種'],
          ['DreemUP', '4種'],
          ['JACKALL', '3種'],
          ['Jackson', '2種'],
          ['Hayabusa', '2種'],
          ['Evergreen', '1種'],
          ['APIA', '1種'],
          ['Major Craft', '1種'],
          ['Breaden', '1種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-03-31時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている22種を価格帯別に集計。501〜1,000円帯が11種で最多（50.0%）。〜500円帯が8種（36.4%）で続く。1,001円以上はあわせて3種。価格未登録は8種。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜500円', '8種'],
          ['501〜1,000円', '11種'],
          ['1,001〜1,500円', '2種'],
          ['1,501円〜', '1種'],
          ['価格未登録', '8種'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-03-31時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているメバル・アジ向けジグヘッドは何種類？',
      answer: '2026-03-31時点で30種。type=ジグヘッドかつ対象魚にメバルまたはアジを含む商品を集計している。',
    },
    {
      question: 'メバル・アジ向けジグヘッドのメーカーで最も商品数が多いのは？',
      answer: 'JAZZが8種で最多。次いでShimano7種、DreemUP4種の順（CAST/LOGデータベース2026-03-31時点）。',
    },
    {
      question: 'メバル・アジ向けジグヘッドの価格帯で最も多いのは？',
      answer: '501〜1,000円帯が11種で最多（価格登録済み22種中50.0%）（CAST/LOGデータベース2026-03-31時点）。',
    },
    {
      question: 'ジグヘッド以外のライトゲーム向けルアーはどこで確認できる？',
      answer: 'CAST/LOGのメバル・アジカテゴリページでワーム・プラグ等も含めた全商品を確認できる。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['mebaru-lures-2026', 'aji-lures-2026'],
  publishedAt: '2026-03-31',
  updatedAt: '2026-03-31',
  dataAsOf: '2026-03-31',
};

export default article;
