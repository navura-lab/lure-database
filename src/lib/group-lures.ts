import type { Lure } from './supabase';
import type { LureSeries, ColorVariant, WeightVariant } from './types';

function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

export function groupLuresBySeries(lures: Lure[]): LureSeries[] {
  // name + slug でグルーピング（slugはDBから取得）
  const seriesMap = new Map<string, Lure[]>();

  for (const lure of lures) {
    // slugがない旧データはスキップ（マイグレーション前の互換性）
    if (!lure.slug || !lure.manufacturer_slug) continue;
    const key = lure.slug; // DB格納の英語slug
    const existing = seriesMap.get(key) || [];
    existing.push(lure);
    seriesMap.set(key, existing);
  }

  const result: LureSeries[] = [];

  for (const [slug, records] of seriesMap) {
    const rep = records[0];

    const representativeImage = records
      .flatMap(r => r.images ?? [])
      .find(img => img && img.length > 0) ?? null;

    // カラー名でグルーピング（同じカラー名の異なるウェイトは1つにまとめる）
    const colorMap = new Map<string, {
      records: Lure[];
      color_name: string;
    }>();

    for (const r of records) {
      if (!r.color_name) continue;
      const cleanName = stripHtmlTags(r.color_name);
      const existing = colorMap.get(cleanName);
      if (existing) {
        existing.records.push(r);
      } else {
        colorMap.set(cleanName, { records: [r], color_name: cleanName });
      }
    }

    const colors: ColorVariant[] = [];
    for (const [, group] of colorMap) {
      // 同じカラー名内でweight|lengthの重複排除
      const seenWeights = new Set<string>();
      const weights: WeightVariant[] = [];
      const allImages: string[] = [];
      let isLimited = false;
      let isDiscontinued = false;
      let colorDescription: string | null = null;

      for (const r of group.records) {
        const weightKey = `${r.weight ?? ''}|${r.length ?? ''}`;
        if (!seenWeights.has(weightKey)) {
          seenWeights.add(weightKey);
          weights.push({
            weight: r.weight,
            length: r.length,
            price: r.price,
          });
        }
        if (r.images) allImages.push(...r.images);
        if (r.is_limited) isLimited = true;
        if (r.is_discontinued) isDiscontinued = true;
        if (!colorDescription && r.color_description) colorDescription = r.color_description;
      }

      colors.push({
        color_name: group.color_name,
        color_description: colorDescription,
        weights,
        images: allImages.length > 0 ? [...new Set(allImages)] : null,
        is_limited: isLimited,
        is_discontinued: isDiscontinued,
      });
    }

    const prices = records.map(r => r.price).filter(Boolean) as number[];
    const weights = records.map(r => r.weight).filter(Boolean) as number[];
    const lengths = records.map(r => r.length).filter(Boolean) as number[];

    const allTargetFish = [...new Set(
      records.flatMap(r => r.target_fish ?? [])
    )];

    result.push({
      slug,
      name: rep.name,
      manufacturer: rep.manufacturer,
      manufacturer_slug: rep.manufacturer_slug,
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
      created_at: records
        .map(r => r.created_at)
        .sort()[0],
    });
  }

  result.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return result;
}
