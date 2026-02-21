// scripts/scrapers/index.ts
// Scraper registry — maps manufacturer_slug to its scraper function.
//
// To add a new manufacturer:
//   1. Create scripts/scrapers/{manufacturer_slug}.ts
//   2. Export a function matching ScraperFunction
//   3. Add one line to SCRAPER_REGISTRY below
//   4. Done. pipeline.ts requires zero changes.

import type { ScraperFunction } from './types.js';
import { scrapeBlueBluePage } from './blueblue.js';
import { scrapeMegabassPage } from './megabass.js';
import { scrapeDaiwaPage } from './daiwa.js';
import { scrapeShimanoPage } from './shimano.js';
import { scrapeImaPage } from './ima.js';
import { scrapeDuoPage } from './duo.js';
import { scrapeDepsPage } from './deps.js';
import { scrapeJackallPage } from './jackall.js';
import { scrapeEvergreenPage } from './evergreen.js';
import { scrapeApiaPage } from './apia.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const SCRAPER_REGISTRY: Record<string, ScraperFunction> = {
  blueblue: scrapeBlueBluePage,
  megabass: scrapeMegabassPage,
  daiwa: scrapeDaiwaPage,
  shimano: scrapeShimanoPage,
  ima: scrapeImaPage,
  duo: scrapeDuoPage,
  deps: scrapeDepsPage,
  jackall: scrapeJackallPage,
  evergreen: scrapeEvergreenPage,
  apia: scrapeApiaPage,
};

/**
 * Get the scraper function for a given manufacturer slug.
 * Returns undefined if no scraper is registered for that manufacturer.
 */
export function getScraper(manufacturerSlug: string): ScraperFunction | undefined {
  return SCRAPER_REGISTRY[manufacturerSlug];
}

/**
 * Get all registered manufacturer slugs.
 */
export function getRegisteredManufacturers(): string[] {
  return Object.keys(SCRAPER_REGISTRY);
}

export type { ScrapedLure, ScrapedColor, ScraperFunction } from './types.js';
