/**
 * ランキングページ共有パス生成
 *
 * ja/en 両方の ranking/[slug].astro で使用。
 * getStaticPaths のデータ取得・集計ロジックを共有化。
 */
import { fetchAllLures } from '../fetch-all-lures';
import { groupLuresBySeries } from '../group-lures';
import { getTypeSlug, getFishSlug } from '../category-slugs';
import { computeRankingScores } from '../ranking-score';
import { getCuratedRanking } from '../../data/curated-rankings';
import type { LureSeries } from '../types';

export interface RankingPathProps {
  fishName: string;
  typeName: string;
  rankedSeries: (LureSeries & { score: number })[];
  related: { slug: string; fishName: string; typeName: string; count: number }[];
  isCurated: boolean;
}

export async function getRankingPaths() {
  const MIN_SERIES = 3;
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);

  // 魚種×タイプのクロス集計
  const crossMap = new Map<string, { fishName: string; typeName: string; series: LureSeries[] }>();
  for (const s of allSeries) {
    if (!s.type) continue;
    for (const fish of s.target_fish) {
      const fishSlug = getFishSlug(fish);
      const typeSlug = getTypeSlug(s.type);
      const key = `${fishSlug}-${typeSlug}`;
      const existing = crossMap.get(key);
      if (existing) {
        existing.series.push(s);
      } else {
        crossMap.set(key, { fishName: fish, typeName: s.type, series: [s] });
      }
    }
  }

  // 全ランキング一覧（関連ランキング算出用）
  const allRankings = [...crossMap.entries()]
    .filter(([_, v]) => v.series.length >= MIN_SERIES)
    .map(([slug, v]) => ({ slug, fishName: v.fishName, typeName: v.typeName, count: v.series.length }));

  return allRankings.map(({ slug, fishName, typeName }) => {
    const data = crossMap.get(slug)!;

    // ソート: キュレーテッド優先 → アルゴリズムスコア
    const curatedOrder = getCuratedRanking(slug);
    const scores = computeRankingScores(data.series);
    const isCurated = curatedOrder.length > 0;

    const seriesMap = new Map<string, LureSeries>();
    for (const s of data.series) {
      seriesMap.set(`${s.manufacturer_slug}/${s.slug}`, s);
    }

    const curatedSeries: (LureSeries & { score: number })[] = [];
    const curatedKeys = new Set<string>();
    for (const key of curatedOrder) {
      const s = seriesMap.get(key);
      if (s) {
        curatedSeries.push({ ...s, score: 1 });
        curatedKeys.add(key);
      }
    }

    const remainingSeries = data.series
      .filter(s => !curatedKeys.has(`${s.manufacturer_slug}/${s.slug}`))
      .map(s => {
        const key = `${s.manufacturer_slug}/${s.slug}`;
        const rankingScore = scores.get(key);
        return { ...s, score: rankingScore?.total ?? 0 };
      })
      .sort((a, b) => b.score - a.score);

    const rankedSeries = [...curatedSeries, ...remainingSeries];

    const related = allRankings
      .filter(r => r.slug !== slug && (r.fishName === fishName || r.typeName === typeName))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      params: { slug },
      props: { fishName, typeName, rankedSeries, related, isCurated } as RankingPathProps,
    };
  });
}
