/**
 * メーカー×タイプ組み合わせページのパス生成
 *
 * /[manufacturer_slug]/type/[type_slug]/ で使用。
 * 10シリーズ以上の組み合わせのみ生成（thin content回避）。
 */
import { fetchAllLures } from '../fetch-all-lures';
import { groupLuresBySeries } from '../group-lures';
import { getTypeSlug, TYPE_SLUG_MAP } from '../category-slugs';
import { computeColorBreakdown } from '../color-categories';
import { getManufacturerNameJa } from '../manufacturer-names-ja';
import type { LureSeries } from '../types';
import type { ColorBreakdownEntry } from '../color-categories';

const MIN_SERIES = 10;

export interface MakerTypePathProps {
  manufacturerSlug: string;
  manufacturerName: string;
  /** メーカー名の日本語表記（カタカナ）*/
  manufacturerNameJa: string;
  typeName: string;
  typeSlug: string;
  series: LureSeries[];
  totalCount: number;
  colorBreakdown: ColorBreakdownEntry[];
  /** 同メーカーの他タイプ一覧（type_slug, typeName, count） */
  otherTypes: { typeSlug: string; typeName: string; count: number }[];
  /** 同タイプの他メーカー一覧（manufacturer_slug, manufacturerName, count）上位10 */
  otherMakers: { manufacturerSlug: string; manufacturerName: string; count: number }[];
}

export async function getMakerTypePaths(): Promise<
  { params: { manufacturer_slug: string; type_slug: string }; props: MakerTypePathProps }[]
> {
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);

  // manufacturer_slug × type のクロス集計
  const crossMap = new Map<
    string,
    {
      manufacturerSlug: string;
      manufacturerName: string;
      typeName: string;
      typeSlug: string;
      series: LureSeries[];
    }
  >();

  for (const s of allSeries) {
    if (!s.type) continue;
    const typeSlug = getTypeSlug(s.type);
    const key = `${s.manufacturer_slug}/${typeSlug}`;
    const existing = crossMap.get(key);
    if (existing) {
      existing.series.push(s);
    } else {
      crossMap.set(key, {
        manufacturerSlug: s.manufacturer_slug,
        manufacturerName: s.manufacturer,
        typeName: s.type,
        typeSlug,
        series: [s],
      });
    }
  }

  // 同タイプの他メーカー集計用
  const typeToMakers = new Map<string, Map<string, { name: string; count: number }>>();
  for (const [, v] of crossMap) {
    let makers = typeToMakers.get(v.typeSlug);
    if (!makers) {
      makers = new Map();
      typeToMakers.set(v.typeSlug, makers);
    }
    makers.set(v.manufacturerSlug, {
      name: v.manufacturerName,
      count: v.series.length,
    });
  }

  // 同メーカーの他タイプ集計用
  const makerToTypes = new Map<string, Map<string, { typeName: string; count: number }>>();
  for (const [, v] of crossMap) {
    let types = makerToTypes.get(v.manufacturerSlug);
    if (!types) {
      types = new Map();
      makerToTypes.set(v.manufacturerSlug, types);
    }
    types.set(v.typeSlug, {
      typeName: v.typeName,
      count: v.series.length,
    });
  }

  return [...crossMap.entries()]
    .filter(([, v]) => v.series.length >= MIN_SERIES)
    .map(([, { manufacturerSlug, manufacturerName, typeName, typeSlug, series }]) => {
      // カラー系統集計（全シリーズのカラーを合算）
      const allColorNames = series.flatMap(s => s.colors.map(c => c.color_name));
      const colorBreakdown = computeColorBreakdown(allColorNames);

      // 同メーカーの他タイプ
      const myTypes = makerToTypes.get(manufacturerSlug)!;
      const otherTypes = [...myTypes.entries()]
        .filter(([ts]) => ts !== typeSlug)
        .map(([ts, v]) => ({ typeSlug: ts, typeName: v.typeName, count: v.count }))
        .sort((a, b) => b.count - a.count);

      // 同タイプの他メーカー
      const myMakers = typeToMakers.get(typeSlug)!;
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
        params: { manufacturer_slug: manufacturerSlug, type_slug: typeSlug },
        props: {
          manufacturerSlug,
          manufacturerName,
          manufacturerNameJa,
          typeName,
          typeSlug,
          series,
          totalCount: series.length,
          colorBreakdown,
          otherTypes,
          otherMakers,
        },
      };
    });
}
