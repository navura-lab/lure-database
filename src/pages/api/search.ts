/**
 * 検索API — Supabase RPC経由の高速検索
 *
 * lure_seriesマテリアライズドビュー（~7,900行）に対してilike検索。
 * 15万行のluresテーブルではなく事前集計済みデータを検索するため高速。
 *
 * フォールバック: lure_seriesが未作成の場合はluresテーブルに直接検索（遅い）
 */
import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q') || '';
  const manufacturer = url.searchParams.get('manufacturer') || '';
  const type = url.searchParams.get('type') || '';
  const targetFish = url.searchParams.get('targetFish') || '';
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

  try {
    // まずRPC関数を試す（lure_seriesがある場合、爆速）
    if (query) {
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('search_lures', { query, result_limit: limit });

      if (!rpcError && rpcData) {
        // フィルタ追加（RPC結果に対してクライアント側フィルタ）
        let results = rpcData;
        if (manufacturer) results = results.filter((r: any) => r.manufacturer === manufacturer);
        if (type) results = results.filter((r: any) => r.type === type);
        if (targetFish) results = results.filter((r: any) => r.target_fish?.includes(targetFish));

        return json({
          items: results,
          total: results.length,
          source: 'rpc',
        });
      }
    }

    // フォールバック: lure_seriesビューに直接クエリ
    let dbQuery = supabase
      .from('lure_series')
      .select('slug,manufacturer_slug,name,name_kana,manufacturer,type,target_fish,representative_image,color_count,price_min,price_max')
      .order('color_count', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query) {
      dbQuery = dbQuery.or(`name.ilike.%${query}%,name_kana.ilike.%${query}%,manufacturer.ilike.%${query}%`);
    }
    if (manufacturer) dbQuery = dbQuery.eq('manufacturer', manufacturer);
    if (type) dbQuery = dbQuery.eq('type', type);

    const { data, error, count } = await dbQuery;

    if (error) {
      // lure_seriesもない場合、luresテーブルにフォールバック（遅い）
      console.warn('lure_series not available, falling back to lures table');
      let fallback = supabase
        .from('lures')
        .select('slug,name,name_kana,manufacturer_slug,manufacturer,type,target_fish,images,price')
        .order('slug')
        .limit(limit);

      if (query) {
        fallback = fallback.or(`name.ilike.%${query}%,name_kana.ilike.%${query}%`);
      }
      if (manufacturer) fallback = fallback.eq('manufacturer', manufacturer);
      if (type) fallback = fallback.eq('type', type);

      const { data: fbData } = await fallback;
      // 簡易グルーピング
      const seen = new Map<string, any>();
      for (const r of fbData || []) {
        if (!seen.has(r.slug)) {
          seen.set(r.slug, {
            slug: r.slug,
            manufacturer_slug: r.manufacturer_slug,
            name: r.name,
            name_kana: r.name_kana,
            manufacturer: r.manufacturer,
            type: r.type,
            target_fish: r.target_fish || [],
            representative_image: r.images?.[0] || null,
            color_count: 1,
            price_min: r.price || 0,
            price_max: r.price || 0,
          });
        } else {
          seen.get(r.slug)!.color_count++;
        }
      }
      return json({ items: [...seen.values()], total: seen.size, source: 'fallback' });
    }

    return json({ items: data || [], total: data?.length || 0, source: 'view' });

  } catch (err) {
    console.error('Search API error:', err);
    return json({ error: 'Internal error', items: [], total: 0 }, 500);
  }
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
