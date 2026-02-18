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
export interface ScrapedLure {
  name: string;
  slug: string;
  manufacturer: string;
  manufacturer_slug: string;
  type: string;
  description: string;
  price: number;
  colors: ScrapedColor[];
  weights: number[];
  length: number | null;
  mainImage: string;
  sourceUrl: string;
}

/**
 * A scraper function takes a product page URL and returns scraped data.
 * Each manufacturer module must export a function matching this signature.
 */
export type ScraperFunction = (url: string) => Promise<ScrapedLure>;
