import type { Lure } from './supabase';

export type WeightVariant = {
  weight: number | null;
  length: number | null;
  price: number;
};

export type ColorVariant = {
  color_name: string;
  color_description: string | null;
  weights: WeightVariant[];
  images: string[] | null;
  is_limited: boolean;
  is_discontinued: boolean;
};

export type LureSeries = {
  slug: string;
  name: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  description: string | null;
  target_fish: string[];
  diving_depth: string | null;
  action_type: string | null;
  official_video_url: string | null;
  release_year: number | null;
  representative_image: string | null;
  price_range: { min: number; max: number };
  color_count: number;
  colors: ColorVariant[];
  weight_range: { min: number | null; max: number | null };
  length_range: { min: number | null; max: number | null };
  created_at: string;
};
