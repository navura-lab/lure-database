// scripts/_fix-viva-names.ts
// Re-scrape all VIVA products to get correct product names
// (The original scraper was extracting marketing copy from <h1> instead of product names from <h3>)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { scrapeVivaPage } from './scrapers/viva.js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // Get all unique VIVA products with their source URLs
  const { data, error } = await sb
    .from('lures')
    .select('name, slug, source_url')
    .eq('manufacturer_slug', 'viva')
    .order('slug');

  if (error) throw error;
  if (!data || data.length === 0) {
    console.log('No VIVA products found');
    return;
  }

  // Deduplicate by slug
  const unique = [...new Map(data.map(r => [r.slug, r])).values()];
  console.log(`VIVA unique products: ${unique.length}`);

  // Filter to those with source URLs
  const withUrl = unique.filter(r => r.source_url);
  console.log(`Products with source_url: ${withUrl.length}`);
  const withoutUrl = unique.filter(r => !r.source_url);
  if (withoutUrl.length > 0) {
    console.log(`\nProducts WITHOUT source_url (skipping):`);
    for (const p of withoutUrl) console.log(`  ${p.slug}: ${p.name}`);
  }

  // Re-scrape each product
  const results: Array<{ slug: string; old_name: string; new_name: string; success: boolean; error?: string }> = [];

  for (let i = 0; i < withUrl.length; i++) {
    const product = withUrl[i];
    console.log(`\n[${i + 1}/${withUrl.length}] Scraping: ${product.source_url}`);

    try {
      const scraped = await scrapeVivaPage(product.source_url);
      const newName = scraped.name;

      if (newName === 'Unknown' || newName === product.name) {
        console.log(`  → Name unchanged: ${product.name}`);
        results.push({ slug: product.slug, old_name: product.name, new_name: newName, success: true });
        continue;
      }

      console.log(`  → Name change: "${product.name}" → "${newName}"`);

      // Update ALL rows for this slug
      const { error: updateError, count } = await sb
        .from('lures')
        .update({ name: newName })
        .eq('slug', product.slug)
        .eq('manufacturer_slug', 'viva');

      if (updateError) {
        console.error(`  → Update error: ${updateError.message}`);
        results.push({ slug: product.slug, old_name: product.name, new_name: newName, success: false, error: updateError.message });
      } else {
        console.log(`  → Updated ${count ?? '?'} rows`);
        results.push({ slug: product.slug, old_name: product.name, new_name: newName, success: true });
      }
    } catch (err: any) {
      console.error(`  → Scrape error: ${err.message}`);
      results.push({ slug: product.slug, old_name: product.name, new_name: '', success: false, error: err.message });
    }

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('\n\n=== SUMMARY ===');
  const changed = results.filter(r => r.success && r.old_name !== r.new_name && r.new_name !== 'Unknown');
  const unchanged = results.filter(r => r.success && (r.old_name === r.new_name || r.new_name === 'Unknown'));
  const errors = results.filter(r => !r.success);

  console.log(`Changed: ${changed.length}`);
  console.log(`Unchanged: ${unchanged.length}`);
  console.log(`Errors: ${errors.length}`);

  if (changed.length > 0) {
    console.log('\n--- Name Changes ---');
    for (const r of changed) {
      console.log(`  [${r.slug}] "${r.old_name}" → "${r.new_name}"`);
    }
  }

  if (errors.length > 0) {
    console.log('\n--- Errors ---');
    for (const r of errors) {
      console.log(`  [${r.slug}] ${r.error}`);
    }
  }
}

main().catch(console.error);
