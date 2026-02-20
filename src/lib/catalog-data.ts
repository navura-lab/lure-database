// src/lib/catalog-data.ts
// Shared type for the lightweight catalog card data used by the API and homepage.
// The actual data is generated at build time and embedded in index.astro,
// while the API endpoint queries Supabase directly with pagination.

export interface CatalogCard {
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  target_fish: string[];
  representative_image: string | null;
  color_count: number;
  price_min: number;
  price_max: number;
  is_new: boolean;
  has_limited: boolean;
}
