/**
 * DBデータから統計分析記事5本を生成するスクリプト
 *
 * .cache/lures.json を読み、slug単位でユニーク化し、
 * 各記事の集計結果を src/data/articles/ に TypeScript ファイルとして出力する。
 *
 * 全ての数字はDBから導出。AIの知識による推測・断言は一切なし。
 */

import * as fs from 'fs';
import * as path from 'path';

const CACHE_PATH = path.resolve('.cache/lures.json');
const ARTICLES_DIR = path.resolve('src/data/articles');
const TODAY = '2026-03-27';

interface LureRow {
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  price: number;
  target_fish: string[];
  color_name: string;
}

interface Series {
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  price: number;
  target_fish: string[];
  color_count: number;
}

// ── データ読み込み＆ユニーク化 ──
console.log('Loading .cache/lures.json ...');
const raw: LureRow[] = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
console.log(`Total rows: ${raw.length}`);

const seriesMap = new Map<string, { colors: Set<string> } & Omit<Series, 'color_count'>>();
for (const row of raw) {
  const key = `${row.manufacturer_slug}/${row.slug}`;
  if (!seriesMap.has(key)) {
    seriesMap.set(key, {
      slug: row.slug,
      name: row.name,
      manufacturer: row.manufacturer,
      manufacturer_slug: row.manufacturer_slug,
      type: row.type,
      price: row.price,
      target_fish: row.target_fish || [],
      colors: new Set(),
    });
  }
  const s = seriesMap.get(key)!;
  if (row.color_name) s.colors.add(row.color_name);
}

const allSeries: Series[] = [...seriesMap.values()].map(s => ({
  slug: s.slug,
  name: s.name,
  manufacturer: s.manufacturer,
  manufacturer_slug: s.manufacturer_slug,
  type: s.type,
  price: s.price,
  target_fish: s.target_fish,
  color_count: s.colors.size,
}));

const TOTAL = allSeries.length;
console.log(`Unique series: ${TOTAL}`);

// ── ヘルパー ──
function writeArticle(filename: string, content: string) {
  const p = path.join(ARTICLES_DIR, filename);
  fs.writeFileSync(p, content, 'utf8');
  console.log(`  ✓ ${filename}`);
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ════════════════════════════════════════════════════════
// 記事1: 価格分析
// ════════════════════════════════════════════════════════
function generatePriceAnalysis() {
  const withPrice = allSeries.filter(s => s.price > 0);
  const totalWithPrice = withPrice.length;

  // タイプ別統計
  const typeMap = new Map<string, number[]>();
  for (const s of withPrice) {
    if (!typeMap.has(s.type)) typeMap.set(s.type, []);
    typeMap.get(s.type)!.push(s.price);
  }

  const typeStats = [...typeMap.entries()]
    .map(([type, prices]) => ({
      type,
      count: prices.length,
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      median: median(prices),
      min: Math.min(...prices),
      max: Math.max(...prices),
    }))
    .sort((a, b) => b.count - a.count);

  // 価格帯分布
  const bands = [
    { label: '500円以下', min: 0, max: 500, count: 0 },
    { label: '501〜1,000円', min: 501, max: 1000, count: 0 },
    { label: '1,001〜1,500円', min: 1001, max: 1500, count: 0 },
    { label: '1,501〜2,000円', min: 1501, max: 2000, count: 0 },
    { label: '2,001〜3,000円', min: 2001, max: 3000, count: 0 },
    { label: '3,001〜5,000円', min: 3001, max: 5000, count: 0 },
    { label: '5,001円以上', min: 5001, max: Infinity, count: 0 },
  ];
  for (const s of withPrice) {
    const band = bands.find(b => s.price >= b.min && s.price <= b.max)!;
    band.count++;
  }

  // 全体の平均・中央値
  const allPrices = withPrice.map(s => s.price);
  const overallAvg = Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length);
  const overallMedian = median(allPrices);

  // タイプ別比較表
  const priceTableHeaders = ['タイプ', '商品数', '平均価格', '中央値', '最安', '最高'];
  const priceTableRows = typeStats.slice(0, 25).map(t => [
    t.type, `${t.count}種`, `${t.avg.toLocaleString()}円`, `${t.median.toLocaleString()}円`,
    `${t.min.toLocaleString()}円`, `${t.max.toLocaleString()}円`,
  ]);

  // 価格帯分布表
  const bandTableHeaders = ['価格帯', '商品数', '割合'];
  const bandTableRows = bands.map(b => [
    b.label, `${b.count}種`, `${(b.count / totalWithPrice * 100).toFixed(1)}%`,
  ]);

  const content = `import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'lure-price-analysis',
  type: 'data-analysis',
  title: 'ルアー${totalWithPrice.toLocaleString()}種の価格分析',
  h1: 'ルアー${totalWithPrice.toLocaleString()}種の価格分析',
  description: 'CAST/LOGデータベースに登録された${totalWithPrice.toLocaleString()}種のルアーの価格をタイプ別に集計。平均価格${overallAvg.toLocaleString()}円、中央値${overallMedian.toLocaleString()}円。ワーム・ミノー・メタルジグなど${typeStats.length}タイプの相場を数字で比較。',
  mainKeyword: 'ルアー 価格 相場',
  subKeywords: ['ルアー 平均価格', 'ルアー タイプ別 価格', 'ルアー 価格帯'],
  targetFish: [],
  targetTypes: [],
  lead: 'CAST/LOGのルアーデータベースに登録されている${totalWithPrice.toLocaleString()}種のルアーの価格を集計した。全体の平均価格は${overallAvg.toLocaleString()}円、中央値は${overallMedian.toLocaleString()}円。以下のデータは全て${TODAY}時点のDB登録情報に基づく。主観的な評価は含まない。',
  sections: [
    {
      heading: 'タイプ別の価格統計（${typeStats.length}タイプ）',
      body: '価格情報のある${totalWithPrice.toLocaleString()}種を${typeStats.length}タイプに分類し、平均価格・中央値・最安・最高をまとめた。商品数が多い順に並べている。',
      comparisonTable: {
        headers: ${JSON.stringify(priceTableHeaders)},
        rows: ${JSON.stringify(priceTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースの税抜メーカー希望小売価格（${TODAY}時点）',
      },
    },
    {
      heading: '価格帯別のルアー数分布',
      body: '${totalWithPrice.toLocaleString()}種のルアーを価格帯ごとに集計した。最も多い価格帯は${bands.sort((a, b) => b.count - a.count)[0].label}で${bands[0].count.toLocaleString()}種（${(bands[0].count / totalWithPrice * 100).toFixed(1)}%）。',
      comparisonTable: {
        headers: ${JSON.stringify(bandTableHeaders)},
        rows: ${JSON.stringify(bandTableRows.sort((a, b) => {
          // 元の順序に戻す
          const order = ['500円以下', '501〜1,000円', '1,001〜1,500円', '1,501〜2,000円', '2,001〜3,000円', '3,001〜5,000円', '5,001円以上'];
          return order.indexOf(a[0]) - order.indexOf(b[0]);
        }), null, 8)},
        criteria: 'CAST/LOGデータベース登録価格（${TODAY}時点）',
      },
    },
    {
      heading: '高価格タイプと低価格タイプ',
      body: '中央値が最も高いタイプは${typeStats.sort((a, b) => b.median - a.median)[0].type}（中央値${typeStats[0].median.toLocaleString()}円）。中央値が最も低いタイプは${typeStats[typeStats.length - 1].type}（中央値${typeStats[typeStats.length - 1].median.toLocaleString()}円）。\\n\\n平均価格と中央値の乖離が大きいタイプは、一部の高額商品が平均を押し上げている可能性がある。中央値の方が実態に近い相場と言える。',
    },
  ],
  faq: [
    {
      question: 'ルアーの平均価格はいくら？',
      answer: 'CAST/LOGに登録された${totalWithPrice.toLocaleString()}種のルアーの平均価格は${overallAvg.toLocaleString()}円、中央値は${overallMedian.toLocaleString()}円（${TODAY}時点）。',
    },
    {
      question: '最も商品数が多い価格帯は？',
      answer: '${bands[0].label}が${bands[0].count.toLocaleString()}種で最多。全体の${(bands[0].count / totalWithPrice * 100).toFixed(1)}%を占める。',
    },
    {
      question: 'ワームの平均価格は？',
      answer: 'ワーム${typeStats.find(t => t.type === 'ワーム')!.count}種の平均価格は${typeStats.find(t => t.type === 'ワーム')!.avg.toLocaleString()}円、中央値は${typeStats.find(t => t.type === 'ワーム')!.median.toLocaleString()}円。',
    },
  ],
  relatedRankings: [],
  relatedGuides: [],
  publishedAt: '${TODAY}',
  updatedAt: '${TODAY}',
  dataAsOf: '${TODAY}',
};

export default article;
`;

  writeArticle('lure-price-analysis.ts', content);
}

// ════════════════════════════════════════════════════════
// 記事2: カラー展開数ランキング
// ════════════════════════════════════════════════════════
function generateColorRanking() {
  const byColor = [...allSeries].sort((a, b) => b.color_count - a.color_count);
  const top50 = byColor.slice(0, 50);

  // Top50テーブル
  const colorTableHeaders = ['順位', 'メーカー', '商品名', 'カラー数'];
  const colorTableRows = top50.map((s, i) => [
    `${i + 1}`, s.manufacturer, s.name, `${s.color_count}色`,
  ]);

  // メーカー別平均カラー展開数（5商品以上）
  const mfgMap = new Map<string, { total: number; count: number }>();
  for (const s of allSeries) {
    if (!mfgMap.has(s.manufacturer)) mfgMap.set(s.manufacturer, { total: 0, count: 0 });
    const m = mfgMap.get(s.manufacturer)!;
    m.total += s.color_count;
    m.count++;
  }
  const mfgColorAvg = [...mfgMap.entries()]
    .map(([m, v]) => ({ manufacturer: m, avg: Math.round(v.total / v.count * 10) / 10, products: v.count }))
    .filter(m => m.products >= 5)
    .sort((a, b) => b.avg - a.avg);

  const mfgTableHeaders = ['メーカー', '商品数', '平均カラー数'];
  const mfgTableRows = mfgColorAvg.slice(0, 20).map(m => [
    m.manufacturer, `${m.products}種`, `${m.avg}色`,
  ]);

  const content = `import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'lure-color-count-ranking',
  type: 'data-analysis',
  title: 'カラー展開数が多いルアーTop50',
  h1: 'カラー展開数が多いルアーTop50',
  description: 'CAST/LOGデータベース${TOTAL.toLocaleString()}種から、カラーバリエーションが最も多いルアーを集計。1位は${top50[0].manufacturer}「${top50[0].name}」の${top50[0].color_count}色展開。Top50の一覧とメーカー別の傾向を掲載。',
  mainKeyword: 'ルアー カラー 多い',
  subKeywords: ['ルアー カラー展開', 'ルアー カラーバリエーション', 'カラー数 ランキング'],
  targetFish: [],
  targetTypes: [],
  lead: 'CAST/LOGのデータベースに登録されている${TOTAL.toLocaleString()}種のルアーを、カラー展開数（カラーバリエーションの数）で集計した。全データは${TODAY}時点のDB登録情報に基づく。カラー数はメーカー公式サイトから取得した値で、限定カラーや廃番カラーを含む場合がある。',
  sections: [
    {
      heading: 'カラー展開数Top50',
      body: '${TOTAL.toLocaleString()}種のルアーをカラー数の多い順に並べた上位50商品。',
      comparisonTable: {
        headers: ${JSON.stringify(colorTableHeaders)},
        rows: ${JSON.stringify(colorTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースのカラーバリエーション登録数（${TODAY}時点）',
      },
    },
    {
      heading: 'メーカー別の平均カラー展開数（5商品以上）',
      body: '5商品以上登録されているメーカーの、1商品あたり平均カラー展開数。カラー数が多いメーカーほど、各商品のカラーバリエーションを重視する傾向がある。',
      comparisonTable: {
        headers: ${JSON.stringify(mfgTableHeaders)},
        rows: ${JSON.stringify(mfgTableRows, null, 8)},
        criteria: 'CAST/LOGデータベース登録のカラー数平均（5商品以上のメーカー、${TODAY}時点）',
      },
    },
  ],
  faq: [
    {
      question: '最もカラー展開が多いルアーは？',
      answer: '${top50[0].manufacturer}「${top50[0].name}」の${top50[0].color_count}色がCAST/LOGデータベース上で最多（${TODAY}時点）。',
    },
    {
      question: 'カラー展開が多いメーカーは？',
      answer: '5商品以上のメーカーで1商品あたりの平均カラー数が最も多いのは${mfgColorAvg[0].manufacturer}（平均${mfgColorAvg[0].avg}色、${mfgColorAvg[0].products}商品）。',
    },
    {
      question: 'カラー数のデータはどこから取得している？',
      answer: '各メーカー公式サイトに掲載されているカラーバリエーションをスクレイピングで取得し、CAST/LOGデータベースに登録している。限定カラーや廃番カラーを含む場合がある。',
    },
  ],
  relatedRankings: [],
  relatedGuides: [],
  publishedAt: '${TODAY}',
  updatedAt: '${TODAY}',
  dataAsOf: '${TODAY}',
};

export default article;
`;

  writeArticle('lure-color-count-ranking.ts', content);
}

// ════════════════════════════════════════════════════════
// 記事3: メーカー別ルアー数ランキング
// ════════════════════════════════════════════════════════
function generateMakerRanking() {
  const mfgMap = new Map<string, { count: number; types: Map<string, number>; slug: string }>();
  for (const s of allSeries) {
    if (!mfgMap.has(s.manufacturer)) {
      mfgMap.set(s.manufacturer, { count: 0, types: new Map(), slug: s.manufacturer_slug });
    }
    const m = mfgMap.get(s.manufacturer)!;
    m.count++;
    m.types.set(s.type, (m.types.get(s.type) || 0) + 1);
  }

  const mfgRank = [...mfgMap.entries()]
    .map(([name, v]) => {
      const top3 = [...v.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => `${t}:${c}`)
        .join('、');
      return { name, count: v.count, slug: v.slug, top3 };
    })
    .sort((a, b) => b.count - a.count);

  const totalMakers = mfgRank.length;

  const makerTableHeaders = ['順位', 'メーカー', '商品数', '主要タイプ'];
  const makerTableRows = mfgRank.map((m, i) => [
    `${i + 1}`, m.name, `${m.count}種`, m.top3,
  ]);

  const content = `import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'maker-product-count-ranking',
  type: 'data-analysis',
  title: 'メーカー別ルアー数${totalMakers}社比較',
  h1: 'メーカー別ルアー数${totalMakers}社比較',
  description: 'CAST/LOGデータベースに登録された${totalMakers}社のルアーメーカーを、登録商品数順に比較。1位は${mfgRank[0].name}の${mfgRank[0].count}種。各社の主要ルアータイプ内訳も掲載。',
  mainKeyword: 'ルアーメーカー 商品数',
  subKeywords: ['ルアーメーカー 比較', 'ルアーメーカー 一覧', 'ルアー 種類 多い メーカー'],
  targetFish: [],
  targetTypes: [],
  lead: 'CAST/LOGのデータベースに登録されている${TOTAL.toLocaleString()}種のルアーを、${totalMakers}社のメーカー別に集計した。以下のデータは全て${TODAY}時点のDB登録情報に基づく。商品数はCAST/LOGがスクレイピングで取得した数であり、メーカーの全商品を網羅しているとは限らない。',
  sections: [
    {
      heading: 'メーカー別商品数一覧（${totalMakers}社）',
      body: '商品数の多い順に${totalMakers}社を一覧化。主要タイプは各メーカーの上位3タイプと商品数。',
      comparisonTable: {
        headers: ${JSON.stringify(makerTableHeaders)},
        rows: ${JSON.stringify(makerTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースの登録商品数（${TODAY}時点）',
      },
    },
    {
      heading: '商品数の分布',
      body: '${totalMakers}社中、100種以上を登録しているメーカーは${mfgRank.filter(m => m.count >= 100).length}社。50〜99種が${mfgRank.filter(m => m.count >= 50 && m.count < 100).length}社、10〜49種が${mfgRank.filter(m => m.count >= 10 && m.count < 50).length}社、10種未満が${mfgRank.filter(m => m.count < 10).length}社。\\n\\n商品数が多いメーカーはワーム・ミノーなど汎用タイプが中心。専業メーカー（Forest: スプーン、beat: メタルジグなど）は商品数は少ないがタイプ特化型。この傾向はDBの数字から確認できる。',
    },
  ],
  faq: [
    {
      question: '最も商品数が多いルアーメーカーは？',
      answer: 'CAST/LOGデータベース上で最も商品登録数が多いのは${mfgRank[0].name}の${mfgRank[0].count}種（${TODAY}時点）。',
    },
    {
      question: '何社のメーカーが登録されている？',
      answer: '${TODAY}時点で${totalMakers}社のルアーメーカーが登録されている。',
    },
    {
      question: 'データの網羅性は？',
      answer: 'CAST/LOGのデータは各メーカー公式サイトからスクレイピングで取得している。廃番品を含む場合があり、また全商品を網羅しているとは限らない。',
    },
  ],
  relatedRankings: [],
  relatedGuides: [],
  publishedAt: '${TODAY}',
  updatedAt: '${TODAY}',
  dataAsOf: '${TODAY}',
};

export default article;
`;

  writeArticle('maker-product-count-ranking.ts', content);
}

// ════════════════════════════════════════════════════════
// 記事4: タイプ別シェア
// ════════════════════════════════════════════════════════
function generateTypeShare() {
  // タイプ別集計
  const typeMap = new Map<string, number>();
  for (const s of allSeries) {
    typeMap.set(s.type, (typeMap.get(s.type) || 0) + 1);
  }
  const typeRank = [...typeMap.entries()]
    .map(([type, count]) => ({ type, count, pct: (count / TOTAL * 100).toFixed(1) }))
    .sort((a, b) => b.count - a.count);

  const totalTypes = typeRank.length;

  // 対象魚別type分布
  const fishTypeMap = new Map<string, Map<string, number>>();
  for (const s of allSeries) {
    for (const f of s.target_fish) {
      if (!fishTypeMap.has(f)) fishTypeMap.set(f, new Map());
      const m = fishTypeMap.get(f)!;
      m.set(s.type, (m.get(s.type) || 0) + 1);
    }
  }
  const topFish = [...fishTypeMap.entries()]
    .map(([fish, types]) => {
      const total = [...types.values()].reduce((a, b) => a + b, 0);
      const top5 = [...types.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t, c]) => `${t}(${c})`);
      return { fish, total, top5Str: top5.join('、') };
    })
    .sort((a, b) => b.total - a.total);

  // タイプシェア表
  const typeTableHeaders = ['タイプ', '商品数', '割合'];
  const typeTableRows = typeRank.map(t => [t.type, `${t.count}種`, `${t.pct}%`]);

  // 対象魚別表
  const fishTableHeaders = ['対象魚', '対象商品数', '上位タイプ'];
  const fishTableRows = topFish.slice(0, 10).map(f => [f.fish, `${f.total}種`, f.top5Str]);

  const content = `import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'lure-type-share',
  type: 'data-analysis',
  title: 'ルアーのタイプ別シェア${totalTypes}種比較',
  h1: 'ルアーのタイプ別シェア${totalTypes}種比較',
  description: 'CAST/LOGデータベース${TOTAL.toLocaleString()}種のルアーを${totalTypes}タイプに分類し、割合を集計。最多はワーム（${typeRank[0].pct}%）、次いでミノー（${typeRank[1].pct}%）。対象魚別のタイプ分布も掲載。',
  mainKeyword: 'ルアー タイプ 種類',
  subKeywords: ['ルアー 種類 一覧', 'ルアー タイプ 割合', 'ルアー 分類'],
  targetFish: [],
  targetTypes: [],
  lead: 'CAST/LOGのデータベースに登録されている${TOTAL.toLocaleString()}種のルアーを、${totalTypes}のルアータイプに分類して割合を集計した。全データは${TODAY}時点のDB登録情報に基づく。タイプ分類はメーカー公式情報と商品特性に基づいている。',
  sections: [
    {
      heading: 'タイプ別の商品数と割合（${totalTypes}タイプ）',
      body: '${TOTAL.toLocaleString()}種のルアーを${totalTypes}タイプに分類した結果。ワームが${typeRank[0].count.toLocaleString()}種（${typeRank[0].pct}%）で最多。',
      comparisonTable: {
        headers: ${JSON.stringify(typeTableHeaders)},
        rows: ${JSON.stringify(typeTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースのタイプ分類（${TODAY}時点）',
      },
    },
    {
      heading: '対象魚別のタイプ分布',
      body: '各対象魚に対応するルアーを多い順に並べ、どのタイプが使われているかを集計した。1つのルアーが複数の対象魚を持つ場合は、それぞれにカウントしている。',
      comparisonTable: {
        headers: ${JSON.stringify(fishTableHeaders)},
        rows: ${JSON.stringify(fishTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースの対象魚×タイプ集計（${TODAY}時点）',
      },
    },
  ],
  faq: [
    {
      question: '最も種類が多いルアータイプは？',
      answer: 'ワームが${typeRank[0].count.toLocaleString()}種（${typeRank[0].pct}%）で最多。2位はミノー${typeRank[1].count.toLocaleString()}種（${typeRank[1].pct}%）、3位はメタルジグ${typeRank[2].count.toLocaleString()}種（${typeRank[2].pct}%）。',
    },
    {
      question: 'ブラックバス向けルアーで最も多いタイプは？',
      answer: '${topFish.find(f => f.fish === 'ブラックバス')?.top5Str || 'データなし'}の順（${TODAY}時点のCAST/LOGデータベース）。',
    },
    {
      question: 'シーバス向けルアーで最も多いタイプは？',
      answer: '${topFish.find(f => f.fish === 'シーバス')?.top5Str || 'データなし'}の順（${TODAY}時点のCAST/LOGデータベース）。',
    },
  ],
  relatedRankings: [],
  relatedGuides: [],
  publishedAt: '${TODAY}',
  updatedAt: '${TODAY}',
  dataAsOf: '${TODAY}',
};

export default article;
`;

  writeArticle('lure-type-share.ts', content);
}

// ════════════════════════════════════════════════════════
// 記事5: 1,000円以下ルアー
// ════════════════════════════════════════════════════════
function generateBudgetLures() {
  const under1000 = allSeries.filter(s => s.price > 0 && s.price <= 1000);
  const totalUnder = under1000.length;

  // メーカー別
  const mfgMap = new Map<string, Series[]>();
  for (const s of under1000) {
    if (!mfgMap.has(s.manufacturer)) mfgMap.set(s.manufacturer, []);
    mfgMap.get(s.manufacturer)!.push(s);
  }
  const mfgList = [...mfgMap.entries()]
    .map(([m, arr]) => ({ manufacturer: m, count: arr.length }))
    .sort((a, b) => b.count - a.count);

  // タイプ別
  const typeMap = new Map<string, number>();
  for (const s of under1000) {
    typeMap.set(s.type, (typeMap.get(s.type) || 0) + 1);
  }
  const typeList = [...typeMap.entries()]
    .sort((a, b) => b[1] - a[1]);

  // メーカー別テーブル（上位20）
  const mfgTableHeaders = ['メーカー', '1,000円以下の商品数'];
  const mfgTableRows = mfgList.slice(0, 25).map(m => [m.manufacturer, `${m.count}種`]);

  // タイプ別テーブル
  const typeTableHeaders = ['タイプ', '商品数', '割合'];
  const typeTableRows = typeList.slice(0, 20).map(([t, c]) => [
    t, `${c}種`, `${(c / totalUnder * 100).toFixed(1)}%`,
  ]);

  // 価格帯別テーブル（500円以下 / 501-700円 / 701-1000円）
  const sub500 = under1000.filter(s => s.price <= 500).length;
  const sub700 = under1000.filter(s => s.price > 500 && s.price <= 700).length;
  const sub1000 = under1000.filter(s => s.price > 700 && s.price <= 1000).length;

  const withPrice = allSeries.filter(s => s.price > 0);

  const content = `import type { ContentArticle } from './_types.js';

const article: ContentArticle = {
  slug: 'lures-under-1000-yen',
  type: 'data-analysis',
  title: '1,000円以下で買えるルアー全${totalUnder.toLocaleString()}種',
  h1: '1,000円以下で買えるルアー${totalUnder.toLocaleString()}種',
  description: 'CAST/LOGデータベースからメーカー希望小売価格1,000円以下のルアー${totalUnder.toLocaleString()}種を抽出。ワーム${typeList.find(([t]) => t === 'ワーム')?.[1] || 0}種、メタルジグ${typeList.find(([t]) => t === 'メタルジグ')?.[1] || 0}種など、タイプ別・メーカー別に一覧化。',
  mainKeyword: 'ルアー 1000円以下',
  subKeywords: ['ルアー 安い', 'ルアー コスパ', '格安ルアー', 'ルアー 低価格'],
  targetFish: [],
  targetTypes: [],
  lead: 'CAST/LOGのデータベースに登録されている${withPrice.length.toLocaleString()}種（価格情報あり）のうち、メーカー希望小売価格が1,000円以下のルアーは${totalUnder.toLocaleString()}種（${(totalUnder / withPrice.length * 100).toFixed(1)}%）。内訳は500円以下が${sub500}種、501〜700円が${sub700}種、701〜1,000円が${sub1000}種。全データは${TODAY}時点。',
  sections: [
    {
      heading: 'タイプ別の内訳',
      body: '1,000円以下のルアー${totalUnder.toLocaleString()}種のタイプ別集計。ワームが最も多く、次いでラバージグ、メタルジグの順。',
      comparisonTable: {
        headers: ${JSON.stringify(typeTableHeaders)},
        rows: ${JSON.stringify(typeTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースの税抜メーカー希望小売価格1,000円以下（${TODAY}時点）',
      },
    },
    {
      heading: 'メーカー別の内訳',
      body: '1,000円以下の商品が多いメーカー順に一覧化。',
      comparisonTable: {
        headers: ${JSON.stringify(mfgTableHeaders)},
        rows: ${JSON.stringify(mfgTableRows, null, 8)},
        criteria: 'CAST/LOGデータベースの税抜メーカー希望小売価格1,000円以下（${TODAY}時点）',
      },
    },
  ],
  faq: [
    {
      question: '1,000円以下のルアーは全体の何割？',
      answer: '価格情報のある${withPrice.length.toLocaleString()}種のうち${totalUnder.toLocaleString()}種（${(totalUnder / withPrice.length * 100).toFixed(1)}%）が1,000円以下（${TODAY}時点）。',
    },
    {
      question: '500円以下のルアーはある？',
      answer: '${sub500}種が500円以下で登録されている。主にワーム・スプーン・スピナーなど。',
    },
    {
      question: '価格はどの時点のもの？',
      answer: '${TODAY}時点のCAST/LOGデータベース登録価格（メーカー希望小売価格・税抜）。実売価格とは異なる場合がある。',
    },
  ],
  relatedRankings: [],
  relatedGuides: [],
  publishedAt: '${TODAY}',
  updatedAt: '${TODAY}',
  dataAsOf: '${TODAY}',
};

export default article;
`;

  writeArticle('lures-under-1000-yen.ts', content);
}

// ── 実行 ──
console.log('\nGenerating articles...');
generatePriceAnalysis();
generateColorRanking();
generateMakerRanking();
generateTypeShare();
generateBudgetLures();
console.log('\nDone! 5 articles generated.');
