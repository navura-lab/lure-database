/**
 * 検索用軽量JSONエンドポイント
 *
 * ビルド時に全シリーズのデータを軽量JSONとして出力。
 * クライアントサイドでインメモリ検索に使う。
 * APIコール不要で即座に検索可能。
 */
import type { APIRoute } from 'astro';
import { fetchAllLures } from '../lib/fetch-all-lures';
import { groupLuresBySeries } from '../lib/group-lures';

export const prerender = true; // SSGで静的生成

export const GET: APIRoute = async () => {
  const lures = await fetchAllLures();
  const series = groupLuresBySeries(lures ?? []);

  // 検索に必要な最小限のフィールドのみ（サイズ削減）
  const index = series.map(s => ({
    s: s.slug,                        // slug
    n: s.name,                        // name
    k: s.name_kana || '',             // name_kana
    m: s.manufacturer,                // manufacturer
    ms: s.manufacturer_slug,          // manufacturer_slug
    t: s.type,                        // type
    f: s.target_fish,                 // target_fish
    i: s.representative_image || '',  // image
    c: s.color_count,                 // color_count
    p: s.price_range?.min || 0,       // price
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
