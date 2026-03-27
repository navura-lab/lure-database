/**
 * SEOコンテンツパイプライン — 記事データ型定義
 *
 * 記事は src/data/articles/{slug}.ts に個別ファイルとして保存し、
 * _index.ts で集約して article/[slug].astro からビルド時に読み込む。
 *
 * 記事タイプ:
 *   - color-guide: 「{商品名} おすすめカラー」（月間20-140/商品）
 *   - review-analysis: 「{商品名} インプレ」（月間50-500/商品）
 *   - selection-guide: 「{魚種} ルアー 選び方」（月間200-800）
 *   - howto: 「{タイプ} 使い方」（月間100-400）
 */

/** 記事テンプレートタイプ */
export type ArticleType =
  | 'color-guide'       // カラーガイド記事
  | 'review-analysis'   // レビュー・分析記事
  | 'selection-guide'   // 選び方ガイド記事
  | 'howto'             // ハウツー記事
  | 'data-analysis';    // データ分析記事（DB統計ベース）

/** 記事セクション */
export interface ArticleSection {
  /** セクション見出し（H2 or H3） */
  heading: string;
  /** セクション本文（Markdown不使用、プレーンテキスト） */
  body: string;
  /** 比較表データ（あれば） */
  comparisonTable?: {
    headers: string[];
    rows: string[][];
    /** 評価基準の説明（E-E-A-T用） */
    criteria: string;
  };
  /** 該当ルアーslug一覧（ルアーカード表示用） */
  lureRefs?: string[];
}

/** コンテンツ記事データ */
export interface ContentArticle {
  /** URL slug: /article/{slug}/ */
  slug: string;
  /** 記事テンプレートタイプ */
  type: ArticleType;
  /** titleタグ（30文字以内、末尾に「 | CAST/LOG」が自動付与） */
  title: string;
  /** H1タグ（28文字以内） */
  h1: string;
  /** meta description（120-160文字、先頭70文字にメリット・数値） */
  description: string;
  /** メインターゲットキーワード */
  mainKeyword: string;
  /** サブキーワード */
  subKeywords: string[];
  /** 対象魚種フィルター */
  targetFish: string[];
  /** 対象ルアータイプフィルター */
  targetTypes: string[];
  /** 対象ルアーslug（レビュー/カラーガイド用） */
  targetLureSlugs?: string[];
  /** リード文（200-400文字） */
  lead: string;
  /** 本文セクション */
  sections: ArticleSection[];
  /** FAQ（3-5件、JSON-LD出力用） */
  faq: { question: string; answer: string }[];
  /** 関連ランキングページslug（例: "seabass-minnow"） */
  relatedRankings: string[];
  /** 関連ガイド記事slug（例: "seabass-lure-osusume"） */
  relatedGuides: string[];
  /** 公開日 ISO形式 */
  publishedAt: string;
  /** 更新日 ISO形式 */
  updatedAt: string;
  /** データ調査日時（比較表に明記用） */
  dataAsOf: string;
}
