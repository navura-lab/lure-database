/**
 * エディトリアルレビュー インデックス
 *
 * SEO Pipeline Phase 4 で生成されたルアー別レビューコンテンツ。
 * ルアー詳細ページ（[manufacturer_slug]/[slug].astro）で使用。
 */

import type { EditorialReview } from './huggos';
export type { EditorialReview };

// 個別エディトリアルの遅延インポート
import { huggosEditorial } from './huggos';

/** slug → EditorialReview のマップ */
export const editorialReviews: Record<string, EditorialReview> = {
  'huggos': huggosEditorial,
};
