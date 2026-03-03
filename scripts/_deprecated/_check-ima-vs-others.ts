import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Get ima products
  const { data: imaData } = await sb
    .from('lures')
    .select('slug, name, description, manufacturer_slug')
    .eq('manufacturer_slug', 'ima');

  // Deduplicate by slug
  const imaUnique = [...new Map(imaData!.map(r => [r.slug, r])).values()];
  
  console.log('=== ima ===');
  console.log(`Total unique slugs: ${imaUnique.length}`);
  const withDesc = imaUnique.filter(r => r.description);
  console.log(`With description: ${withDesc.length}`);
  const avgLen = withDesc.reduce((sum, r) => sum + r.description.length, 0) / withDesc.length;
  console.log(`Average description length: ${Math.round(avgLen)} chars`);
  
  // Sample 3 ima descriptions
  console.log('\n--- ima sample descriptions ---');
  for (const item of withDesc.slice(0, 3)) {
    console.log(`${item.slug}: [${item.description.length} chars] ${item.description.substring(0, 200)}`);
  }
  
  // Compare with a few non-indexed makers
  for (const maker of ['megabass', 'osp', 'shimano', 'blueblue']) {
    const { data: makerData } = await sb
      .from('lures')
      .select('slug, name, description, manufacturer_slug')
      .eq('manufacturer_slug', maker);
    
    const unique = [...new Map(makerData!.map(r => [r.slug, r])).values()];
    const withD = unique.filter(r => r.description);
    const avg = withD.length > 0 ? withD.reduce((sum, r) => sum + r.description.length, 0) / withD.length : 0;
    
    console.log(`\n=== ${maker} ===`);
    console.log(`Total unique slugs: ${unique.length}`);
    console.log(`With description: ${withD.length}`);
    console.log(`Average description length: ${Math.round(avg)} chars`);
    
    // Sample
    if (withD.length > 0) {
      console.log(`Sample: ${withD[0].slug}: [${withD[0].description.length} chars] ${withD[0].description.substring(0, 200)}`);
    }
  }
}

main().catch(console.error);
