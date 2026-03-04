// Re-scrape all ATTIC products and update Supabase (images + colors)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { scrapeAtticPage } from './scrapers/attic.js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const R2_BASE = 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev';

const DRY_RUN = process.argv.includes('--dry-run');

async function processImage(url: string, slug: string, colorIndex: number): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.log(`  [WARN] Image fetch failed: ${res.status} ${url}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    
    // Upload via pipeline's R2 logic - but we'll just use the source URL directly
    // since re-uploading to R2 requires the R2 credentials
    // For now, return the source URL and let the pipeline handle R2 upload on next run
    return url;
  } catch (e: any) {
    console.log(`  [WARN] Image error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);
  
  // Get all unique ATTIC products
  const {data: existing} = await sb.from('lures').select('slug,name,source_url').eq('manufacturer_slug', 'attic');
  if (!existing) { console.log('No ATTIC data'); return; }
  
  const uniqueProducts = [...new Map(existing.map(r => [r.slug, r])).values()];
  console.log(`Found ${uniqueProducts.length} unique ATTIC products\n`);
  
  let updated = 0;
  let errors = 0;
  
  for (const product of uniqueProducts) {
    if (!product.source_url) { console.log(`[SKIP] ${product.slug} - no source_url`); continue; }
    
    try {
      console.log(`[SCRAPE] ${product.slug} - ${product.source_url}`);
      const result = await scrapeAtticPage(product.source_url);
      
      console.log(`  Colors: ${result.colors.length}, Image: ${result.mainImage ? 'YES' : 'NO'}`);
      result.colors.slice(0, 3).forEach(c => console.log(`    ${c.name}`));
      if (result.colors.length > 3) console.log(`    ... +${result.colors.length - 3} more`);
      
      if (DRY_RUN) { updated++; continue; }
      
      // Delete existing rows for this slug
      const {error: delError} = await sb
        .from('lures')
        .delete()
        .eq('manufacturer_slug', 'attic')
        .eq('slug', product.slug);
      
      if (delError) { console.log(`  [ERROR] Delete failed: ${delError.message}`); errors++; continue; }
      
      // Insert new rows (one per color × weight combo)
      const weights = result.weights.length > 0 ? result.weights : [0];
      const colors = result.colors.length > 0 ? result.colors : [{ name: 'デフォルト', imageUrl: result.mainImage }];
      
      const rows: any[] = [];
      for (const color of colors) {
        for (const weight of weights) {
          rows.push({
            name: result.name,
            slug: result.slug,
            manufacturer: result.manufacturer,
            manufacturer_slug: result.manufacturer_slug,
            type: result.type,
            target_fish: result.target_fish,
            description: result.description,
            price: result.price,
            color_name: color.name,
            images: color.imageUrl ? [color.imageUrl] : null,
            weight: weight || null,
            length: result.length,
            source_url: result.sourceUrl,
            name_kana: result.name_kana || '',
          });
        }
      }
      
      const {error: insError} = await sb.from('lures').insert(rows);
      if (insError) { console.log(`  [ERROR] Insert failed: ${insError.message}`); errors++; continue; }
      
      console.log(`  [OK] Inserted ${rows.length} rows`);
      updated++;
      
      // Small delay
      await new Promise(r => setTimeout(r, 300));
    } catch (e: any) {
      console.log(`  [ERROR] ${e.message}`);
      errors++;
    }
  }
  
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Updated: ${updated}, Errors: ${errors}`);
}

main().catch(console.error);
