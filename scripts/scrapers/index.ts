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
import { scrapeCoremanPage } from './coreman.js';
import { scrapePazdesignPage } from './pazdesign.js';
import { scrapeOspPage } from './osp.js';
import { scrapeGancraftPage } from './gancraft.js';
import { scrapeLuckyCraftPage } from './luckycraft.js';
import { scrapeDuelPage } from './duel.js';
import { scrapeTacklehousePage } from './tacklehouse.js';
import { scrapeZipbaitsPage } from './zipbaits.js';
import { scrapeSmithPage } from './smith.js';
import { scrapeTiemcoPage } from './tiemco.js';
import { scrapeRaidPage } from './raid.js';
import { scrapeNoriesPage } from './nories.js';
import { scrapeRapalaPage } from './rapala.js';
import { scrapeMariaPage } from './maria.js';
import { scrapeBassdayPage } from './bassday.js';
import { scrapeJacksonPage } from './jackson.js';
import { scrapeGamakatsuPage } from './gamakatsu.js';
import { scrapeGaryYamamotoPage } from './gary-yamamoto.js';
import { scrapeIsseiPage } from './issei.js';
import { scrapeValleyhillPage } from './valleyhill.js';
import { scrapeMajorcraftPage } from './majorcraft.js';
import { scrapeYamashitaPage } from './yamashita.js';
import { scrapeImakatsuPage } from './imakatsu.js';
import { scrapeBottomupPage } from './bottomup.js';
import { scrapeFisharrowPage } from './fisharrow.js';
import { scrapeKeitechPage } from './keitech.js';
import { scrapeSawamuraPage } from './sawamura.js';
import { scrapeDstylePage } from './dstyle.js';
import { scrapeEcogearPage } from './ecogear.js';

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
  coreman: scrapeCoremanPage,
  pazdesign: scrapePazdesignPage,
  osp: scrapeOspPage,
  gancraft: scrapeGancraftPage,
  luckycraft: scrapeLuckyCraftPage,
  duel: scrapeDuelPage,
  tacklehouse: scrapeTacklehousePage,
  zipbaits: scrapeZipbaitsPage,
  smith: scrapeSmithPage,
  tiemco: scrapeTiemcoPage,
  raid: scrapeRaidPage,
  nories: scrapeNoriesPage,
  rapala: scrapeRapalaPage,
  maria: scrapeMariaPage,
  bassday: scrapeBassdayPage,
  jackson: scrapeJacksonPage,
  gamakatsu: scrapeGamakatsuPage,
  'gary-yamamoto': scrapeGaryYamamotoPage,
  issei: scrapeIsseiPage,
  valleyhill: scrapeValleyhillPage,
  majorcraft: scrapeMajorcraftPage,
  yamashita: scrapeYamashitaPage,
  imakatsu: scrapeImakatsuPage,
  bottomup: scrapeBottomupPage,
  fisharrow: scrapeFisharrowPage,
  keitech: scrapeKeitechPage,
  sawamura: scrapeSawamuraPage,
  dstyle: scrapeDstylePage,
  ecogear: scrapeEcogearPage,
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
