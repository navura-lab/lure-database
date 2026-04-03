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
import lure_price_analysis from './lure-price-analysis.js';
import lure_color_count_ranking from './lure-color-count-ranking.js';
import maker_product_count_ranking from './maker-product-count-ranking.js';
import lure_type_share from './lure-type-share.js';
import lures_under_1000_yen from './lures-under-1000-yen.js';
import spring_bass_lures_2026 from './spring-bass-lures-2026.js';
import spring_seabass_lures_2026 from './spring-seabass-lures-2026.js';
import gw_fishing_lures_2026 from './gw-fishing-lures-2026.js';
import mebaru_lures_2026 from './mebaru-lures-2026.js';
import aji_lures_2026 from './aji-lures-2026.js';
import hirame_lures_2026 from './hirame-lures-2026.js';
import seabass_lures_2026 from './seabass-lures-2026.js';
import bass_worm_2026 from './bass-worm-2026.js';
import offshore_lures_2026 from './offshore-lures-2026.js';
import rockfish_lures_2026 from './rockfish-lures-2026.js';
import eging_lures_2026 from './eging-lures-2026.js';
import trout_lures_2026 from './trout-lures-2026.js';
import chinu_lures_2026 from './chinu-lures-2026.js';
import tachiuo_sawara_lures_2026 from './tachiuo-sawara-lures-2026.js';
import flatfish_lures_2026 from './flatfish-lures-2026.js';
import seabass_swimbait_2026 from './seabass-swimbait-2026.js';
import namazu_lures_2026 from './namazu-lures-2026.js';
import area_fishing_lures_2026 from './area-fishing-lures-2026.js';
import lightgame_jighead_2026 from './lightgame-jighead-2026.js';
import bass_crankbait_2026 from './bass-crankbait-2026.js';
import offshore_metal_jig_2026 from './offshore-metal-jig-2026.js';
import seabass_sinking_pencil_2026 from './seabass-sinking-pencil-2026.js';
import trout_spoon_2026 from './trout-spoon-2026.js';
import bass_spinnerbait_2026 from './bass-spinnerbait-2026.js';
import bass_rubber_jig_2026 from './bass-rubber-jig-2026.js';
import bass_vibration_2026 from './bass-vibration-2026.js';
import seabass_minnow_2026 from './seabass-minnow-2026.js';
import trout_minnow_2026 from './trout-minnow-2026.js';
import bass_frog_2026 from './bass-frog-2026.js';
import bass_swimbait_2026 from './bass-swimbait-2026.js';
import seabass_vibration_2026 from './seabass-vibration-2026.js';

// ─── 集約 ─────────────────────────────────────────────

export const contentArticles: ContentArticle[] = [
  lure_price_analysis,
  lure_color_count_ranking,
  maker_product_count_ranking,
  lure_type_share,
  lures_under_1000_yen,
  spring_bass_lures_2026,
  spring_seabass_lures_2026,
  gw_fishing_lures_2026,
  mebaru_lures_2026,
  aji_lures_2026,
  hirame_lures_2026,
  seabass_lures_2026,
  bass_worm_2026,
  offshore_lures_2026,
  rockfish_lures_2026,
  eging_lures_2026,
  trout_lures_2026,
  chinu_lures_2026,
  tachiuo_sawara_lures_2026,
  flatfish_lures_2026,
  seabass_swimbait_2026,
  namazu_lures_2026,
  area_fishing_lures_2026,
  lightgame_jighead_2026,
  bass_crankbait_2026,
  offshore_metal_jig_2026,
  seabass_sinking_pencil_2026,
  trout_spoon_2026,
  bass_spinnerbait_2026,
  bass_rubber_jig_2026,
  bass_vibration_2026,
  seabass_minnow_2026,
  trout_minnow_2026,
  bass_frog_2026,
  bass_swimbait_2026,
  seabass_vibration_2026,
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
