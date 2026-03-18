/**
 * エディトリアルレビュー インデックス
 *
 * SEO Pipeline Phase 4 で生成されたルアー別レビューコンテンツ。
 * ルアー詳細ページ（[manufacturer_slug]/[slug].astro）で使用。
 */

import type { EditorialReview } from './huggos';
export type { EditorialReview };

import { huggosEditorial } from './huggos';
import { gillary01Editorial } from './gillary-01--01';
import { lokiEditorial } from './masukurouto-loki';

/** slug → EditorialReview のマップ */
export const editorialReviews: Record<string, EditorialReview> = {
  'huggos': huggosEditorial,
  'gillary-01--01': gillary01Editorial,
  'masukurouto-loki': lokiEditorial,
};
