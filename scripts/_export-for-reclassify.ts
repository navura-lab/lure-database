import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.PUBLIC_SUPABASE_ANON_KEY as string
);

async function main() {
  // Fetch all unique products (deduplicated by slug + manufacturer_slug)
  const allData: any[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('type, name, manufacturer_slug, slug, description, source_url')
      .range(from, from + batchSize - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  console.log(`Total rows fetched: ${allData.length}`);

  // Deduplicate by slug + manufacturer_slug (take first occurrence)
  const uniqueMap = new Map<string, any>();
  for (const r of allData) {
    const key = `${r.manufacturer_slug}:::${r.slug}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        slug: r.slug,
        name: r.name,
        manufacturer_slug: r.manufacturer_slug,
        current_type: r.type,
        description: r.description ? r.description.substring(0, 300) : '',
        source_url: r.source_url || '',
      });
    }
  }

  const products = [...uniqueMap.values()];
  console.log(`Unique products: ${products.length}`);

  // Write to file
  writeFileSync('/tmp/all-products-for-reclassify.json', JSON.stringify(products, null, 2));
  console.log(`Written to /tmp/all-products-for-reclassify.json`);

  // Also create batches of 50 for parallel processing
  const batchSz = 50;
  let batchNum = 0;
  for (let i = 0; i < products.length; i += batchSz) {
    const batch = products.slice(i, i + batchSz);
    writeFileSync(`/tmp/reclassify-batch-${String(batchNum).padStart(3, '0')}.json`, JSON.stringify(batch));
    batchNum++;
  }
  console.log(`Created ${batchNum} batches of up to ${batchSz} products`);
}

main();
