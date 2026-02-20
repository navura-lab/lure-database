// src/pages/api/catalog.ts
// Paginated catalog API — replaces the monolithic JSON blob on the homepage.
// Protected by: API token validation + Referer check + rate limiting (via middleware).

import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import type { Lure } from '../../lib/supabase';
import type { CatalogCard } from '../../lib/catalog-data';

export const prerender = false;

// API token — set via environment variable at build time.
// Rotates every deploy. Client JS receives it embedded in the page.
const API_TOKEN = import.meta.env.LDB_API_TOKEN || '';

// Thirty days ago for "is_new" calculation
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const GET: APIRoute = async ({ request, url }) => {
  // --- Token validation ---
  const token = request.headers.get('x-ldb-token');
  if (!API_TOKEN || token !== API_TOKEN) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Referer check (optional, defense in depth) ---
  const referer = request.headers.get('referer') || '';
  if (referer && !referer.includes('lure-db.com') && !referer.includes('localhost')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Parse query params ---
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10));
  const limit = Math.min(32, Math.max(1, parseInt(url.searchParams.get('limit') || '32', 10)));
  const manufacturer = url.searchParams.get('manufacturer') || '';
  const type = url.searchParams.get('type') || '';
  const targetFish = url.searchParams.get('targetFish') || '';
  const search = url.searchParams.get('search') || '';

  try {
    // --- Build Supabase query ---
    let query = supabase
      .from('lures')
      .select('name, slug, manufacturer, manufacturer_slug, type, price, images, color_name, target_fish, is_limited, created_at')
      .order('created_at', { ascending: false });

    if (manufacturer) {
      query = query.eq('manufacturer', manufacturer);
    }
    if (type) {
      query = query.eq('type', type);
    }
    if (search) {
      query = query.ilike('name', `%${search}%`);
    }
    if (targetFish) {
      query = query.contains('target_fish', [targetFish]);
    }

    const { data: lures, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- Group by series (simplified version of groupLuresBySeries) ---
    const seriesMap = new Map<string, {
      slug: string;
      name: string;
      manufacturer: string;
      manufacturer_slug: string;
      type: string;
      target_fish: Set<string>;
      representative_image: string | null;
      color_names: Set<string>;
      prices: number[];
      is_limited: boolean;
      created_at: string;
    }>();

    const newThreshold = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    for (const lure of (lures || [])) {
      const existing = seriesMap.get(lure.slug);
      if (existing) {
        if (lure.color_name) existing.color_names.add(lure.color_name.replace(/<[^>]*>/g, '').trim());
        if (lure.price) existing.prices.push(lure.price);
        if (lure.is_limited) existing.is_limited = true;
        if (lure.target_fish) lure.target_fish.forEach((f: string) => existing.target_fish.add(f));
        if (!existing.representative_image && lure.images?.length) {
          existing.representative_image = lure.images[0];
        }
      } else {
        const targetFishSet = new Set<string>();
        if (lure.target_fish) lure.target_fish.forEach((f: string) => targetFishSet.add(f));
        seriesMap.set(lure.slug, {
          slug: lure.slug,
          name: lure.name,
          manufacturer: lure.manufacturer,
          manufacturer_slug: lure.manufacturer_slug,
          type: lure.type,
          target_fish: targetFishSet,
          representative_image: lure.images?.[0] || null,
          color_names: new Set(lure.color_name ? [lure.color_name.replace(/<[^>]*>/g, '').trim()] : []),
          prices: lure.price ? [lure.price] : [],
          is_limited: lure.is_limited || false,
          created_at: lure.created_at,
        });
      }
    }

    // Convert to CatalogCard array
    const allCards: CatalogCard[] = [];
    for (const [, s] of seriesMap) {
      allCards.push({
        slug: s.slug,
        name: s.name,
        manufacturer: s.manufacturer,
        manufacturer_slug: s.manufacturer_slug,
        type: s.type,
        target_fish: [...s.target_fish],
        representative_image: s.representative_image,
        color_count: s.color_names.size,
        price_min: s.prices.length > 0 ? Math.min(...s.prices) : 0,
        price_max: s.prices.length > 0 ? Math.max(...s.prices) : 0,
        is_new: s.created_at > newThreshold,
        has_limited: s.is_limited,
      });
    }

    // Sort by created_at (newest first, approximated by is_new flag + name)
    allCards.sort((a, b) => {
      if (a.is_new !== b.is_new) return a.is_new ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // --- Paginate ---
    const total = allCards.length;
    const start = page * limit;
    const items = allCards.slice(start, start + limit);
    const hasMore = start + limit < total;

    return new Response(JSON.stringify({
      items,
      total,
      page,
      hasMore,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-store, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  } catch (err) {
    console.error('Catalog API error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
