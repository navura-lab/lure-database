import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // Find all "EC shop" rows
  const { data: ecRows, error: findError } = await sb
    .from('lures')
    .select('id, slug, color_name')
    .eq('manufacturer_slug', 'viva')
    .ilike('color_name', '%EC shop%');

  if (findError) {
    console.error('Find error:', findError);
    return;
  }

  console.log(`Found ${ecRows?.length || 0} "EC shop" rows:`);
  for (const r of ecRows || []) {
    console.log(`  ${r.slug} / ${r.color_name} (id: ${r.id})`);
  }

  if (!ecRows || ecRows.length === 0) {
    console.log('No rows to delete');
    return;
  }

  // Delete them
  const ids = ecRows.map(r => r.id);
  const { error: deleteError } = await sb
    .from('lures')
    .delete()
    .in('id', ids);

  if (deleteError) {
    console.error('Delete error:', deleteError);
    return;
  }

  console.log(`\nDeleted ${ids.length} "EC shop" rows successfully`);

  // Verify: check if the affected products still have colors
  const affectedSlugs = [...new Set(ecRows.map(r => r.slug))];
  for (const slug of affectedSlugs) {
    const { data: remaining } = await sb
      .from('lures')
      .select('id, color_name')
      .eq('manufacturer_slug', 'viva')
      .eq('slug', slug);
    console.log(`  ${slug}: ${remaining?.length || 0} rows remaining`);
    if (remaining && remaining.length > 0) {
      remaining.forEach(r => console.log(`    - ${r.color_name}`));
    }
  }
}

main();
