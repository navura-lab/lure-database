/**
 * 釣り方別まとめページ用データ定義
 *
 * 2026-03-22: 全12メソッドを削除（内容が薄すぎるため一掃）
 * 真実性保証パイプライン（Phase B）で再生成予定
 */

export interface FishingMethod {
  slug: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  targetFish: string[];
  mainTypes: string[];
  fields: string[];
  fieldsEn: string[];
  season: string;
  seasonEn: string;
  tips: string[];
  tipsEn: string[];
}

export const fishingMethods: FishingMethod[] = [];
