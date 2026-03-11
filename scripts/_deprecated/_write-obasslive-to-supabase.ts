// scripts/_write-obasslive-to-supabase.ts
// Update OBASSLIVE product descriptions in Supabase

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import rewritten from './_obasslive-rewritten.json' assert { type: 'json' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log(`Processing ${rewritten.length} OBASSLIVE products...`);
  let updated = 0;
  let errors = 0;

  for (const item of rewritten) {
    // Fetch all rows matching this slug + manufacturer to verify they exist
    const { data: rows, error: fetchErr } = await supabase
      .from('lures')
      .select('slug, manufacturer_slug, description')
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug);

    if (fetchErr) {
      console.error(`[ERROR] Fetch failed for ${item.slug}: ${fetchErr.message}`);
      errors++;
      continue;
    }

    if (!rows || rows.length === 0) {
      console.warn(`[WARN] No rows found for slug=${item.slug} manufacturer=${item.manufacturer_slug}`);
      continue;
    }

    // Update all rows for this slug (multiple rows = multiple colors/weights)
    const { error: updateErr, count } = await supabase
      .from('lures')
      .update({ description: item.description })
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug);

    if (updateErr) {
      console.error(`[ERROR] Update failed for ${item.slug}: ${updateErr.message}`);
      errors++;
      continue;
    }

    console.log(`[OK] ${item.slug} (${rows.length} rows) -> ${item.description.length}文字`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);

  // Verify: check how many OBASSLIVE products still have the old generic description
  const { data: remaining } = await supabase
    .from('lures')
    .select('slug, description')
    .eq('manufacturer_slug', 'obasslive')
    .ilike('description', '%ルアーメーカー OBASSLIVE%');

  if (remaining && remaining.length > 0) {
    console.warn(`\n[WARN] ${remaining.length} rows still have the old generic description:`);
    const slugs = [...new Set(remaining.map(r => r.slug))];
    slugs.forEach(s => console.warn(`  - ${s}`));
  } else {
    console.log('\n[OK] No rows left with old generic description.');
  }

  // Final verification: all OBASSLIVE products
  const { data: all } = await supabase
    .from('lures')
    .select('slug, description')
    .eq('manufacturer_slug', 'obasslive');

  if (all) {
    const unique = [...new Map(all.map(r => [r.slug, r])).values()];
    console.log(`\nFinal state (${unique.length} unique slugs):`);
    unique.forEach(r => {
      const len = r.description?.length ?? 0;
      const status = len >= 150 && len <= 250 ? 'OK' : (len < 150 ? 'SHORT' : 'LONG');
      console.log(`  [${status}] ${r.slug}: ${len}文字`);
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
