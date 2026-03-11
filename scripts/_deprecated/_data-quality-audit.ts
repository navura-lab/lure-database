// scripts/_data-quality-audit.ts
// Comprehensive data quality audit for the lure database.
//
// Usage:
//   npx tsx scripts/_data-quality-audit.ts

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  // ---- Fetch all rows ----
  console.log('Fetching all rows from lures table...\n');
  type Row = {
    id: string;
    name: string;
    slug: string;
    manufacturer: string;
    manufacturer_slug: string;
    type: string;
    price: number;
    description: string | null;
    images: string[] | null;
    target_fish: string[] | null;
  };

  const allRows: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('id,name,slug,manufacturer,manufacturer_slug,type,price,description,images,target_fish')
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('Supabase error:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allRows.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`Total rows: ${allRows.length}\n`);

  // Unique products (by slug + manufacturer_slug)
  const uniqueProducts = new Map<string, Row[]>();
  for (const row of allRows) {
    const key = `${row.manufacturer_slug}/${row.slug}`;
    if (!uniqueProducts.has(key)) uniqueProducts.set(key, []);
    uniqueProducts.get(key)!.push(row);
  }
  console.log(`Unique products (slug + manufacturer): ${uniqueProducts.size}\n`);
  console.log('='.repeat(70));

  // ---- 1. Description > 250 chars (unrewritten) ----
  console.log('\n[1] Products with description > 250 chars (unrewritten)\n');
  const longDescProducts = new Map<string, { name: string; manufacturer_slug: string; charCount: number }>();
  for (const [key, rows] of uniqueProducts) {
    const rep = rows[0];
    if (rep.description && rep.description.length > 250) {
      longDescProducts.set(key, {
        name: rep.name,
        manufacturer_slug: rep.manufacturer_slug,
        charCount: rep.description.length,
      });
    }
  }
  if (longDescProducts.size === 0) {
    console.log('  None found. All descriptions are 250 chars or fewer.');
  } else {
    // Group by manufacturer
    const byMaker = new Map<string, { key: string; name: string; charCount: number }[]>();
    for (const [key, info] of longDescProducts) {
      const list = byMaker.get(info.manufacturer_slug) || [];
      list.push({ key, name: info.name, charCount: info.charCount });
      byMaker.set(info.manufacturer_slug, list);
    }
    const sortedMakers = [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  Total: ${longDescProducts.size} products\n`);
    for (const [maker, products] of sortedMakers) {
      console.log(`  ${maker} (${products.length}):`);
      for (const p of products.slice(0, 5)) {
        console.log(`    - ${p.name} (${p.charCount} chars)`);
      }
      if (products.length > 5) console.log(`    ... and ${products.length - 5} more`);
    }
  }

  console.log('\n' + '-'.repeat(70));

  // ---- 2. Empty/null description ----
  console.log('\n[2] Products with empty or null description\n');
  const noDescProducts = new Map<string, { name: string; manufacturer_slug: string }>();
  for (const [key, rows] of uniqueProducts) {
    const rep = rows[0];
    if (!rep.description || rep.description.trim() === '') {
      noDescProducts.set(key, {
        name: rep.name,
        manufacturer_slug: rep.manufacturer_slug,
      });
    }
  }
  if (noDescProducts.size === 0) {
    console.log('  None found. All products have descriptions.');
  } else {
    const byMaker = new Map<string, { key: string; name: string }[]>();
    for (const [key, info] of noDescProducts) {
      const list = byMaker.get(info.manufacturer_slug) || [];
      list.push({ key, name: info.name });
      byMaker.set(info.manufacturer_slug, list);
    }
    const sortedMakers = [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  Total: ${noDescProducts.size} products\n`);
    for (const [maker, products] of sortedMakers) {
      console.log(`  ${maker} (${products.length}):`);
      for (const p of products.slice(0, 5)) {
        console.log(`    - ${p.name}`);
      }
      if (products.length > 5) console.log(`    ... and ${products.length - 5} more`);
    }
  }

  console.log('\n' + '-'.repeat(70));

  // ---- 3. No representative image ----
  console.log('\n[3] Products with no image (all rows have null/empty images)\n');
  const noImageProducts = new Map<string, { name: string; manufacturer_slug: string }>();
  for (const [key, rows] of uniqueProducts) {
    const hasImage = rows.some(r => r.images && r.images.length > 0 && r.images.some(img => img && img.length > 0));
    if (!hasImage) {
      noImageProducts.set(key, {
        name: rows[0].name,
        manufacturer_slug: rows[0].manufacturer_slug,
      });
    }
  }
  if (noImageProducts.size === 0) {
    console.log('  None found. All products have at least one image.');
  } else {
    const byMaker = new Map<string, { key: string; name: string }[]>();
    for (const [key, info] of noImageProducts) {
      const list = byMaker.get(info.manufacturer_slug) || [];
      list.push({ key, name: info.name });
      byMaker.set(info.manufacturer_slug, list);
    }
    const sortedMakers = [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  Total: ${noImageProducts.size} products\n`);
    for (const [maker, products] of sortedMakers) {
      console.log(`  ${maker} (${products.length}):`);
      for (const p of products.slice(0, 5)) {
        console.log(`    - ${p.name}`);
      }
      if (products.length > 5) console.log(`    ... and ${products.length - 5} more`);
    }
  }

  console.log('\n' + '-'.repeat(70));

  // ---- 4. Price = 0 or null ----
  console.log('\n[4] Products where ALL rows have price = 0 or null\n');
  const noPriceProducts = new Map<string, { name: string; manufacturer_slug: string }>();
  for (const [key, rows] of uniqueProducts) {
    const hasValidPrice = rows.some(r => r.price != null && r.price > 0);
    if (!hasValidPrice) {
      noPriceProducts.set(key, {
        name: rows[0].name,
        manufacturer_slug: rows[0].manufacturer_slug,
      });
    }
  }
  if (noPriceProducts.size === 0) {
    console.log('  None found. All products have at least one row with price > 0.');
  } else {
    const byMaker = new Map<string, { key: string; name: string }[]>();
    for (const [key, info] of noPriceProducts) {
      const list = byMaker.get(info.manufacturer_slug) || [];
      list.push({ key, name: info.name });
      byMaker.set(info.manufacturer_slug, list);
    }
    const sortedMakers = [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  Total: ${noPriceProducts.size} products\n`);
    for (const [maker, products] of sortedMakers) {
      console.log(`  ${maker} (${products.length}):`);
      for (const p of products.slice(0, 5)) {
        console.log(`    - ${p.name}`);
      }
      if (products.length > 5) console.log(`    ... and ${products.length - 5} more`);
    }
  }

  console.log('\n' + '-'.repeat(70));

  // ---- 5. Empty type field ----
  console.log('\n[5] Products with empty or null type\n');
  const noTypeProducts = new Map<string, { name: string; manufacturer_slug: string }>();
  for (const [key, rows] of uniqueProducts) {
    const rep = rows[0];
    if (!rep.type || rep.type.trim() === '') {
      noTypeProducts.set(key, {
        name: rep.name,
        manufacturer_slug: rep.manufacturer_slug,
      });
    }
  }
  if (noTypeProducts.size === 0) {
    console.log('  None found. All products have a type.');
  } else {
    const byMaker = new Map<string, { key: string; name: string }[]>();
    for (const [key, info] of noTypeProducts) {
      const list = byMaker.get(info.manufacturer_slug) || [];
      list.push({ key, name: info.name });
      byMaker.set(info.manufacturer_slug, list);
    }
    const sortedMakers = [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  Total: ${noTypeProducts.size} products\n`);
    for (const [maker, products] of sortedMakers) {
      console.log(`  ${maker} (${products.length}):`);
      for (const p of products.slice(0, 5)) {
        console.log(`    - ${p.name}`);
      }
      if (products.length > 5) console.log(`    ... and ${products.length - 5} more`);
    }
  }

  console.log('\n' + '-'.repeat(70));

  // ---- 6. Empty target_fish ----
  console.log('\n[6] Products with empty or null target_fish\n');
  const noTargetFishProducts = new Map<string, { name: string; manufacturer_slug: string }>();
  for (const [key, rows] of uniqueProducts) {
    // Check all rows for this product; if ANY row has target_fish, it's ok
    const hasTargetFish = rows.some(r => r.target_fish && r.target_fish.length > 0);
    if (!hasTargetFish) {
      noTargetFishProducts.set(key, {
        name: rows[0].name,
        manufacturer_slug: rows[0].manufacturer_slug,
      });
    }
  }
  if (noTargetFishProducts.size === 0) {
    console.log('  None found. All products have target_fish.');
  } else {
    const byMaker = new Map<string, { key: string; name: string }[]>();
    for (const [key, info] of noTargetFishProducts) {
      const list = byMaker.get(info.manufacturer_slug) || [];
      list.push({ key, name: info.name });
      byMaker.set(info.manufacturer_slug, list);
    }
    const sortedMakers = [...byMaker.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`  Total: ${noTargetFishProducts.size} products\n`);
    for (const [maker, products] of sortedMakers) {
      console.log(`  ${maker} (${products.length}):`);
      for (const p of products.slice(0, 5)) {
        console.log(`    - ${p.name}`);
      }
      if (products.length > 5) console.log(`    ... and ${products.length - 5} more`);
    }
  }

  console.log('\n' + '-'.repeat(70));

  // ---- 7. Duplicate slugs within same manufacturer ----
  // A "duplicate slug" means two DIFFERENT product names share the same slug
  // within the same manufacturer_slug. (Same slug + same name is normal grouping.)
  console.log('\n[7] Duplicate slugs within same manufacturer (different product names)\n');
  const slugsByMaker = new Map<string, Map<string, Set<string>>>();
  for (const row of allRows) {
    if (!row.manufacturer_slug || !row.slug) continue;
    if (!slugsByMaker.has(row.manufacturer_slug)) {
      slugsByMaker.set(row.manufacturer_slug, new Map());
    }
    const slugMap = slugsByMaker.get(row.manufacturer_slug)!;
    if (!slugMap.has(row.slug)) {
      slugMap.set(row.slug, new Set());
    }
    slugMap.get(row.slug)!.add(row.name);
  }

  const duplicates: { maker: string; slug: string; names: string[] }[] = [];
  for (const [maker, slugMap] of slugsByMaker) {
    for (const [slug, names] of slugMap) {
      if (names.size > 1) {
        duplicates.push({ maker, slug, names: [...names] });
      }
    }
  }

  if (duplicates.length === 0) {
    console.log('  None found. All slugs are unique within their manufacturer.');
  } else {
    console.log(`  Total: ${duplicates.length} duplicate slug groups\n`);
    for (const dup of duplicates) {
      console.log(`  ${dup.maker} / ${dup.slug}:`);
      for (const name of dup.names) {
        console.log(`    - "${name}"`);
      }
    }
  }

  // ---- Summary ----
  console.log('\n' + '='.repeat(70));
  console.log('\n=== DATA QUALITY AUDIT SUMMARY ===\n');
  console.log(`  Total rows:                        ${allRows.length}`);
  console.log(`  Unique products:                   ${uniqueProducts.size}`);
  console.log();
  console.log(`  [1] Description > 250 chars:       ${longDescProducts.size}`);
  console.log(`  [2] Empty/null description:         ${noDescProducts.size}`);
  console.log(`  [3] No images:                     ${noImageProducts.size}`);
  console.log(`  [4] Price = 0 or null:             ${noPriceProducts.size}`);
  console.log(`  [5] Empty type:                    ${noTypeProducts.size}`);
  console.log(`  [6] Empty target_fish:             ${noTargetFishProducts.size}`);
  console.log(`  [7] Duplicate slugs (same maker):  ${duplicates.length}`);
  console.log();

  const totalIssues =
    longDescProducts.size +
    noDescProducts.size +
    noImageProducts.size +
    noPriceProducts.size +
    noTypeProducts.size +
    noTargetFishProducts.size +
    duplicates.length;

  if (totalIssues === 0) {
    console.log('All checks passed. No data quality issues found.');
  } else {
    console.log(`Total issues: ${totalIssues} products with at least one issue.`);
  }
}

main().catch(console.error);
