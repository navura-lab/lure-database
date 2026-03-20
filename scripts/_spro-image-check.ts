import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.from('lures').select('slug, images').eq('manufacturer_slug', 'spro');
  if (error) { console.error(error); process.exit(1); }
  console.log('Total SPRO lures:', data!.length);
  const withImages = data!.filter((d: any) => d.images && d.images.length > 0);
  console.log('With images:', withImages.length);
  console.log('Without images:', data!.length - withImages.length);
  
  // Collect all unique image URLs
  const allUrls: { slug: string; url: string }[] = [];
  for (const d of withImages) {
    for (const url of (d as any).images) {
      allUrls.push({ slug: d.slug, url });
    }
  }
  console.log('Total image URLs to check:', allUrls.length);
  
  // HEAD request for each to get Content-Length
  let small = 0;
  let ok = 0;
  let failed = 0;
  const smallList: { slug: string; url: string; size: number }[] = [];
  
  // Process in batches of 20
  for (let i = 0; i < allUrls.length; i += 20) {
    const batch = allUrls.slice(i, i + 20);
    const results = await Promise.all(batch.map(async ({ slug, url }) => {
      try {
        const resp = await fetch(url, { method: 'HEAD' });
        const cl = parseInt(resp.headers.get('content-length') || '0', 10);
        return { slug, url, size: cl, ok: resp.ok };
      } catch {
        return { slug, url, size: 0, ok: false };
      }
    }));
    for (const r of results) {
      if (!r.ok) { failed++; continue; }
      if (r.size < 5000) {
        small++;
        smallList.push({ slug: r.slug, url: r.url, size: r.size });
      } else {
        ok++;
      }
    }
  }
  
  console.log('\n=== 統計 ===');
  console.log(`OK (>=5KB): ${ok}`);
  console.log(`プレースホルダー疑い (<5KB): ${small}`);
  console.log(`取得失敗: ${failed}`);
  
  if (smallList.length > 0) {
    console.log('\n=== プレースホルダー疑い一覧 ===');
    for (const s of smallList) {
      console.log(`  ${s.slug} | ${s.size} bytes | ${s.url}`);
    }
  }
  
  // Also list slugs without images
  const noImages = data!.filter((d: any) => !d.images || d.images.length === 0);
  if (noImages.length > 0) {
    console.log(`\n=== 画像なし (${noImages.length}件) ===`);
    for (const d of noImages.slice(0, 20)) {
      console.log(`  ${d.slug}`);
    }
    if (noImages.length > 20) console.log(`  ... and ${noImages.length - 20} more`);
  }
}
main();
