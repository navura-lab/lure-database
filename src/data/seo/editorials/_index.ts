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
import { fs417Editorial } from './fs417';
import { powerfluffyEditorial } from './powerfluffy';
import { kattobiBow130brEditorial } from './kattobi-bow130br';
import { piccoloEditorial } from './piccolo';
import { buttobiKun95sEditorial } from './buttobi-kun95s';
import { clearSPopperEditorial } from './clear-s-popper';
import { oneUpCurly35Editorial } from './one-up-curly-35';
import { tinyKaishinEditorial } from './tiny-kaishin';
import { ebiranBgEditorial } from './ebiran-bg';
import { kingbousougaeruEditorial } from './kingbousougaeru';
import { nichika167fEditorial } from './nichika167f';
import { toukichirouLeadEditorial } from './toukichirou-lead';
import { gyokotsuEditorial } from './gyokotsu';
import { gFlashEditorial } from './g-flash';
import { rushBellEditorial } from './rush-bell';

/** slug → EditorialReview のマップ */
export const editorialReviews: Record<string, EditorialReview> = {
  'huggos': huggosEditorial,
  'gillary-01--01': gillary01Editorial,
  'masukurouto-loki': lokiEditorial,
  'fs417': fs417Editorial,
  'powerfluffy': powerfluffyEditorial,
  'kattobi-bow130br': kattobiBow130brEditorial,
  'piccolo': piccoloEditorial,
  'buttobi-kun95s': buttobiKun95sEditorial,
  'clear-s-popper': clearSPopperEditorial,
  'one-up-curly-35': oneUpCurly35Editorial,
  'tiny-kaishin': tinyKaishinEditorial,
  'ebiran-bg': ebiranBgEditorial,
  'kingbousougaeru': kingbousougaeruEditorial,
  'nichika167f': nichika167fEditorial,
  'toukichirou-lead': toukichirouLeadEditorial,
  'gyokotsu': gyokotsuEditorial,
  'g-flash': gFlashEditorial,
  'rush-bell': rushBellEditorial,
};
