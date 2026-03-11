import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  // Fetch all lures with proper pagination
  const allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('lures')
      .select('id,slug,name,manufacturer_slug,description,type,target_fish,images,price,weight,color_name')
      .range(from, from + pageSize - 1)
      .order('id', { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    allData.push(...data);
    console.log(`  Fetched ${allData.length} rows...`);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`Total rows: ${allData.length}`);

  // Unique products (by slug + manufacturer_slug)
  const uniqueMap = new Map<string, any>();
  for (const row of allData) {
    const key = `${row.manufacturer_slug}/${row.slug}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, row);
    }
  }
  console.log(`Unique products: ${uniqueMap.size}`);

  // 1. Empty descriptions
  const emptyDesc = [...uniqueMap.values()].filter(r => !r.description || r.description.trim() === '');
  const emptyByMaker = new Map<string, number>();
  for (const r of emptyDesc) {
    emptyByMaker.set(r.manufacturer_slug, (emptyByMaker.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log(`\n=== EMPTY DESCRIPTIONS: ${emptyDesc.length} products ===`);
  const sortedEmptyMakers = [...emptyByMaker.entries()].sort((a, b) => b[1] - a[1]);
  for (const [maker, count] of sortedEmptyMakers) {
    console.log(`  ${maker}: ${count}`);
  }

  // 2. Missing target_fish
  const noFish = [...uniqueMap.values()].filter(r => !r.target_fish || (Array.isArray(r.target_fish) ? r.target_fish.length === 0 : !r.target_fish));
  const noFishByMaker = new Map<string, number>();
  for (const r of noFish) {
    noFishByMaker.set(r.manufacturer_slug, (noFishByMaker.get(r.manufacturer_slug) || 0) + 1);
  }
  console.log(`\n=== MISSING TARGET_FISH: ${noFish.length} products ===`);
  const sortedNoFishMakers = [...noFishByMaker.entries()].sort((a, b) => b[1] - a[1]);
  for (const [maker, count] of sortedNoFishMakers.slice(0, 20)) {
    console.log(`  ${maker}: ${count}`);
  }

  // 3. Missing type
  const noType = [...uniqueMap.values()].filter(r => !r.type || r.type.trim() === '');
  console.log(`\n=== MISSING TYPE: ${noType.length} products ===`);

  // 4. No images
  const noImage = [...uniqueMap.values()].filter(r => !r.images || (Array.isArray(r.images) ? r.images.length === 0 : !r.images));
  console.log(`\n=== NO IMAGE: ${noImage.length} products ===`);

  // 5. No price
  const noPrice = [...uniqueMap.values()].filter(r => !r.price);
  console.log(`\n=== NO PRICE: ${noPrice.length} products ===`);

  // 6. Manufacturer stats
  const makerStats = new Map<string, {total: number, withDesc: number, withFish: number, withType: number}>();
  for (const [, r] of uniqueMap) {
    const stats = makerStats.get(r.manufacturer_slug) || {total: 0, withDesc: 0, withFish: 0, withType: 0};
    stats.total++;
    if (r.description && r.description.trim()) stats.withDesc++;
    if (r.target_fish && (Array.isArray(r.target_fish) ? r.target_fish.length > 0 : !!r.target_fish)) stats.withFish++;
    if (r.type && r.type.trim()) stats.withType++;
    makerStats.set(r.manufacturer_slug, stats);
  }
  console.log(`\n=== MAKER COMPLETENESS (sorted by empty desc) ===`);
  const sortedMakers = [...makerStats.entries()].sort((a, b) => {
    const aEmpty = a[1].total - a[1].withDesc;
    const bEmpty = b[1].total - b[1].withDesc;
    return bEmpty - aEmpty;
  });
  for (const [maker, stats] of sortedMakers.slice(0, 30)) {
    const emptyD = stats.total - stats.withDesc;
    const emptyF = stats.total - stats.withFish;
    if (emptyD > 0 || emptyF > 0) {
      console.log(`  ${maker}: ${stats.total} total | desc: ${emptyD} empty | fish: ${emptyF} empty | type: ${stats.total - stats.withType} empty`);
    }
  }

  // 7. Type distribution
  const typeDist = new Map<string, number>();
  for (const [, r] of uniqueMap) {
    const t = r.type || '(empty)';
    typeDist.set(t, (typeDist.get(t) || 0) + 1);
  }
  console.log(`\n=== TYPE DISTRIBUTION (top 20) ===`);
  const sortedTypes = [...typeDist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes.slice(0, 20)) {
    console.log(`  ${type}: ${count}`);
  }

  // 8. target_fish distribution
  const fishDist = new Map<string, number>();
  for (const [, r] of uniqueMap) {
    const fishArr = Array.isArray(r.target_fish) ? r.target_fish : (r.target_fish ? [r.target_fish] : []);
    if (fishArr.length === 0) {
      fishDist.set('(empty)', (fishDist.get('(empty)') || 0) + 1);
    } else {
      for (const f of fishArr) {
        fishDist.set(f, (fishDist.get(f) || 0) + 1);
      }
    }
  }
  console.log(`\n=== TARGET_FISH DISTRIBUTION (top 20) ===`);
  const sortedFish = [...fishDist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [fish, count] of sortedFish.slice(0, 20)) {
    console.log(`  ${fish}: ${count}`);
  }
}

main().catch(console.error);
