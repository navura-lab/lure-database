/**
 * 記事間クロスリンク生成
 *
 * 同じ魚種 or 同じタイプの記事を関連記事として返す。
 * 魚種＋タイプ両方一致 > 魚種一致 > タイプ一致 の優先度。
 */

import type { ContentArticle } from '../data/articles/_types';

export interface CrosslinkArticle {
  slug: string;
  title: string;
  type: string;
  /** 関連度スコア（高い方が関連度が高い） */
  score: number;
}

/**
 * 記事の関連記事を取得（自身を除く、スコア降順）
 */
export function getArticleCrosslinks(
  article: ContentArticle,
  allArticles: ContentArticle[],
  maxCount: number = 5,
): CrosslinkArticle[] {
  const scored: CrosslinkArticle[] = [];

  for (const other of allArticles) {
    if (other.slug === article.slug) continue;

    let score = 0;

    // 魚種一致: +3 per match
    for (const fish of article.targetFish) {
      if (other.targetFish.includes(fish)) score += 3;
    }

    // タイプ一致: +2 per match
    for (const type of article.targetTypes) {
      if (other.targetTypes.includes(type)) score += 2;
    }

    // 同じ記事タイプ: +1
    if (other.type === article.type) score += 1;

    if (score > 0) {
      scored.push({
        slug: other.slug,
        title: other.title,
        type: other.type,
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount);
}
