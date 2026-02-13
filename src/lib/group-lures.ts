import type { Lure } from './supabase';
import type { LureSeries, ColorVariant } from './types';
import { slugify } from './slugify';

function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

export function groupLuresBySeries(lures: Lure[]): LureSeries[] {
  const seriesMap = new Map<string, Lure[]>();

  for (const lure of lures) {
    const existing = seriesMap.get(lure.name) || [];
    existing.push(lure);
    seriesMap.set(lure.name, existing);
  }

  const result: LureSeries[] = [];

  for (const [name, records] of seriesMap) {
    const seen = new Set<string>();
    const dedupedRecords: Lure[] = [];
    for (const r of records) {
      const key = `${r.color_name ?? ''}|${r.weight ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedRecords.push(r);
      }
    }

    const rep = dedupedRecords[0];

    const representativeImage = dedupedRecords
      .flatMap(r => r.images ?? [])
      .find(img => img && img.length > 0) ?? null;

    const colors: ColorVariant[] = dedupedRecords
      .filter(r => r.color_name)
      .map(r => ({
        color_name: stripHtmlTags(r.color_name!),
        color_description: r.color_description,
        weight: r.weight,
        length: r.length,
        price: r.price,
        images: r.images,
        is_limited: r.is_limited,
        is_discontinued: r.is_discontinued,
      }));

    const prices = dedupedRecords.map(r => r.price).filter(Boolean) as number[];
    const weights = dedupedRecords.map(r => r.weight).filter(Boolean) as number[];
    const lengths = dedupedRecords.map(r => r.length).filter(Boolean) as number[];

    const allTargetFish = [...new Set(
      dedupedRecords.flatMap(r => r.target_fish ?? [])
    )];

    result.push({
      slug: slugify(name),
      name,
      manufacturer: rep.manufacturer,
      type: rep.type,
      description: rep.description,
      target_fish: allTargetFish,
      diving_depth: rep.diving_depth,
      action_type: rep.action_type,
      official_video_url: rep.official_video_url,
      release_year: rep.release_year,
      representative_image: representativeImage,
      price_range: {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 0,
      },
      color_count: colors.length,
      colors,
      weight_range: {
        min: weights.length > 0 ? Math.min(...weights) : null,
        max: weights.length > 0 ? Math.max(...weights) : null,
      },
      length_range: {
        min: lengths.length > 0 ? Math.min(...lengths) : null,
        max: lengths.length > 0 ? Math.max(...lengths) : null,
      },
      created_at: dedupedRecords
        .map(r => r.created_at)
        .sort()[0],
    });
  }

  result.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return result;
}
