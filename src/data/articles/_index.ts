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
 *
 * 2026-03-22: 全183記事を削除（根拠なしコンテンツ一掃）
 * ネタ帳: logs/article-netacho-2026-03-22.json
 * 監査結果: logs/article-audit-2026-03-22.md
 */

import type { ContentArticle } from './_types.js';

// ─── 記事インポート ───────────────────────────────────
// （全記事削除済み — 新パイプラインで再生成予定）

// ─── 集約 ─────────────────────────────────────────────

export const contentArticles: ContentArticle[] = [];

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
