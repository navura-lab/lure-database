/**
 * 比較ページ共有パス生成
 *
 * ja/en 両方の compare/[slug].astro で使用。
 */
import { fetchAllLures } from '../fetch-all-lures';
import { groupLuresBySeries } from '../group-lures';
import { getTypeSlug, getFishSlug } from '../category-slugs';
import { computeColorBreakdown } from '../color-categories';
import { computeRankingScores } from '../ranking-score';
import { getCuratedRanking } from '../../data/curated-rankings';
import type { LureSeries } from '../types';
import type { ColorBreakdownEntry } from '../color-categories';

export interface ComparePathProps {
  fishName: string;
  typeName: string;
  topSeries: LureSeries[];
  totalCount: number;
  colorBreakdowns: ColorBreakdownEntry[][];
}

export async function getComparePaths() {
  const TOP_N = 5;
  const MIN_SERIES = 3;
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);

  const crossMap = new Map<string, { fishName: string; typeName: string; series: LureSeries[] }>();
  for (const s of allSeries) {
    if (!s.type) continue;
    for (const fish of s.target_fish) {
      const fishSlug = getFishSlug(fish);
      const typeSlug = getTypeSlug(s.type);
      const key = `${fishSlug}-${typeSlug}`;
      const existing = crossMap.get(key);
      if (existing) existing.series.push(s);
      else crossMap.set(key, { fishName: fish, typeName: s.type, series: [s] });
    }
  }

  return [...crossMap.entries()]
    .filter(([_, v]) => v.series.length >= MIN_SERIES)
    .map(([slug, { fishName, typeName, series }]) => {
      const curatedOrder = getCuratedRanking(slug);
      const scores = computeRankingScores(series);

      const seriesMap = new Map<string, LureSeries>();
      for (const s of series) seriesMap.set(`${s.manufacturer_slug}/${s.slug}`, s);

      const curatedSeries: LureSeries[] = [];
      const curatedKeys = new Set<string>();
      for (const key of curatedOrder) {
        const s = seriesMap.get(key);
        if (s) { curatedSeries.push(s); curatedKeys.add(key); }
      }

      const remaining = series
        .filter(s => !curatedKeys.has(`${s.manufacturer_slug}/${s.slug}`))
        .sort((a, b) => {
          const scoreA = scores.get(`${a.manufacturer_slug}/${a.slug}`)?.total ?? 0;
          const scoreB = scores.get(`${b.manufacturer_slug}/${b.slug}`)?.total ?? 0;
          return scoreB - scoreA;
        });

      const sorted = [...curatedSeries, ...remaining];
      const top = sorted.slice(0, TOP_N);
      const colorBreakdowns = top.map(s =>
        computeColorBreakdown(s.colors.map(c => c.color_name))
      );

      return {
        params: { slug },
        props: { fishName, typeName, topSeries: top, totalCount: series.length, colorBreakdowns } as ComparePathProps,
      };
    });
}
