import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // Read merged results
  const all = JSON.parse(readFileSync('/tmp/reclassify-merged-all.json', 'utf-8'));

  // Separate changes and deletes
  const typeChanges = all.filter((r: any) => r.changed && r.new_type !== 'DELETE');
  const deletes = all.filter((r: any) => r.new_type === 'DELETE');

  console.log(`Type changes to apply: ${typeChanges.length}`);
  console.log(`Products to delete: ${deletes.length}`);

  // Apply type changes in batches
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < typeChanges.length; i++) {
    const item = typeChanges[i];
    const { error } = await sb
      .from('lures')
      .update({ type: item.new_type })
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug);

    if (error) {
      console.error(`Error updating ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      errorCount++;
    } else {
      successCount++;
    }

    // Progress log every 100
    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${typeChanges.length} (${successCount} ok, ${errorCount} errors)`);
    }
  }

  console.log(`\nType updates complete: ${successCount} success, ${errorCount} errors`);

  // Delete non-lure products
  let deleteSuccess = 0;
  let deleteError = 0;

  for (const item of deletes) {
    const { error, count } = await sb
      .from('lures')
      .delete()
      .eq('slug', item.slug)
      .eq('manufacturer_slug', item.manufacturer_slug);

    if (error) {
      console.error(`Error deleting ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
      deleteError++;
    } else {
      deleteSuccess++;
      console.log(`  Deleted: [${item.manufacturer_slug}] ${item.slug}`);
    }
  }

  console.log(`\nDeletes complete: ${deleteSuccess} success, ${deleteError} errors`);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Type changes: ${successCount}/${typeChanges.length}`);
  console.log(`Deletions: ${deleteSuccess}/${deletes.length}`);
  console.log(`Total errors: ${errorCount + deleteError}`);
}

main();
