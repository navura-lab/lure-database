import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { scrapeBaitBreathPage } from './scrapers/baitbreath.js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);
  
  const {data: existing} = await sb.from('lures').select('slug,name,source_url').eq('manufacturer_slug', 'baitbreath');
  if (!existing) { console.log('No data'); return; }
  
  const uniqueProducts = [...new Map(existing.map(r => [r.slug, r])).values()];
  console.log(`Found ${uniqueProducts.length} unique products\n`);
  
  let updated = 0, errors = 0;
  
  for (const product of uniqueProducts) {
    if (!product.source_url) { console.log(`[SKIP] ${product.slug} - no source_url`); errors++; continue; }
    
    try {
      console.log(`[SCRAPE] ${product.slug}`);
      const result = await scrapeBaitBreathPage(product.source_url);
      
      console.log(`  ${result.name} | Colors: ${result.colors.length} | Image: ${result.mainImage ? 'YES' : 'NO'}`);
      
      if (DRY_RUN) { updated++; continue; }
      
      // Delete existing rows
      await sb.from('lures').delete().eq('manufacturer_slug', 'baitbreath').eq('slug', product.slug);
      
      // Insert new rows
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
      
      const {error} = await sb.from('lures').insert(rows);
      if (error) { console.log(`  [ERROR] ${error.message}`); errors++; continue; }
      
      console.log(`  [OK] ${rows.length} rows`);
      updated++;
      await new Promise(r => setTimeout(r, 500));
    } catch (e: any) {
      console.log(`  [ERROR] ${e.message}`);
      errors++;
    }
  }
  
  console.log(`\nUpdated: ${updated}, Errors: ${errors}`);
}
main().catch(console.error);
