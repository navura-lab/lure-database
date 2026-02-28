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
import { scrapeGeecrackPage } from './geecrack.js';
import { scrapeReinsPage } from './reins.js';
import { scrapeBerkleyPage } from './berkley.js';
import { scrapeEnginePage } from './engine.js';
import { scrapeHideupPage } from './hideup.js';
import { scrapeLittleJackPage } from './littlejack.js';
import { scrapeJumprizePage } from './jumprize.js';
import { scrapeThirtyfourPage } from './thirtyfour.js';
import { scrapeTictPage } from './tict.js';
import { scrapeNoikePage } from './noike.js';
import { scrapeBaitBreathPage } from './baitbreath.js';
import { scrapePalmsPage } from './palms.js';
import { scrapeMadnessPage } from './madness.js';
// --- Formerly standalone scrapers (converted 2026-02-28) ---
import { scrapeBeatPage } from './beat.js';
import { scrapeBoreasPage } from './boreas.js';
import { scrapeBozlesPage } from './bozles.js';
import { scrapeCarpenterPage } from './carpenter.js';
import { scrapeCbOnePage } from './cb-one.js';
import { scrapeCrazyOceanPage } from './crazy-ocean.js';
import { scrapeDClawPage } from './d-claw.js';
import { scrapeDeepLinerPage } from './deep-liner.js';
import { scrapeDrtPage } from './drt.js';
import { scrapeFlashUnionPage } from './flash-union.js';
import { scrapeForestPage } from './forest.js';
import { scrapeHmklPage } from './hmkl.js';
import { scrapeHotsPage } from './hots.js';
import { scrapeJaDoPage } from './ja-do.js';
import { scrapeMcWorksPage } from './mc-works.js';
import { scrapeMukaiPage } from './mukai.js';
import { scrapeNatureBoysPage } from './nature-boys.js';
import { scrapeNorthCraftPage } from './north-craft.js';
import { scrapeValkeinPage } from './valkein.js';
// --- New modular scrapers (Phase 2, 2026-02-28) ---
import { scrapeBreadenPage } from './breaden.js';
import { scrapeDranckrazyPage } from './dranckrazy.js';
import { scrapeHarimitsuPage } from './harimitsu.js';
import { scrapeHayabusaPage } from './hayabusa.js';
import { scrapeLonginPage } from './longin.js';
import { scrapeSeafloorControlPage } from './seafloor-control.js';
import { scrapeXestaPage } from './xesta.js';
import { scrapeZeakePage } from './zeake.js';
// --- New modular scrapers (Phase 3, 2026-03-01) ---
import { scrapeSignalPage } from './signal.js';
import { scrapeSkagitPage } from './skagit.js';
import { scrapeSoulsPage } from './souls.js';
import { scrapeThTacklePage } from './th-tackle.js';
import { scrapeVivaPage } from './viva.js';
import { scrapeYariePage } from './yarie.js';
import { scrapeZeroDragonPage } from './zero-dragon.js';
// --- Phase 3 batch A+B ---
import { scrapeAtticPage } from './attic.js';
import { scrapeDamikiPage } from './damiki.js';
import { scrapeDreemupPage } from './dreemup.js';
import { scrapeGodHandsPage } from './god-hands.js';
import { scrapeGrassrootsPage } from './grassroots.js';
import { scrapeItocraftPage } from './itocraft.js';
import { scrapeIvyLinePage } from './ivy-line.js';
import { scrapeJazzPage } from './jazz-lure.js';
import { scrapeJungleGymPage } from './jungle-gym.js';
import { scrapeMibroPage } from './mibro.js';
import { scrapeObasslivePage } from './obasslive.js';
import { scrapePhatLabPage } from './phat-lab.js';
import { scrapePickupPage } from './pickup.js';
import { scrapePozidriveGaragePage } from './pozidrive-garage.js';
import { scrapeSeaFalconPage } from './sea-falcon.js';
import { scrapeShoutPage } from './shout.js';

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
  geecrack: scrapeGeecrackPage,
  reins: scrapeReinsPage,
  berkley: scrapeBerkleyPage,
  engine: scrapeEnginePage,
  hideup: scrapeHideupPage,
  littlejack: scrapeLittleJackPage,
  jumprize: scrapeJumprizePage,
  thirtyfour: scrapeThirtyfourPage,
  tict: scrapeTictPage,
  noike: scrapeNoikePage,
  baitbreath: scrapeBaitBreathPage,
  palms: scrapePalmsPage,
  madness: scrapeMadnessPage,
  // --- Formerly standalone scrapers (converted 2026-02-28) ---
  beat: scrapeBeatPage,
  boreas: scrapeBoreasPage,
  bozles: scrapeBozlesPage,
  carpenter: scrapeCarpenterPage,
  'cb-one': scrapeCbOnePage,
  'crazy-ocean': scrapeCrazyOceanPage,
  'd-claw': scrapeDClawPage,
  deepliner: scrapeDeepLinerPage,
  drt: scrapeDrtPage,
  'flash-union': scrapeFlashUnionPage,
  forest: scrapeForestPage,
  hmkl: scrapeHmklPage,
  hots: scrapeHotsPage,
  'ja-do': scrapeJaDoPage,
  'mc-works': scrapeMcWorksPage,
  mukai: scrapeMukaiPage,
  'nature-boys': scrapeNatureBoysPage,
  'north-craft': scrapeNorthCraftPage,
  valkein: scrapeValkeinPage,
  // --- New modular scrapers (Phase 2, 2026-02-28) ---
  breaden: scrapeBreadenPage,
  dranckrazy: scrapeDranckrazyPage,
  harimitsu: scrapeHarimitsuPage,
  hayabusa: scrapeHayabusaPage,
  longin: scrapeLonginPage,
  'seafloor-control': scrapeSeafloorControlPage,
  xesta: scrapeXestaPage,
  zeake: scrapeZeakePage,
  // --- New modular scrapers (Phase 3, 2026-03-01) ---
  signal: scrapeSignalPage,
  skagit: scrapeSkagitPage,
  souls: scrapeSoulsPage,
  'th-tackle': scrapeThTacklePage,
  viva: scrapeVivaPage,
  yarie: scrapeYariePage,
  'zero-dragon': scrapeZeroDragonPage,
  // --- Phase 3 batch A+B ---
  attic: scrapeAtticPage,
  damiki: scrapeDamikiPage,
  dreemup: scrapeDreemupPage,
  'god-hands': scrapeGodHandsPage,
  grassroots: scrapeGrassrootsPage,
  itocraft: scrapeItocraftPage,
  'ivy-line': scrapeIvyLinePage,
  jazz: scrapeJazzPage,
  'jungle-gym': scrapeJungleGymPage,
  mibro: scrapeMibroPage,
  obasslive: scrapeObasslivePage,
  'phat-lab': scrapePhatLabPage,
  pickup: scrapePickupPage,
  'pozidrive-garage': scrapePozidriveGaragePage,
  'sea-falcon': scrapeSeaFalconPage,
  shout: scrapeShoutPage,
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
