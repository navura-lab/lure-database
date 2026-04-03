import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'bass-vibration-2026',
  type: 'data-analysis',
  title: 'バス対応バイブレーション 全97種一覧【2026年版】',
  h1: 'ブラックバス対応バイブレーション 全97種一覧',
  description: 'CAST/LOGデータベースのブラックバス対応バイブレーション97種を集計。JACKALLが15種で最多、Megabass（8種）、RAID JAPAN（7種）が続く。価格帯・メーカー別内訳を掲載。',
  mainKeyword: 'バス バイブレーション 一覧',
  subKeywords: ['バス バイブレーション 種類', 'ブラックバス バイブレーション 2026', 'バス釣り バイブレーション おすすめ', 'バス バイブレーション メーカー'],
  targetFish: ['ブラックバス'],
  targetTypes: ['バイブレーション'],
  lead: 'CAST/LOGデータベースに登録されているブラックバス対応バイブレーションは97種（2026-04-03時点）。メーカー別ではJACKALLが15種で最多、次いでMegabass（8種）、RAID JAPAN（7種）の順。1,001〜2,000円帯が76.0%を占める。全データはDB登録情報に基づく。',
  sections: [
    {
      heading: 'メーカー別商品数 TOP12',
      body: '97種をメーカー別に集計。JACKALLが15種で最多。Megabass（8種）、RAID JAPAN（7種）、Strike King（6種）が続く。OBASSLIVE・Viva・DSTYLEも各5種で国内メーカーの層が厚い。',
      comparisonTable: {
        headers: ['メーカー', '商品数'],
        rows: [
          ['JACKALL', '15種'],
          ['Megabass', '8種'],
          ['RAID JAPAN', '7種'],
          ['Strike King', '6種'],
          ['Viva', '5種'],
          ['OBASSLIVE', '5種'],
          ['DSTYLE', '5種'],
          ['Berkley', '4種'],
          ['issei', '3種'],
          ['IMAKATSU', '3種'],
          ['TIEMCO', '3種'],
          ['EVERGREEN', '3種'],
        ],
        criteria: 'CAST/LOGデータベースのメーカー別集計（2026-04-03時点）',
      },
    },
    {
      heading: '価格帯別の商品数',
      body: '価格が登録されている75種を価格帯別に集計。1,001〜2,000円帯が57種で最多（76.0%）。1,000円以下も6種あり、コスパ重視の選択肢も存在する。3,001円以上は1種のみ。',
      comparisonTable: {
        headers: ['価格帯', '商品数'],
        rows: [
          ['〜1,000円', '6種'],
          ['1,001〜2,000円', '57種'],
          ['2,001〜3,000円', '11種'],
          ['3,001円〜', '1種'],
          ['価格未登録', '22種'],
        ],
        criteria: 'CAST/LOGデータベースの価格帯集計（2026-04-03時点）',
      },
    },
  ],
  faq: [
    {
      question: 'CAST/LOGに登録されているバス向けバイブレーションは何種類？',
      answer: '2026-04-03時点で97種。type=バイブレーションかつ対象魚にブラックバスを含む商品を集計している。',
    },
    {
      question: 'バス向けバイブレーションのメーカーで最も商品数が多いのは？',
      answer: 'JACKALLが15種で最多。次いでMegabass8種、RAID JAPAN7種の順（CAST/LOGデータベース2026-04-03時点）。',
    },
    {
      question: 'バス向けバイブレーションの価格帯で最も多いのは？',
      answer: '1,001〜2,000円帯が57種で最多（価格登録済み75種中76.0%）（CAST/LOGデータベース2026-04-03時点）。',
    },
    {
      question: '1,000円以下で買えるバス向けバイブレーションはある？',
      answer: '6種が1,000円以下で登録されている（CAST/LOGデータベース2026-04-03時点）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: ['bass-worm-2026', 'bass-crankbait-2026', 'spring-bass-lures-2026'],
  publishedAt: '2026-04-03',
  updatedAt: '2026-04-03',
  dataAsOf: '2026-04-03',
};

export default article;
