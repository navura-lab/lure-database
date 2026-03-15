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
// 追加記事（GSCデータ駆動 第8弾）
import seabassVibration from './seabass-vibration.js';
import mebaruWorm from './mebaru-worm.js';
import ajiJighead from './aji-jighead.js';
import rockfishWorm from './rockfish-worm.js';
import bassBigbait from './bass-bigbait.js';
import tachiuoMetaljig from './tachiuo-metaljig.js';
import hirameMetaljig from './hirame-metaljig.js';
import bassMetalVib from './bass-metal-vib.js';
import mebaruJighead from './mebaru-jighead.js';
import seabassWorm from './seabass-worm.js';
// 追加記事（第9弾）
import seabassNightGame from './seabass-night-game.js';
import surfHirameHowto from './surf-hirame-howto.js';
import bassSightFishing from './bass-sight-fishing.js';
import egingAutumnHowto from './eging-autumn-howto.js';
import ajiNightGame from './aji-night-game.js';
import madaiMetalJig from './madai-metal-jig.js';
import chimuTopwater from './chimu-topwater.js';
import aomonoDivingPencil from './aomono-diving-pencil.js';
import autumnSeabassLure from './autumn-seabass-lure.js';
import winterMebaru from './winter-mebaru.js';
import summerBassTopwater from './summer-bass-topwater.js';
import hirameMinnowGuide from './hirame-minnow-guide.js';
import kurodaiRubberJig from './kurodai-rubber-jig.js';
import flatfishJighead from './flatfish-jighead.js';
import bassWormTexasRig from './bass-worm-texas-rig.js';
// 追加記事（第10弾 — Web調査ベース）
// Batch A: ショアジギ/サワラ/冬バス/渓流/カラーガイド
import shoreJiggingGuide from './shore-jigging-guide.js';
import sawaraLure from './sawara-lure.js';
import winterBassLure from './winter-bass-lure.js';
import sakuramasuLure from './sakuramasu-lure.js';
import lureColorGuideGeneral from './lure-color-guide-general.js';
// Batch B: 渓流/ナマズ/タチウオ/イカメタル
import keiryuLure from './keiryu-lure.js';
import namazuLure from './namazu-lure.js';
import tachiuoWinding from './tachiuo-winding.js';
import ikaMetalGuide from './ika-metal-guide.js';
import chiningWorm from './chining-worm.js';
// Batch C: シーバス初心者/季節バス/季節シーバス
import seabassBeginner from './seabass-beginner.js';
import springBassLure from './spring-bass-lure.js';
import autumnBassLure from './autumn-bass-lure.js';
import summerSeabassLure from './summer-seabass-lure.js';
import winterSeabassLure from './winter-seabass-lure.js';
// Batch D: レビュー/カラーガイド
import vj16Review from './vj-16-review.js';
import sasuke120Color from './sasuke-120-color.js';
import silentAssassinColor from './silent-assassin-color.js';
import kagelouReview from './kagelou-review.js';
import lureFishingBeginner from './lure-fishing-beginner.js';
// メーカー別おすすめ記事（第11弾）
import shimanoSeabassLure from './shimano-seabass-lure.js';
import daiwaSeabassLure from './daiwa-seabass-lure.js';
import shimanoTroutLure from './shimano-trout-lure.js';
import daiwaEgingEgi from './daiwa-eging-egi.js';
import jackallBassLure from './jackall-bass-lure.js';
// メーカー別おすすめ記事（第12弾）
import megabassBassLure from './megabass-bass-lure.js';
import ospBassLure from './osp-bass-lure.js';
import duoSeabassLure from './duo-seabass-lure.js';
import jackallSeabassLure from './jackall-seabass-lure.js';
import depsBassLure from './deps-bass-lure.js';
// メーカー別おすすめ記事（第13弾）
import duelSeabassLure from './duel-seabass-lure.js';
import shimanoCardiffSpoon from './shimano-cardiff-spoon.js';
import daiwaGekkaBijin from './daiwa-gekka-bijin.js';
import megabassSeabassLure from './megabass-seabass-lure.js';
import jackallAjiMebaru from './jackall-aji-mebaru.js';
// メーカー別おすすめ記事（第14弾）
import imaSeabassLure from './ima-seabass-lure.js';
import majorcraftShoreJigging from './majorcraft-shore-jigging.js';
import daiwaShoreJigging from './daiwa-shore-jigging.js';
import shimanoShoreJigging from './shimano-shore-jigging.js';
import duelEgingEgi from './duel-eging-egi.js';

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
  // GSCデータ駆動記事（第8弾）
  seabassVibration,
  mebaruWorm,
  ajiJighead,
  rockfishWorm,
  bassBigbait,
  tachiuoMetaljig,
  hirameMetaljig,
  bassMetalVib,
  mebaruJighead,
  seabassWorm,
  // 第9弾
  seabassNightGame,
  surfHirameHowto,
  bassSightFishing,
  egingAutumnHowto,
  ajiNightGame,
  madaiMetalJig,
  chimuTopwater,
  aomonoDivingPencil,
  autumnSeabassLure,
  winterMebaru,
  summerBassTopwater,
  hirameMinnowGuide,
  kurodaiRubberJig,
  flatfishJighead,
  bassWormTexasRig,
  // 第10弾（Web調査ベース）
  shoreJiggingGuide,
  sawaraLure,
  winterBassLure,
  sakuramasuLure,
  lureColorGuideGeneral,
  keiryuLure,
  namazuLure,
  tachiuoWinding,
  ikaMetalGuide,
  chiningWorm,
  seabassBeginner,
  springBassLure,
  autumnBassLure,
  summerSeabassLure,
  winterSeabassLure,
  vj16Review,
  sasuke120Color,
  silentAssassinColor,
  kagelouReview,
  lureFishingBeginner,
  // メーカー別おすすめ記事（第11弾）
  shimanoSeabassLure,
  daiwaSeabassLure,
  shimanoTroutLure,
  daiwaEgingEgi,
  jackallBassLure,
  // メーカー別おすすめ記事（第12弾）
  megabassBassLure,
  ospBassLure,
  duoSeabassLure,
  jackallSeabassLure,
  depsBassLure,
  // メーカー別おすすめ記事（第13弾）
  duelSeabassLure,
  shimanoCardiffSpoon,
  daiwaGekkaBijin,
  megabassSeabassLure,
  jackallAjiMebaru,
  // メーカー別おすすめ記事（第14弾）
  imaSeabassLure,
  majorcraftShoreJigging,
  daiwaShoreJigging,
  shimanoShoreJigging,
  duelEgingEgi,
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
