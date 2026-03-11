// scripts/_fix-longin-duplicates.ts
// Fix LONGIN duplicate slug groups where products exist with both bare names
// (e.g., "FRANKY") and prefixed names ("LONGIN PRODUCTS FRANKY").
// Updates the longer-named rows to use the canonical (shorter) name.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY as string
  );

  // Fetch all longin products
  const { data, error } = await sb
    .from('lures')
    .select('id, name, slug, color_name, weight')
    .eq('manufacturer_slug', 'longin')
    .order('slug')
    .order('name');

  if (error) { console.error('Fetch error:', error); process.exit(1); }
  if (!data || data.length === 0) { console.log('No longin products found'); return; }

  console.log(`Total longin rows fetched: ${data.length}`);

  // Group by slug
  const bySlug = new Map<string, typeof data>();
  for (const row of data) {
    const existing = bySlug.get(row.slug) || [];
    existing.push(row);
    bySlug.set(row.slug, existing);
  }

  console.log(`Total unique slugs: ${bySlug.size}`);

  // Find duplicate groups and determine canonical names
  const PREFIX = 'LONGIN PRODUCTS ';
  const fixes: Array<{
    slug: string;
    canonicalName: string;
    badName: string;
    rowIds: string[];
  }> = [];

  for (const [slug, rows] of bySlug) {
    const names = [...new Set(rows.map(r => r.name))];
    if (names.length <= 1) continue;

    // Determine canonical name: the one WITHOUT the "LONGIN PRODUCTS " prefix
    const withPrefix = names.filter(n => n.startsWith(PREFIX));
    const withoutPrefix = names.filter(n => !n.startsWith(PREFIX));

    if (withPrefix.length === 0 || withoutPrefix.length === 0) {
      // Unexpected pattern - skip but warn
      console.warn(`WARNING: Slug "${slug}" has multiple names but no clear prefix pattern: ${JSON.stringify(names)}`);
      continue;
    }

    if (withoutPrefix.length > 1) {
      console.warn(`WARNING: Slug "${slug}" has multiple non-prefixed names: ${JSON.stringify(withoutPrefix)}`);
      continue;
    }

    const canonicalName = withoutPrefix[0];

    for (const prefixedName of withPrefix) {
      const affectedRows = rows.filter(r => r.name === prefixedName);
      fixes.push({
        slug,
        canonicalName,
        badName: prefixedName,
        rowIds: affectedRows.map(r => r.id),
      });
    }
  }

  // === DRY RUN ===
  console.log('\n========================================');
  console.log('  DRY RUN - Proposed Changes');
  console.log('========================================\n');

  let totalRows = 0;
  for (const fix of fixes) {
    console.log(`Slug: ${fix.slug}`);
    console.log(`  "${fix.badName}" -> "${fix.canonicalName}"`);
    console.log(`  Rows to update: ${fix.rowIds.length}`);
    totalRows += fix.rowIds.length;
  }

  console.log(`\nTotal duplicate groups: ${fixes.length}`);
  console.log(`Total rows to update: ${totalRows}`);

  // === APPLY CHANGES ===
  console.log('\n========================================');
  console.log('  APPLYING CHANGES');
  console.log('========================================\n');

  let updatedTotal = 0;
  let errorCount = 0;

  for (const fix of fixes) {
    const { error: updateError, count } = await sb
      .from('lures')
      .update({ name: fix.canonicalName })
      .in('id', fix.rowIds);

    if (updateError) {
      console.error(`ERROR updating slug "${fix.slug}": ${updateError.message}`);
      errorCount++;
    } else {
      const updated = count ?? fix.rowIds.length;
      console.log(`OK: slug="${fix.slug}" | "${fix.badName}" -> "${fix.canonicalName}" | ${updated} rows`);
      updatedTotal += updated;
    }
  }

  // === SUMMARY ===
  console.log('\n========================================');
  console.log('  SUMMARY');
  console.log('========================================');
  console.log(`Duplicate groups fixed: ${fixes.length - errorCount}`);
  console.log(`Total rows updated: ${updatedTotal}`);
  console.log(`Errors: ${errorCount}`);

  // Verify: re-fetch and check for remaining duplicates
  console.log('\n--- Verification ---');
  const { data: verifyData, error: verifyError } = await sb
    .from('lures')
    .select('name, slug')
    .eq('manufacturer_slug', 'longin')
    .order('slug');

  if (verifyError) {
    console.error('Verification fetch error:', verifyError);
    return;
  }

  const verifyBySlug = new Map<string, Set<string>>();
  for (const row of verifyData!) {
    const existing = verifyBySlug.get(row.slug) || new Set();
    existing.add(row.name);
    verifyBySlug.set(row.slug, existing);
  }

  let remaining = 0;
  for (const [slug, names] of verifyBySlug) {
    if (names.size > 1) {
      remaining++;
      console.log(`STILL DUPLICATE: slug="${slug}" names=${JSON.stringify([...names])}`);
    }
  }

  if (remaining === 0) {
    console.log('All duplicates resolved. No remaining name conflicts.');
  } else {
    console.log(`Remaining duplicate groups: ${remaining}`);
  }
}

main().catch(console.error);
