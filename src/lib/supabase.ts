import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Lure = {
  id: string
  name: string
  slug: string
  manufacturer: string
  manufacturer_slug: string
  type: string
  price: number
  description: string | null
  images: string[] | null
  official_video_url: string | null
  target_fish: string[] | null
  length: number | null
  weight: number | null
  color_name: string | null
  color_description: string | null
  release_year: number | null
  is_limited: boolean
  diving_depth: string | null
  action_type: string | null
  source_url: string | null
  is_discontinued: boolean
  created_at: string
  updated_at: string
}
