import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  const { data, error } = await sb
    .from('lures')
    .select('slug, color_name, images')
    .eq('manufacturer_slug', 'viva')
    .order('slug');

  if (error || !data) {
    console.error('Error:', error);
    return;
  }

  // Get all unique image URLs
  const imageUrls: { slug: string; colorName: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const r of data) {
    if (r.images && r.images.length > 0) {
      for (const img of r.images) {
        if (!seen.has(img)) {
          seen.add(img);
          imageUrls.push({ slug: r.slug, colorName: r.color_name, url: img });
        }
      }
    }
  }

  console.log(`Total unique images to check: ${imageUrls.length}`);

  let suspiciousCount = 0;
  let missingCount = 0;
  for (const { slug, colorName, url } of imageUrls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) {
        const size = parseInt(res.headers.get('content-length') || '0');
        // Images under 5KB are suspicious (logos, icons, etc.)
        if (size < 5000) {
          suspiciousCount++;
          console.log(`SUSPICIOUS: ${slug} / ${colorName} - ${url} (${size} bytes)`);
        }
      } else {
        missingCount++;
        console.log(`MISSING: ${slug} / ${colorName} - ${url} (HTTP ${res.status})`);
      }
    } catch (e: any) {
      console.log(`ERROR: ${slug} / ${colorName} - ${e.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total images checked: ${imageUrls.length}`);
  console.log(`Suspicious (< 5KB): ${suspiciousCount}`);
  console.log(`Missing (HTTP error): ${missingCount}`);
}

main();
