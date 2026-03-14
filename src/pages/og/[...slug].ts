/**
 * OGP画像SSRエンドポイント
 * /og/{manufacturer_slug}/{series_slug}/ → 1200x630 PNG
 *
 * Vercel CDN 7日、ブラウザ1日キャッシュ
 */
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { generateOgImage } from '../../lib/og-image';
import type { LureSeries } from '../../lib/types';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug; // "manufacturer_slug/series_slug"
  if (!slug) {
    return new Response('Not Found', { status: 404 });
  }

  const parts = slug.split('/');
  if (parts.length !== 2) {
    return new Response('Not Found', { status: 404 });
  }

  const [manufacturerSlug, seriesSlug] = parts;

  try {
    // Supabaseから該当ルアーのバリエーションを取得
    const { data: lures, error } = await supabase
      .from('lures')
      .select('name, slug, manufacturer, manufacturer_slug, type, price, description, images, target_fish, weight, length, color_name, color_description, is_limited, is_discontinued, release_year, diving_depth, action_type, official_video_url, created_at')
      .eq('manufacturer_slug', manufacturerSlug)
      .eq('slug', seriesSlug);

    if (error) {
      console.error('Supabase error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }

    if (!lures || lures.length === 0) {
      return new Response('Not Found', { status: 404 });
    }

    // 最低限のLureSeries相当オブジェクトを構築
    const first = lures[0];
    const prices = lures.map((l) => l.price).filter((p) => p > 0);
    const weights = lures.map((l) => l.weight).filter((w): w is number => w != null);
    const lengths = lures.map((l) => l.length).filter((l): l is number => l != null);
    const colorNames = new Set(lures.map((l) => l.color_name).filter(Boolean));

    // 代表画像: 最初に画像を持つバリアントから取得
    let representativeImage: string | null = null;
    for (const lure of lures) {
      if (lure.images && lure.images.length > 0) {
        representativeImage = lure.images[0];
        break;
      }
    }

    // 対象魚: 全バリアントからユニーク集合
    const targetFishSet = new Set<string>();
    for (const lure of lures) {
      if (lure.target_fish) {
        for (const fish of lure.target_fish) {
          targetFishSet.add(fish);
        }
      }
    }

    const series: LureSeries = {
      slug: seriesSlug,
      name: first.name,
      manufacturer: first.manufacturer,
      manufacturer_slug: first.manufacturer_slug,
      type: first.type,
      description: first.description,
      target_fish: Array.from(targetFishSet),
      diving_depth: first.diving_depth,
      action_type: first.action_type,
      official_video_url: first.official_video_url,
      release_year: first.release_year,
      representative_image: representativeImage,
      price_range: {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 0,
      },
      color_count: colorNames.size,
      colors: [], // OGP生成には不要
      weight_range: {
        min: weights.length > 0 ? Math.min(...weights) : null,
        max: weights.length > 0 ? Math.max(...weights) : null,
      },
      length_range: {
        min: lengths.length > 0 ? Math.min(...lengths) : null,
        max: lengths.length > 0 ? Math.max(...lengths) : null,
      },
      created_at: first.created_at,
    };

    const pngBuffer = await generateOgImage(series);

    return new Response(pngBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, s-maxage=604800, max-age=86400',
      },
    });
  } catch (err) {
    console.error('OG image generation error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
};
