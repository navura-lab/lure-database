/**
 * ガイド記事データ
 * 2026-03-22: 全件削除（根拠なしAI生成コンテンツ一掃）
 */

export interface Guide {
  slug: string;
  title: string;
  description: string;
  targetFish: string[];
  targetTypes: string[];
  content: string;
  faq: { question: string; answer: string }[];
  publishedAt: string;
  updatedAt: string;
}

export const guides: Guide[] = [];
export const guideArticles = guides;
