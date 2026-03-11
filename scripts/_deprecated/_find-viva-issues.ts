import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  const { data, error } = await sb
    .from('lures')
    .select('id, slug, name, color_name, images')
    .eq('manufacturer_slug', 'viva')
    .order('slug');

  if (error || !data) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total VIVA rows: ${data.length}`);

  // Check for suspicious color names
  const suspiciousColorNames = [
    /EC\s*shop/i,
    /AquaWave/i,
    /Viva-?net/i,
    /ビバネット/i,
    /コーモラン/i,
    /CORMORAN/i,
    /TOP$/i,
    /HOME/i,
    /Viva[- ]?core/i,
    /ショップ/i,
    /カート/i,
    /お問い合わせ/i,
    /contact/i,
    /^NEW$/i,
  ];

  let badColorCount = 0;
  const badColorProducts = new Map<string, string[]>();
  
  for (const r of data) {
    const colorName = r.color_name || '';
    for (const pattern of suspiciousColorNames) {
      if (pattern.test(colorName)) {
        badColorCount++;
        if (!badColorProducts.has(r.slug)) badColorProducts.set(r.slug, []);
        badColorProducts.get(r.slug)!.push(colorName);
        break;
      }
    }
  }

  console.log(`\n=== Suspicious color names: ${badColorCount} rows ===`);
  for (const [slug, colors] of badColorProducts) {
    console.log(`  ${slug}: ${colors.join(', ')}`);
  }

  // Check for suspicious image sizes
  console.log(`\n=== Checking image sizes ===`);
  const uniqueImages = new Map<string, { slug: string; colorName: string }>();
  for (const r of data) {
    if (r.images && r.images.length > 0) {
      for (const img of r.images) {
        if (!uniqueImages.has(img)) {
          uniqueImages.set(img, { slug: r.slug, colorName: r.color_name });
        }
      }
    }
  }

  let tinyImageCount = 0;
  const tinyImageProducts = new Map<string, number>();
  
  for (const [url, info] of uniqueImages) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        const size = parseInt(res.headers.get('content-length') || '0');
        if (size < 3000) { // Under 3KB = definitely suspicious
          tinyImageCount++;
          tinyImageProducts.set(info.slug, (tinyImageProducts.get(info.slug) || 0) + 1);
          if (tinyImageCount <= 20) {
            console.log(`  TINY: ${info.slug} / ${info.colorName} - ${size} bytes - ${url}`);
          }
        }
      }
    } catch {}
  }

  console.log(`\n=== Summary ===`);
  console.log(`Bad color names: ${badColorCount} rows in ${badColorProducts.size} products`);
  console.log(`Tiny images (<3KB): ${tinyImageCount} in ${tinyImageProducts.size} products`);
  
  if (tinyImageProducts.size > 0) {
    console.log(`\nProducts with tiny images:`);
    for (const [slug, count] of tinyImageProducts) {
      console.log(`  ${slug}: ${count} tiny images`);
    }
  }

  // Also check for products with very few colors (might be missing data)
  const slugColorCount = new Map<string, number>();
  for (const r of data) {
    slugColorCount.set(r.slug, (slugColorCount.get(r.slug) || 0) + 1);
  }
  
  const fewColors = [...slugColorCount.entries()].filter(([, count]) => count <= 2);
  console.log(`\nProducts with ≤2 colors: ${fewColors.length}`);
  for (const [slug, count] of fewColors) {
    console.log(`  ${slug}: ${count} colors`);
  }
}

main();
