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
// 季節コンテンツ（選び方ガイド）
import springSeabassLure from './spring-seabass-lure.js';
import springEgingEgi from './spring-eging-egi.js';
import springMebaring from './spring-mebaring.js';
// 追加記事（GSCデータ駆動 第1弾）
import magochiWorm from './magochi-worm.js';
import seabassPopper from './seabass-popper.js';
import bassSwimbait from './bass-swimbait.js';
import mebaruMinnow from './mebaru-minnow.js';
import aomonoWorm from './aomono-worm.js';
// 追加記事（GSCデータ駆動 第2弾）
import divingPencil from './diving-pencil.js';
import hirameVibration from './hirame-vibration.js';
import hataWorm from './hata-worm.js';
import aomonoPopper from './aomono-popper.js';
import chiningLure from './chining-lure.js';
// 追加記事（GSCデータ駆動 第3弾）
import seabassPencilbait from './seabass-pencilbait.js';
import seabassMetaljig from './seabass-metaljig.js';
import hirameWorm from './hirame-worm.js';
import takoEgi from './tako-egi.js';
import bassSpinnerbait from './bass-spinnerbait.js';
// 追加記事（GSCデータ駆動 第4弾）
import seabassMinnow from './seabass-minnow.js';
import troutSpoon from './trout-spoon.js';
import seabassSinkingpencil from './seabass-sinkingpencil.js';
import aomonoMetaljig from './aomono-metaljig.js';
import madaiTairaba from './madai-tairaba.js';
// 追加記事（GSCデータ駆動 第5弾）
import bassCrankbait from './bass-crankbait.js';
import bassRuggerjig from './bass-rubberjig.js';
import bassMinnow from './bass-minnow.js';
import troutMinnow from './trout-minnow.js';
import bassTopwater from './bass-topwater.js';
import bassFrog from './bass-frog.js';
import aomonoMinnow from './aomono-minnow.js';
import troutCrankbait from './trout-crankbait.js';
import bassVibration from './bass-vibration.js';
import kanpachiMetaljig from './kanpachi-metaljig.js';
// 追加記事（GSCデータ駆動 第6弾）
import hiramasaMetaljig from './hiramasa-metaljig.js';
import buriMetaljig from './buri-metaljig.js';
import troutWorm from './trout-worm.js';
import madaiMetaljig from './madai-metaljig.js';
import maguroMetaljig from './maguro-metaljig.js';
import bassJighead from './bass-jighead.js';
import ajiWorm from './aji-worm.js';
import ikaEgi from './ika-egi.js';
import bassShad from './bass-shad.js';
import bassChatterbait from './bass-chatterbait.js';
// 追加記事（GSCデータ駆動 第7弾）
import bassPencilbait from './bass-pencilbait.js';
import bassBuzzbait from './bass-buzzbait.js';
import bassJointedbait from './bass-jointedbait.js';
import aomonoSinkingpencil from './aomono-sinkingpencil.js';
import seabassSwimbait from './seabass-swimbait.js';
import hirameMinnow from './hirame-minnow.js';
import seabassShad from './seabass-shad.js';
import bassPopper from './bass-popper.js';
import aomonoTairaba from './aomono-tairaba.js';
import seabassJighead from './seabass-jighead.js';

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
  // 季節コンテンツ
  springSeabassLure,
  springEgingEgi,
  springMebaring,
  // GSCデータ駆動記事（第1弾）
  magochiWorm,
  seabassPopper,
  bassSwimbait,
  mebaruMinnow,
  aomonoWorm,
  // GSCデータ駆動記事（第2弾）
  divingPencil,
  hirameVibration,
  hataWorm,
  aomonoPopper,
  chiningLure,
  // GSCデータ駆動記事（第3弾）
  seabassPencilbait,
  seabassMetaljig,
  hirameWorm,
  takoEgi,
  bassSpinnerbait,
  // GSCデータ駆動記事（第4弾）
  seabassMinnow,
  troutSpoon,
  seabassSinkingpencil,
  aomonoMetaljig,
  madaiTairaba,
  // GSCデータ駆動記事（第5弾）
  bassCrankbait,
  bassRuggerjig,
  bassMinnow,
  troutMinnow,
  bassTopwater,
  bassFrog,
  aomonoMinnow,
  troutCrankbait,
  bassVibration,
  kanpachiMetaljig,
  // GSCデータ駆動記事（第6弾）
  hiramasaMetaljig,
  buriMetaljig,
  troutWorm,
  madaiMetaljig,
  maguroMetaljig,
  bassJighead,
  ajiWorm,
  ikaEgi,
  bassShad,
  bassChatterbait,
  // GSCデータ駆動記事（第7弾）
  bassPencilbait,
  bassBuzzbait,
  bassJointedbait,
  aomonoSinkingpencil,
  seabassSwimbait,
  hirameMinnow,
  seabassShad,
  bassPopper,
  aomonoTairaba,
  seabassJighead,
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
