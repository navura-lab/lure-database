import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function main() {
  // Get all VIVA lures with their images
  const { data, error } = await sb
    .from('lures')
    .select('slug, color_name, images')
    .eq('manufacturer_slug', 'viva')
    .order('slug');

  if (error || !data) {
    console.error('Error:', error);
    return;
  }

  // Group by slug and count images per slug
  const slugMap = new Map<string, { dbCount: number; maxIndex: number; images: string[] }>();
  for (const r of data) {
    if (!slugMap.has(r.slug)) {
      slugMap.set(r.slug, { dbCount: 0, maxIndex: 0, images: [] });
    }
    const entry = slugMap.get(r.slug)!;
    if (r.images && r.images.length > 0) {
      entry.dbCount++;
      for (const img of r.images) {
        entry.images.push(img);
        // Extract index number from URL like .../XX.webp
        const match = img.match(/\/(\d+)\.webp/);
        if (match) {
          const idx = parseInt(match[1]);
          if (idx > entry.maxIndex) entry.maxIndex = idx;
        }
      }
    }
  }

  console.log(`Total VIVA slugs: ${slugMap.size}`);

  // For each slug, check if R2 has images beyond maxIndex
  const R2_BASE = 'https://pub-555da67d0de44f4e89afa8c52ff621a2.r2.dev/viva';
  
  let orphanProducts = 0;
  let totalOrphans = 0;

  for (const [slug, info] of slugMap) {
    // Check if there are images beyond the max index
    let orphanCount = 0;
    const startCheck = info.maxIndex + 1;
    
    // Check up to 50 beyond the max
    for (let i = startCheck; i <= startCheck + 50; i++) {
      const idx = String(i).padStart(2, '0');
      const url = `${R2_BASE}/${slug}/${idx}.webp`;
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          orphanCount++;
          const contentLength = res.headers.get('content-length') || '?';
          if (orphanCount <= 3) {
            console.log(`  ORPHAN: ${slug}/${idx}.webp (${contentLength} bytes)`);
          }
        } else {
          break; // No more images
        }
      } catch {
        break;
      }
    }

    if (orphanCount > 0) {
      orphanProducts++;
      totalOrphans += orphanCount;
      console.log(`${slug}: DB=${info.dbCount} images, max_index=${info.maxIndex}, orphans=${orphanCount}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Products with orphans: ${orphanProducts}/${slugMap.size}`);
  console.log(`Total orphan images: ${totalOrphans}`);
}

main();
