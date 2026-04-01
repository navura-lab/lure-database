/**
 * data-story.ts
 * SQLクエリ結果から自動的にデータストーリー文章を生成する。
 * AI/LLM不使用。if/else + テンプレートリテラルのみ。
 */

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface DataStoryInput {
  /** 例: "JACKALLのミノー", "シーバス向けメタルジグ" */
  groupLabel: string;
  /** 登録モデル数 */
  totalCount: number;

  /** 価格分布 */
  prices: {
    min: number;
    max: number;
    avg: number;
    median: number;
    buckets: { label: string; count: number; pct: number }[];
  };

  /** カラー分布 */
  colorStats: {
    avgColors: number;
    maxColors: number;
    maxColorSeries: string;
    topCategories: { label: string; pct: number }[];
  };

  /** 重量分布（nullなら未公開） */
  weightStats: { min: number; max: number; avg: number } | null;

  /** サイズ分布（nullなら未公開） */
  lengthStats: { min: number; max: number; avg: number } | null;

  /** メーカー分布（メーカー×タイプページでは不要） */
  makerBreakdown?: { name: string; count: number; pct: number }[];

  /** 対象魚分布 */
  fishBreakdown?: { name: string; count: number; pct: number }[];

  /** 全体平均価格（あれば比較文を生成） */
  globalAvg?: number;
}

export interface DataStory {
  /** 3段落のデータストーリー */
  paragraphs: [string, string, string];

  /** FAQ 5問（全てDBデータから生成） */
  faq: { q: string; a: string }[];

  /** サマリーカード用データ */
  summaryCards: { label: string; value: string }[];
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/** 数値をカンマ区切りに */
function fmt(n: number): string {
  return n.toLocaleString("ja-JP");
}

/** 円表記 */
function yen(n: number): string {
  return `¥${fmt(n)}`;
}

/** 小数点1桁の % 差分 */
function pctDiff(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.round(((a - b) / b) * 1000) / 10;
}

/** バケット配列から最多を返す */
function topBucket(buckets: { label: string; count: number; pct: number }[]) {
  if (buckets.length === 0) return null;
  return buckets.reduce((a, b) => (b.pct > a.pct ? b : a));
}

// ---------------------------------------------------------------------------
// 段落生成
// ---------------------------------------------------------------------------

function buildParagraph1(input: DataStoryInput): string {
  const { groupLabel, totalCount, prices, globalAvg } = input;
  const top = topBucket(prices.buckets);

  let text = `${groupLabel}は全${fmt(totalCount)}モデル。`;

  text += `${yen(prices.min)}〜${yen(prices.max)}の範囲で`;
  if (top) {
    text += `、${top.label}が${top.pct}%と最多。`;
  } else {
    text += `。`;
  }

  text += `平均価格は${yen(prices.avg)}、中央値は${yen(prices.median)}。`;

  if (globalAvg != null && globalAvg > 0) {
    const diff = pctDiff(prices.avg, globalAvg);
    if (diff > 0) {
      text += `全体平均${yen(globalAvg)}と比べて${diff}%高い。`;
    } else if (diff < 0) {
      text += `全体平均${yen(globalAvg)}と比べて${Math.abs(diff)}%安い。`;
    } else {
      text += `全体平均${yen(globalAvg)}とほぼ同水準。`;
    }
  }

  return text;
}

function buildParagraph2(input: DataStoryInput): string {
  const { colorStats } = input;

  let text = `カラー展開は平均${fmt(colorStats.avgColors)}色。`;
  text += `最多は${colorStats.maxColorSeries}の${fmt(colorStats.maxColors)}色。`;

  const cats = colorStats.topCategories;
  if (cats.length >= 2) {
    text += `カラー系統では${cats[0].label}系が${cats[0].pct}%で最多、次いで${cats[1].label}系${cats[1].pct}%。`;
  } else if (cats.length === 1) {
    text += `カラー系統では${cats[0].label}系が${cats[0].pct}%で最多。`;
  }

  // バリエーション文
  if (colorStats.avgColors >= 10) {
    text += `カラーバリエーションが豊富で、好みや状況に応じた使い分けが可能。`;
  } else if (colorStats.avgColors >= 5) {
    text += `定番カラーを中心にバランスの取れたラインナップ。`;
  } else if (colorStats.avgColors >= 1) {
    text += `厳選されたカラー展開。`;
  }

  return text;
}

function buildParagraph3(input: DataStoryInput): string {
  const { weightStats, lengthStats, fishBreakdown } = input;
  const parts: string[] = [];

  if (weightStats) {
    parts.push(
      `重量は${fmt(weightStats.min)}g〜${fmt(weightStats.max)}g、平均${fmt(weightStats.avg)}g。`
    );
  }

  if (lengthStats) {
    parts.push(
      `全長は${fmt(lengthStats.min)}mm〜${fmt(lengthStats.max)}mm。`
    );
  }

  if (!weightStats && !lengthStats) {
    parts.push(`重量・全長の公式スペックは一部未公開。`);
  }

  if (fishBreakdown && fishBreakdown.length > 0) {
    const top = fishBreakdown[0];
    let fishText = `対象魚は${top.name}が${top.pct}%で最多`;
    if (fishBreakdown.length >= 2) {
      fishText += `、${fishBreakdown[1].name}が${fishBreakdown[1].pct}%`;
    }
    fishText += `。`;
    parts.push(fishText);
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// FAQ生成
// ---------------------------------------------------------------------------

function buildFaq(input: DataStoryInput): { q: string; a: string }[] {
  const {
    groupLabel,
    totalCount,
    prices,
    colorStats,
    weightStats,
    makerBreakdown,
    fishBreakdown,
  } = input;

  const faq: { q: string; a: string }[] = [];

  // Q1: モデル数
  faq.push({
    q: `${groupLabel}は何モデルある？`,
    a: `全${fmt(totalCount)}モデルが登録されています。`,
  });

  // Q2: 価格帯
  const top = topBucket(prices.buckets);
  const priceAnswer = top
    ? `${yen(prices.min)}〜${yen(prices.max)}で、${top.label}が${top.pct}%です。`
    : `${yen(prices.min)}〜${yen(prices.max)}です。`;
  faq.push({
    q: `${groupLabel}の価格帯は？`,
    a: priceAnswer,
  });

  // Q3: カラー展開
  faq.push({
    q: `${groupLabel}のカラー展開は？`,
    a: `平均${fmt(colorStats.avgColors)}色。${colorStats.maxColorSeries}が${fmt(colorStats.maxColors)}色で最多。`,
  });

  // Q4: 重量範囲
  if (weightStats) {
    faq.push({
      q: `${groupLabel}の重量範囲は？`,
      a: `${fmt(weightStats.min)}g〜${fmt(weightStats.max)}g、平均${fmt(weightStats.avg)}gです。`,
    });
  } else {
    faq.push({
      q: `${groupLabel}の重量範囲は？`,
      a: `重量の公式スペックは一部未公開です。`,
    });
  }

  // Q5: メーカー or 対象魚
  if (makerBreakdown && makerBreakdown.length > 0) {
    const topMaker = makerBreakdown[0];
    let makerAnswer = `${topMaker.name}が${topMaker.pct}%で最多`;
    if (makerBreakdown.length >= 2) {
      makerAnswer += `、次いで${makerBreakdown[1].name}が${makerBreakdown[1].pct}%`;
    }
    makerAnswer += `です。`;
    faq.push({
      q: `${groupLabel}を出しているメーカーは？`,
      a: makerAnswer,
    });
  } else if (fishBreakdown && fishBreakdown.length > 0) {
    const topFish = fishBreakdown[0];
    let fishAnswer = `${topFish.name}が${topFish.pct}%で最多`;
    if (fishBreakdown.length >= 2) {
      fishAnswer += `、次いで${fishBreakdown[1].name}が${fishBreakdown[1].pct}%`;
    }
    fishAnswer += `です。`;
    faq.push({
      q: `${groupLabel}の対象魚は？`,
      a: fishAnswer,
    });
  } else {
    faq.push({
      q: `${groupLabel}のサイズ範囲は？`,
      a: input.lengthStats
        ? `${fmt(input.lengthStats.min)}mm〜${fmt(input.lengthStats.max)}mmです。`
        : `サイズの公式スペックは一部未公開です。`,
    });
  }

  return faq;
}

// ---------------------------------------------------------------------------
// サマリーカード生成
// ---------------------------------------------------------------------------

function buildSummaryCards(input: DataStoryInput): { label: string; value: string }[] {
  const cards: { label: string; value: string }[] = [];

  cards.push({ label: "モデル数", value: `${fmt(input.totalCount)}` });
  cards.push({
    label: "価格帯",
    value: `${yen(input.prices.min)}〜${yen(input.prices.max)}`,
  });
  cards.push({ label: "平均価格", value: yen(input.prices.avg) });
  cards.push({
    label: "カラー展開",
    value: `平均${fmt(input.colorStats.avgColors)}色`,
  });

  if (input.weightStats) {
    cards.push({
      label: "重量",
      value: `${fmt(input.weightStats.min)}〜${fmt(input.weightStats.max)}g`,
    });
  }

  if (input.lengthStats) {
    cards.push({
      label: "全長",
      value: `${fmt(input.lengthStats.min)}〜${fmt(input.lengthStats.max)}mm`,
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// メインexport
// ---------------------------------------------------------------------------

export function generateDataStory(input: DataStoryInput): DataStory {
  return {
    paragraphs: [
      buildParagraph1(input),
      buildParagraph2(input),
      buildParagraph3(input),
    ],
    faq: buildFaq(input),
    summaryCards: buildSummaryCards(input),
  };
}
