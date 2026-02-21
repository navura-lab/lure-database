// scripts/backfill-target-fish.ts
// Backfill target_fish column for all existing lure records in Supabase.
//
// Strategy:
//   1. source_url-based mapping (high precision) — derives target fish from
//      manufacturer category URL structure
//   2. type-based fallback — uses existing lure type to infer target species
//   3. manufacturer-based fallback — uses manufacturer identity for specialists
//
// Usage:
//   npx tsx scripts/backfill-target-fish.ts              # execute
//   npx tsx scripts/backfill-target-fish.ts --dry-run    # preview only

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${timestamp()}] [backfill] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[${timestamp()}] [backfill] ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// Shimano: URL path segment → target fish
// URL pattern: /ja-JP/product/lure/{category}/{subcategory}/{id}.html
// ---------------------------------------------------------------------------

const SHIMANO_CATEGORY_FISH: Record<string, string[]> = {
  'seabass': ['シーバス'],
  'surf': ['ヒラメ・マゴチ'],
  'bream': ['クロダイ'],
  'lightgame': ['アジ', 'メバル'],
  'rockyshore_etc': ['青物', 'ロックフィッシュ'],
  'offshorecasting': ['青物'],
  'offshorejigging': ['青物'],
  'shoreeging': ['イカ'],
  'boateging': ['イカ'],
  'tako': ['タコ'],
  'tairubber_etc': ['マダイ'],
  'tachiuo': ['タチウオ'],
  'bass': ['バス'],
  'nativetrout': ['トラウト'],
  'areatrout': ['トラウト'],
};

function deriveShimanoTargetFish(sourceUrl: string): string[] {
  // Extract category from URL: /ja-JP/product/lure/{category}/...
  const match = sourceUrl.match(/\/product\/lure\/([^/]+)\//);
  if (match) {
    const category = match[1];
    if (SHIMANO_CATEGORY_FISH[category]) {
      return SHIMANO_CATEGORY_FISH[category];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Jackall: URL section + subcategory → target fish
// URL patterns:
//   /bass/products/lure/{subcategory}/{slug}/
//   /saltwater/shore-casting/products/lure/{subcategory}/{slug}/
//   /saltwater/offshore-casting/products/{slug}/
//   /timon/products/lure/{subcategory}/{slug}/
// ---------------------------------------------------------------------------

const JACKALL_SUBCATEGORY_FISH: Record<string, string[]> = {
  'sea-bass': ['シーバス'],
  'blue-fish': ['青物'],
  'azi': ['アジ'],
  'mebaru': ['メバル'],
  'surf': ['ヒラメ・マゴチ'],
  'kurodai': ['クロダイ'],
  'rock-fish': ['ロックフィッシュ'],
  'tatiuo': ['タチウオ'],
  'cian': ['青物'],
  'tiprun': ['イカ'],
  'ikametal': ['イカ'],
  'binbinswitch': ['マダイ'],
  'tairaba-tairaba&taijig': ['マダイ'],
  'hitotsu-tenya': ['マダイ'],
  'bluefish-jigging': ['青物'],
  'boat-casting': ['青物'],
  'tatchiuo': ['タチウオ'],
  'bachikon': ['アジ'],
  'fugu': ['フグ'],
  'namazu': ['ナマズ'],
  'ayu': ['鮎'],
};

function deriveJackallTargetFish(sourceUrl: string): string[] {
  // Check section first
  if (sourceUrl.includes('/bass/')) {
    // Check for more specific subcategory
    const subMatch = sourceUrl.match(/\/products\/lure\/([^/]+)\//);
    if (subMatch && JACKALL_SUBCATEGORY_FISH[subMatch[1]]) {
      return JACKALL_SUBCATEGORY_FISH[subMatch[1]];
    }
    return ['バス'];
  }
  if (sourceUrl.includes('/timon/')) {
    const subMatch = sourceUrl.match(/\/products\/lure\/([^/]+)\//);
    if (subMatch && subMatch[1] === 'ayu') return ['鮎'];
    return ['トラウト'];
  }
  if (sourceUrl.includes('/saltwater/')) {
    // Try subcategory
    const subMatch = sourceUrl.match(/\/products\/lure\/([^/]+)\//);
    if (subMatch && JACKALL_SUBCATEGORY_FISH[subMatch[1]]) {
      return JACKALL_SUBCATEGORY_FISH[subMatch[1]];
    }
    // Offshore section
    if (sourceUrl.includes('/offshore-casting/')) {
      return ['青物'];
    }
    // Shore default
    return ['シーバス'];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Evergreen: URL parameter vcts_no → target fish
// URL pattern: goods_list_22lure.php?vctg_no=4&vcts_no={id}&...
// ---------------------------------------------------------------------------

const EVERGREEN_VCTS_FISH: Record<string, string[]> = {
  '29': ['バス'],       // Bass Combat
  '31': ['バス'],       // Bass Mode
  '57': ['バス'],       // Bass Fact
  '24': ['青物'],       // Salt Jigging
  '25': ['イカ'],       // Salt Egging
  '26': ['シーバス'],   // Salt SeaBass
  '27': ['アジ', 'メバル'], // Salt LightGame
  '77': ['トラウト'],   // Trout Area
  '78': ['トラウト'],   // Trout Native
};

function deriveEvergreenTargetFish(sourceUrl: string): string[] {
  // Try vcts_no parameter
  const match = sourceUrl.match(/vcts_no=(\d+)/);
  if (match && EVERGREEN_VCTS_FISH[match[1]]) {
    return EVERGREEN_VCTS_FISH[match[1]];
  }
  // Fallback: check vctt_no (top category)
  const topMatch = sourceUrl.match(/vctt_no=(\d+)/);
  if (topMatch) {
    if (topMatch[1] === '1') return ['バス'];   // Bass category
    if (topMatch[1] === '2') return [];          // Salt - too generic
    if (topMatch[1] === '30') return ['トラウト']; // Trout category
  }
  return [];
}

// ---------------------------------------------------------------------------
// Megabass: URL path → target fish
// URL patterns:
//   /site/freshwater/bass_lure/...  → バス
//   /site/saltwater/sw_lure/...     → ソルト系
// ---------------------------------------------------------------------------

function deriveMegabassTargetFish(sourceUrl: string): string[] {
  if (sourceUrl.includes('/freshwater/') || sourceUrl.includes('/bass_lure/')) {
    return ['バス'];
  }
  if (sourceUrl.includes('/saltwater/') || sourceUrl.includes('/sw_lure/')) {
    // Generic saltwater - rely on type-based fallback
    return [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// DUO: Product page URL doesn't encode category.
// Must rely on type-based fallback.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Daiwa: Product page URL doesn't encode target species.
// Must rely on type-based fallback.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type-based fallback: lure type → target fish
// Used when source_url doesn't provide enough info
// ---------------------------------------------------------------------------

const TYPE_FISH_MAP: Record<string, string[]> = {
  // ソルト - 魚種特定型
  'エギ': ['イカ'],
  'スッテ': ['イカ'],
  'タイラバ': ['マダイ'],
  'テンヤ': ['マダイ'],
  'ひとつテンヤ': ['マダイ'],
  'シーバスルアー': ['シーバス'],
  'アジング': ['アジ'],
  'メバリング': ['メバル'],
  'チニング': ['クロダイ'],
  'ロックフィッシュ': ['ロックフィッシュ'],
  'タチウオルアー': ['タチウオ'],
  'タチウオジギング': ['タチウオ'],
  'ショアジギング': ['青物'],
  'ジギング': ['青物'],
  'オフショアキャスティング': ['青物'],
  'サーフルアー': ['ヒラメ・マゴチ'],
  'ティップラン': ['イカ'],
  'イカメタル': ['イカ'],
  'バチコン': ['アジ'],
  'フロート': ['アジ', 'メバル'],
  'フグルアー': ['フグ'],
  // バス・淡水系
  'ナマズルアー': ['ナマズ'],
  'トラウトルアー': ['トラウト'],
  '鮎ルアー': ['鮎'],
  // バス系型名（バス専用タイプ）
  'ラバージグ': ['バス'],
  'バズベイト': ['バス'],
  'i字系': ['バス'],
  'フロッグ': ['バス'],
};

function deriveFromType(type: string): string[] {
  return TYPE_FISH_MAP[type] || [];
}

// ---------------------------------------------------------------------------
// Manufacturer-based fallback: specialist makers
// Used when both URL and type don't provide info
// ---------------------------------------------------------------------------

const MANUFACTURER_DEFAULT_FISH: Record<string, string[]> = {
  'deps': ['バス'],           // バス専門メーカー
  'ima': ['シーバス'],        // シーバス専門メーカー
  'blueblue': ['シーバス', '青物'], // ソルト専門メーカー
};

// ---------------------------------------------------------------------------
// Name-based hint matching: lure name keywords → target fish
// Used for products where URL/type don't help but name contains hints
// ---------------------------------------------------------------------------

const NAME_FISH_HINTS: [RegExp, string[]][] = [
  // Saltwater species-specific
  [/シーバス|SEA\s?BASS|SEABASS/i, ['シーバス']],
  [/ヒラメ|マゴチ|HIRAME|サーフ|SURF/i, ['ヒラメ・マゴチ']],
  [/青物|ショア.*ジギ|SHORE.*JIG/i, ['青物']],
  [/アジ|AJI|AGING/i, ['アジ']],
  [/メバル|MEBARU|MEBARING/i, ['メバル']],
  [/チヌ|CHINU|クロダイ|チニング/i, ['クロダイ']],
  [/ロック.*フィッシュ|ROCK\s?FISH|カサゴ|ソイ|ハタ/i, ['ロックフィッシュ']],
  [/タチウオ|太刀魚|TACHIUO/i, ['タチウオ']],
  [/イカ|エギング|EGING|アオリ|SQUID/i, ['イカ']],
  [/タコ|TAKO|OCTOPUS/i, ['タコ']],
  [/マダイ|タイラバ|TAIRABA|鯛ラバ|真鯛|鯛魂/i, ['マダイ']],
  [/フグ|FUGU/i, ['フグ']],
  // Freshwater
  [/バス|BASS/i, ['バス']],
  [/トラウト|TROUT|ネイティブトラウト|エリアトラウト/i, ['トラウト']],
  [/ナマズ|CATFISH|NAMAZU/i, ['ナマズ']],
  [/鮎|AYU/i, ['鮎']],
  // Broad categories from name suffixes
  [/SW$|[-_\s]SW\b|\bSW[-_\s]/i, ['シーバス']],  // SW suffix often = saltwater/seabass
];

function deriveFromName(name: string): string[] {
  for (const [pattern, fish] of NAME_FISH_HINTS) {
    if (pattern.test(name)) return fish;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main derivation logic
// ---------------------------------------------------------------------------

function deriveTargetFish(
  sourceUrl: string | null,
  manufacturerSlug: string,
  type: string,
  name: string,
): string[] {
  // --- Phase 1: source_url based (high precision) ---
  if (sourceUrl) {
    let result: string[] = [];

    switch (manufacturerSlug) {
      case 'shimano':
        result = deriveShimanoTargetFish(sourceUrl);
        break;
      case 'jackall':
        result = deriveJackallTargetFish(sourceUrl);
        break;
      case 'evergreen':
        result = deriveEvergreenTargetFish(sourceUrl);
        break;
      case 'megabass':
        result = deriveMegabassTargetFish(sourceUrl);
        break;
    }

    if (result.length > 0) return result;
  }

  // --- Phase 2: type-based fallback ---
  const typeResult = deriveFromType(type);
  if (typeResult.length > 0) return typeResult;

  // --- Phase 2.5: name-based hint matching ---
  // Check before manufacturer default since name can override (e.g. ima's 真鯛魂 → マダイ)
  const nameResult = deriveFromName(name);
  if (nameResult.length > 0) return nameResult;

  // --- Phase 3: manufacturer-based fallback ---
  if (MANUFACTURER_DEFAULT_FISH[manufacturerSlug]) {
    return MANUFACTURER_DEFAULT_FISH[manufacturerSlug];
  }

  // Cannot determine target fish — leave empty
  return [];
}

// ---------------------------------------------------------------------------
// Supabase operations
// ---------------------------------------------------------------------------

interface LureRecord {
  id: string;
  name: string;
  manufacturer_slug: string;
  type: string;
  source_url: string | null;
  target_fish: string[] | null;
}

async function fetchAllLures(): Promise<LureRecord[]> {
  const allRecords: LureRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('lures')
      .select('id, name, manufacturer_slug, type, source_url, target_fish')
      .range(offset, offset + pageSize - 1);

    if (error) {
      logError(`Supabase fetch error at offset ${offset}: ${error.message}`);
      break;
    }

    if (!data || data.length === 0) break;
    allRecords.push(...data);
    offset += data.length;

    if (data.length < pageSize) break;
  }

  return allRecords;
}

async function updateTargetFish(id: string, targetFish: string[]): Promise<boolean> {
  const { error } = await supabase
    .from('lures')
    .update({ target_fish: targetFish })
    .eq('id', id);

  if (error) {
    logError(`Failed to update ${id}: ${error.message}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`=== Target Fish Backfill ${DRY_RUN ? '(DRY RUN)' : ''} ===`);

  // Fetch all records
  log('Fetching all lure records from Supabase...');
  const records = await fetchAllLures();
  log(`Fetched ${records.length} records`);

  // Derive target_fish for each record
  const updates: { id: string; targetFish: string[] }[] = [];
  const stats = {
    total: records.length,
    alreadySet: 0,
    derived: 0,
    unchanged: 0,
    noMatch: 0,
    bySource: {} as Record<string, number>,
  };

  for (const record of records) {
    // Skip records that already have target_fish set
    if (record.target_fish && record.target_fish.length > 0) {
      stats.alreadySet++;
      continue;
    }

    const targetFish = deriveTargetFish(
      record.source_url,
      record.manufacturer_slug,
      record.type,
      record.name,
    );

    if (targetFish.length > 0) {
      updates.push({ id: record.id, targetFish });
      stats.derived++;

      // Track derivation source
      const source = targetFish.join(',');
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
    } else {
      stats.noMatch++;
    }
  }

  // Print summary by target fish
  log('--- Derivation Summary ---');
  log(`Total records: ${stats.total}`);
  log(`Already set: ${stats.alreadySet}`);
  log(`Derived: ${stats.derived}`);
  log(`No match (empty): ${stats.noMatch}`);

  log('--- Target fish distribution ---');
  const sorted = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]);
  for (const [fish, count] of sorted) {
    log(`  ${fish}: ${count} rows`);
  }

  if (DRY_RUN) {
    log('DRY RUN — no updates applied');

    // Show sample updates per manufacturer
    const sampleByMaker = new Map<string, { id: string; name: string; type: string; sourceUrl: string | null; targetFish: string[] }[]>();
    for (const update of updates) {
      const record = records.find(r => r.id === update.id)!;
      const maker = record.manufacturer_slug;
      const samples = sampleByMaker.get(maker) || [];
      if (samples.length < 3) {
        samples.push({
          id: update.id,
          name: record.name,
          type: record.type,
          sourceUrl: record.source_url,
          targetFish: update.targetFish,
        });
        sampleByMaker.set(maker, samples);
      }
    }

    log('--- Sample updates per manufacturer ---');
    for (const [maker, samples] of sampleByMaker) {
      log(`\n[${maker}]`);
      for (const s of samples) {
        log(`  ${s.name} (type=${s.type})`);
        log(`  → target_fish=[${s.targetFish.join(', ')}]`);
      }
    }

    return;
  }

  // Execute updates in batches
  log(`Applying ${updates.length} updates...`);
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    for (const { id, targetFish } of batch) {
      const ok = await updateTargetFish(id, targetFish);
      if (ok) {
        successCount++;
      } else {
        errorCount++;
      }
    }

    const progress = Math.min(i + BATCH_SIZE, updates.length);
    log(`Progress: ${progress}/${updates.length} (${successCount} ok, ${errorCount} errors)`);
  }

  log(`=== Backfill complete: ${successCount} updated, ${errorCount} errors ===`);
}

main().catch(err => {
  logError(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
