// scripts/check-pipeline-coverage.ts
// Compares Supabase manufacturers vs SCRAPER_REGISTRY vs discover-products.ts
// to detect pipeline coverage gaps.
//
// Usage:
//   npx tsx scripts/check-pipeline-coverage.ts
//
// Exit code 0 = all covered, 1 = gaps found

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getRegisteredManufacturers } from './scrapers/index.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. Supabase: get all distinct manufacturer_slug values
// ---------------------------------------------------------------------------

async function getSupabaseSlugs(): Promise<Set<string>> {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  const slugs = new Set<string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug')
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Supabase error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.manufacturer_slug) slugs.add(row.manufacturer_slug);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return slugs;
}

// ---------------------------------------------------------------------------
// 2. SCRAPER_REGISTRY slugs (via getRegisteredManufacturers)
// ---------------------------------------------------------------------------

function getRegistrySlugs(): Set<string> {
  return new Set(getRegisteredManufacturers());
}

// ---------------------------------------------------------------------------
// 3. discover-products.ts: extract slugs from MANUFACTURERS array
// ---------------------------------------------------------------------------

function getDiscoverSlugs(): Set<string> {
  const filePath = resolve(__dirname, 'discover-products.ts');
  const source = readFileSync(filePath, 'utf-8');

  // Match all "slug: 'xxx'" entries inside the MANUFACTURERS array
  const slugs = new Set<string>();
  const re = /^\s+slug:\s*'([^']+)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    slugs.add(m[1]);
  }

  return slugs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔍 Pipeline coverage check\n');

  const supabaseSlugs = await getSupabaseSlugs();
  const registrySlugs = getRegistrySlugs();
  const discoverSlugs = getDiscoverSlugs();

  console.log(`  Supabase manufacturers:  ${supabaseSlugs.size}`);
  console.log(`  SCRAPER_REGISTRY:        ${registrySlugs.size}`);
  console.log(`  discover-products.ts:    ${discoverSlugs.size}`);
  console.log();

  let hasGaps = false;

  // A) In Supabase but NOT in SCRAPER_REGISTRY
  const notInRegistry = [...supabaseSlugs].filter(s => !registrySlugs.has(s)).sort();
  if (notInRegistry.length > 0) {
    hasGaps = true;
    console.log(`❌ Supabase にあるが SCRAPER_REGISTRY にない (${notInRegistry.length}社):`);
    notInRegistry.forEach(s => console.log(`   - ${s}`));
    console.log();
  }

  // B) In Supabase but NOT in discover-products.ts
  const notInDiscover = [...supabaseSlugs].filter(s => !discoverSlugs.has(s)).sort();
  if (notInDiscover.length > 0) {
    hasGaps = true;
    console.log(`❌ Supabase にあるが discover-products.ts にない (${notInDiscover.length}社):`);
    notInDiscover.forEach(s => console.log(`   - ${s}`));
    console.log();
  }

  // C) In REGISTRY but NOT in Supabase (unusual but worth noting)
  const registryOnly = [...registrySlugs].filter(s => !supabaseSlugs.has(s)).sort();
  if (registryOnly.length > 0) {
    console.log(`⚠️  SCRAPER_REGISTRY にあるが Supabase にない (${registryOnly.length}社):`);
    registryOnly.forEach(s => console.log(`   - ${s}`));
    console.log();
  }

  // D) In discover but NOT in Supabase
  const discoverOnly = [...discoverSlugs].filter(s => !supabaseSlugs.has(s)).sort();
  if (discoverOnly.length > 0) {
    console.log(`⚠️  discover-products.ts にあるが Supabase にない (${discoverOnly.length}社):`);
    discoverOnly.forEach(s => console.log(`   - ${s}`));
    console.log();
  }

  // E) Registry / Discover mismatch
  const registryNotDiscover = [...registrySlugs].filter(s => !discoverSlugs.has(s)).sort();
  const discoverNotRegistry = [...discoverSlugs].filter(s => !registrySlugs.has(s)).sort();
  if (registryNotDiscover.length > 0) {
    hasGaps = true;
    console.log(`❌ SCRAPER_REGISTRY にあるが discover にない (${registryNotDiscover.length}社):`);
    registryNotDiscover.forEach(s => console.log(`   - ${s}`));
    console.log();
  }
  if (discoverNotRegistry.length > 0) {
    hasGaps = true;
    console.log(`❌ discover にあるが SCRAPER_REGISTRY にない (${discoverNotRegistry.length}社):`);
    discoverNotRegistry.forEach(s => console.log(`   - ${s}`));
    console.log();
  }

  if (!hasGaps) {
    console.log('✅ カバレッジ100% — 全メーカーがパイプライン対応済み');
  }

  process.exit(hasGaps ? 1 : 0);
}

main();
