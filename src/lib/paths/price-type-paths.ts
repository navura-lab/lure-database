/**
 * 価格帯×タイプ組み合わせページのパス生成
 *
 * /price/[price_slug]/[type_slug]/ で使用。
 * 10シリーズ以上の組み合わせのみ生成（thin content回避）。
 */
import { fetchAllLures } from '../fetch-all-lures';
import { groupLuresBySeries } from '../group-lures';
import { getTypeSlug } from '../category-slugs';
import { computeColorBreakdown } from '../color-categories';
import { getManufacturerNameJa } from '../manufacturer-names-ja';
import type { LureSeries } from '../types';
import type { ColorBreakdownEntry } from '../color-categories';

const MIN_SERIES = 10;

/** 価格帯定義（5段階） */
export const PRICE_BANDS = [
  { label: '1,000円以下', slug: 'under-1000', min: 0, max: 1000 },
  { label: '1,001〜2,000円', slug: '1000-2000', min: 1001, max: 2000 },
  { label: '2,001〜3,000円', slug: '2000-3000', min: 2001, max: 3000 },
  { label: '3,001〜5,000円', slug: '3000-5000', min: 3001, max: 5000 },
  { label: '5,001円以上', slug: 'over-5000', min: 5001, max: Infinity },
] as const;

export interface PriceTypePathProps {
  priceLabel: string;
  priceSlug: string;
  priceMin: number;
  priceMax: number;
  typeName: string;
  typeSlug: string;
  series: LureSeries[];
  totalCount: number;
  colorBreakdown: ColorBreakdownEntry[];
  topMakers: { name: string; slug: string; count: number }[];
  /** 同価格帯の他タイプ一覧 */
  otherTypes: { typeSlug: string; typeName: string; count: number }[];
  /** 同タイプの他価格帯一覧 */
  otherPriceBands: { priceSlug: string; priceLabel: string; count: number }[];
}

/** シリーズの代表価格（min > 0 優先、なければ max）を返す。0以下なら null */
function getRepresentativePrice(s: LureSeries): number | null {
  const p = s.price_range.min > 0 ? s.price_range.min : s.price_range.max;
  return p > 0 ? p : null;
}

/** 代表価格がどの価格帯に属するかを返す */
function findBand(price: number) {
  return PRICE_BANDS.find(b => price >= b.min && price <= b.max) ?? null;
}

export async function getPriceTypePaths(): Promise<
  { params: { price_slug: string; type_slug: string }; props: PriceTypePathProps }[]
> {
  const lures = await fetchAllLures();
  const allSeries = groupLuresBySeries(lures ?? []);

  // price_slug × type_slug のクロス集計
  const crossMap = new Map<
    string,
    {
      priceLabel: string;
      priceSlug: string;
      priceMin: number;
      priceMax: number;
      typeName: string;
      typeSlug: string;
      series: LureSeries[];
    }
  >();

  for (const s of allSeries) {
    if (!s.type) continue;
    const price = getRepresentativePrice(s);
    if (price == null) continue;
    const band = findBand(price);
    if (!band) continue;

    const typeSlug = getTypeSlug(s.type);
    const key = `${band.slug}/${typeSlug}`;
    const existing = crossMap.get(key);
    if (existing) {
      existing.series.push(s);
    } else {
      crossMap.set(key, {
        priceLabel: band.label,
        priceSlug: band.slug,
        priceMin: band.min,
        priceMax: band.max === Infinity ? 999999 : band.max,
        typeName: s.type,
        typeSlug,
        series: [s],
      });
    }
  }

  // 同タイプ×他価格帯の集計用
  const typeToPriceBands = new Map<string, Map<string, { label: string; count: number }>>();
  for (const [, v] of crossMap) {
    let bands = typeToPriceBands.get(v.typeSlug);
    if (!bands) {
      bands = new Map();
      typeToPriceBands.set(v.typeSlug, bands);
    }
    bands.set(v.priceSlug, { label: v.priceLabel, count: v.series.length });
  }

  // 同価格帯×他タイプの集計用
  const priceToTypes = new Map<string, Map<string, { typeName: string; count: number }>>();
  for (const [, v] of crossMap) {
    let types = priceToTypes.get(v.priceSlug);
    if (!types) {
      types = new Map();
      priceToTypes.set(v.priceSlug, types);
    }
    types.set(v.typeSlug, { typeName: v.typeName, count: v.series.length });
  }

  return [...crossMap.entries()]
    .filter(([, v]) => v.series.length >= MIN_SERIES)
    .map(([, entry]) => {
      const { priceLabel, priceSlug, priceMin, priceMax, typeName, typeSlug, series } = entry;

      // カラー系統集計
      const allColorNames = series.flatMap(s => s.colors.map(c => c.color_name));
      const colorBreakdown = computeColorBreakdown(allColorNames);

      // メーカー別集計（上位10）
      const makerCount = new Map<string, { name: string; slug: string; count: number }>();
      for (const s of series) {
        const existing = makerCount.get(s.manufacturer_slug);
        if (existing) {
          existing.count++;
        } else {
          makerCount.set(s.manufacturer_slug, {
            name: getManufacturerNameJa(s.manufacturer_slug, s.manufacturer),
            slug: s.manufacturer_slug,
            count: 1,
          });
        }
      }
      const topMakers = [...makerCount.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // 同価格帯の他タイプ
      const myTypes = priceToTypes.get(priceSlug)!;
      const otherTypes = [...myTypes.entries()]
        .filter(([ts]) => ts !== typeSlug)
        .filter(([, v]) => v.count >= MIN_SERIES)
        .map(([ts, v]) => ({ typeSlug: ts, typeName: v.typeName, count: v.count }))
        .sort((a, b) => b.count - a.count);

      // 同タイプの他価格帯
      const myBands = typeToPriceBands.get(typeSlug)!;
      const otherPriceBands = [...myBands.entries()]
        .filter(([ps]) => ps !== priceSlug)
        .filter(([, v]) => v.count >= MIN_SERIES)
        .map(([ps, v]) => ({ priceSlug: ps, priceLabel: v.label, count: v.count }))
        .sort((a, b) => {
          // PRICE_BANDS の定義順でソート
          const idxA = PRICE_BANDS.findIndex(pb => pb.slug === a.priceSlug);
          const idxB = PRICE_BANDS.findIndex(pb => pb.slug === b.priceSlug);
          return idxA - idxB;
        });

      return {
        params: { price_slug: priceSlug, type_slug: typeSlug },
        props: {
          priceLabel,
          priceSlug,
          priceMin,
          priceMax,
          typeName,
          typeSlug,
          series,
          totalCount: series.length,
          colorBreakdown,
          topMakers,
          otherTypes,
          otherPriceBands,
        },
      };
    });
}
