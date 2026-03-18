// scripts/scrapers/types.ts
// Shared type definitions for all manufacturer scrapers

/**
 * A single color variant scraped from a product page.
 */
export interface ScrapedColor {
  name: string;
  imageUrl: string;
}

/**
 * The structured data scraped from a single product page.
 * Every manufacturer scraper must return this shape.
 */
/**
 * ウェイトごとのスペック（サイズ・価格が異なる場合）
 */
export interface WeightSpec {
  weight: number;
  length: number | null;
  price: number;
  model?: string;             // モデル名（例: SBL-40）
}

export interface ScrapedLure {
  name: string;
  name_kana: string;          // カタカナ読み（検索用）
  slug: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  target_fish: string[];      // 対象魚（カテゴリURLや名前から導出）
  description: string;
  price: number;              // 代表価格（weightSpecsがある場合は最小値）
  colors: ScrapedColor[];
  weights: number[];
  length: number | null;      // 代表サイズ（weightSpecsがある場合は最小ウェイトのサイズ）
  mainImage: string;
  sourceUrl: string;
  weightSpecs?: WeightSpec[];  // ウェイトごとのスペック（price/lengthが異なる場合）
}

/**
 * A scraper function takes a product page URL and returns scraped data.
 * Each manufacturer module must export a function matching this signature.
 */
export type ScraperFunction = (url: string) => Promise<ScrapedLure>;
