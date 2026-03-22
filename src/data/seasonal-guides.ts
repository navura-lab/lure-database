/**
 * 季節×魚種ページ用データ定義
 *
 * 2026-03-22: 全20ガイドを削除（根拠なしコンテンツ一掃）
 * 真実性保証パイプライン（Phase B）で再生成予定
 */

export interface SeasonalGuide {
  slug: string;
  season: '春' | '夏' | '秋' | '冬';
  seasonSlug: 'spring' | 'summer' | 'autumn' | 'winter';
  fish: string;
  name: string;
  description: string;
  months: number[];
  recommendedTypes: string[];
  patterns: string[];
  tips: string[];
  faq: { question: string; answer: string }[];
  nameEn?: string;
  descriptionEn?: string;
  patternsEn?: string[];
  tipsEn?: string[];
  faqEn?: { question: string; answer: string }[];
}

export const seasonalGuides: SeasonalGuide[] = [];
