/**
 * メーカー×対象魚組み合わせページのパス生成
 *
 * /[manufacturer_slug]/fish/[fish_slug]/ で使用。
 * 10シリーズ以上の組み合わせのみ生成（thin content回避）。
 */
import { fetchAllLures } from '../fetch-all-lures';
import { groupLuresBySeries } from '../group-lures';
import { getFishSlug, getTypeSlug } from '../category-slugs';
import { computeColorBreakdown } from '../color-categories';
import { getManufacturerNameJa } from '../manufacturer-names-ja';
import type { LureSeries } from '../types';
import type { ColorBreakdownEntry } from '../color-categories';

const MIN_SERIES = 10;

export interface MakerFishPathProps {
  manufacturerSlug: string;
  manufacturerName: string;
  /** メーカー名の日本語表記（カタカナ）*/
  manufacturerNameJa: string;
  fishName: string;
  fishSlug: string;
  series: LureSeries[];
  totalCount: number;
  colorBreakdown: ColorBreakdownEntry[];
  /** 同メーカーの他対象魚一覧 */
  otherFish: { fishName: string; fishSlug: string; count: number }[];
  /** 同対象魚の他メーカー一覧（上位10） */
  otherMakers: { manufacturerSlug: string; manufacturerName: string; count: number }[];
}

export async function getMakerFishPaths(): Promise<
  { params: { manufacturer_slug: string; fish_slug: string }; props: MakerFishPathProps }[]
> {
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);

  // manufacturer_slug × target_fish のクロス集計
  // 1つのシリーズが複数の対象魚を持つ場合、それぞれにカウント
  const crossMap = new Map<
    string,
    {
      manufacturerSlug: string;
      manufacturerName: string;
      fishName: string;
      fishSlug: string;
      series: LureSeries[];
    }
  >();

  for (const s of allSeries) {
    if (!s.target_fish || s.target_fish.length === 0) continue;
    for (const fish of s.target_fish) {
      if (!fish) continue;
      const fishSlug = getFishSlug(fish);
      const key = `${s.manufacturer_slug}/${fishSlug}`;
      const existing = crossMap.get(key);
      if (existing) {
        // 同じシリーズの重複追加を防止
        if (!existing.series.some(es => es.slug === s.slug)) {
          existing.series.push(s);
        }
      } else {
        crossMap.set(key, {
          manufacturerSlug: s.manufacturer_slug,
          manufacturerName: s.manufacturer,
          fishName: fish,
          fishSlug,
          series: [s],
        });
      }
    }
  }

  // 同対象魚の他メーカー集計用
  const fishToMakers = new Map<string, Map<string, { name: string; count: number }>>();
  for (const [, v] of crossMap) {
    let makers = fishToMakers.get(v.fishSlug);
    if (!makers) {
      makers = new Map();
      fishToMakers.set(v.fishSlug, makers);
    }
    makers.set(v.manufacturerSlug, {
      name: v.manufacturerName,
      count: v.series.length,
    });
  }

  // 同メーカーの他対象魚集計用
  const makerToFish = new Map<string, Map<string, { fishName: string; count: number }>>();
  for (const [, v] of crossMap) {
    let fishes = makerToFish.get(v.manufacturerSlug);
    if (!fishes) {
      fishes = new Map();
      makerToFish.set(v.manufacturerSlug, fishes);
    }
    fishes.set(v.fishSlug, {
      fishName: v.fishName,
      count: v.series.length,
    });
  }

  return [...crossMap.entries()]
    .filter(([, v]) => v.series.length >= MIN_SERIES)
    .map(([, { manufacturerSlug, manufacturerName, fishName, fishSlug, series }]) => {
      // カラー系統集計（全シリーズのカラーを合算）
      const allColorNames = series.flatMap(s => s.colors.map(c => c.color_name));
      const colorBreakdown = computeColorBreakdown(allColorNames);

      // 同メーカーの他対象魚
      const myFish = makerToFish.get(manufacturerSlug)!;
      const otherFish = [...myFish.entries()]
        .filter(([fs]) => fs !== fishSlug)
        .map(([fs, v]) => ({ fishSlug: fs, fishName: v.fishName, count: v.count }))
        .sort((a, b) => b.count - a.count);

      // 同対象魚の他メーカー
      const myMakers = fishToMakers.get(fishSlug)!;
      const otherMakers = [...myMakers.entries()]
        .filter(([ms]) => ms !== manufacturerSlug)
        .filter(([, v]) => v.count >= MIN_SERIES)
        .map(([ms, v]) => ({
          manufacturerSlug: ms,
          manufacturerName: v.name,
          count: v.count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const manufacturerNameJa = getManufacturerNameJa(manufacturerSlug, manufacturerName);

      return {
        params: { manufacturer_slug: manufacturerSlug, fish_slug: fishSlug },
        props: {
          manufacturerSlug,
          manufacturerName,
          manufacturerNameJa,
          fishName,
          fishSlug,
          series,
          totalCount: series.length,
          colorBreakdown,
          otherFish,
          otherMakers,
        },
      };
    });
}
