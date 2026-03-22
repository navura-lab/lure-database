/**
 * キュレーテッドランキング
 * 2026-03-22: 全件削除（根拠なしランキング禁止ルールに抵触）
 */

export interface CuratedRanking {
  slug: string;
  order: string[];
}

export function getCuratedRanking(_slug: string): string[] | null {
  return null;
}

export const curatedRankings: CuratedRanking[] = [];
