/**
 * 記事データ集約ローダー
 *
 * src/data/articles/ 内の全記事ファイルをimportし、
 * ContentArticle[] として export する。
 *
 * 記事を追加するには:
 *   1. src/data/articles/{slug}.ts を作成
 *   2. ContentArticle 型のオブジェクトを default export
 *   3. このファイルに import + articles 配列に追加
 *
 * SSGビルド時に getStaticPaths() から参照される。
 */

import type { ContentArticle } from './_types.js';

// ─── 記事インポート ───────────────────────────────────
// カラーガイド記事
import jigparaVerticalShortColor from './jigpara-vertical-short-color.js';
import feedPopperColor from './feed-popper-color.js';
import rollingBaitColor from './rolling-bait-color.js';
import switchHitterColor from './switch-hitter-color.js';
import kohgaBayRubberColor from './kohga-bay-rubber-color.js';
// レビュー分析記事
import monsterShotReview from './monster-shot-review.js';
import onimaruReview from './onimaru-review.js';
import jigparaMicroSlimReview from './jigpara-micro-slim-review.js';
import metalmaruReview from './metalmaru-review.js';
import flickShakeReview from './flick-shake-review.js';

// ─── 集約 ─────────────────────────────────────────────

export const contentArticles: ContentArticle[] = [
  // カラーガイド
  jigparaVerticalShortColor,
  feedPopperColor,
  rollingBaitColor,
  switchHitterColor,
  kohgaBayRubberColor,
  // レビュー分析
  monsterShotReview,
  onimaruReview,
  jigparaMicroSlimReview,
  metalmaruReview,
  flickShakeReview,
];

// ─── ヘルパー ─────────────────────────────────────────

/** slug で記事を検索 */
export function getArticleBySlug(slug: string): ContentArticle | undefined {
  return contentArticles.find(a => a.slug === slug);
}

/** タイプで記事をフィルタ */
export function getArticlesByType(type: ContentArticle['type']): ContentArticle[] {
  return contentArticles.filter(a => a.type === type);
}

/** 魚種で記事をフィルタ */
export function getArticlesByFish(fish: string): ContentArticle[] {
  return contentArticles.filter(a => a.targetFish.includes(fish));
}

// 型の再エクスポート
export type { ContentArticle, ArticleSection, ArticleType } from './_types.js';
