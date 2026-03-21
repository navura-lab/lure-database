import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, name, color_name, images, source_url, manufacturer_slug').eq('slug', 'kozo-spin');
  if (!data) return;
  console.log(`Records: ${data.length}`);
  for (const r of data.slice(0, 5)) {
    const img = r.images?.[0] || 'NONE';
    console.log(`  color: ${r.color_name} | img: ${img.slice(-60)} | source: ${r.source_url}`);
    if (img !== 'NONE') {
      try {
        const res = await fetch(img, { method: 'HEAD' });
        console.log(`    HTTP ${res.status} | size: ${res.headers.get('content-length')}`);
      } catch (e: any) {
        console.log(`    ERROR: ${e.message}`);
      }
    }
  }
  
  // Vivaの他の商品も確認
  const { data: d2 } = await sb.from('lures').select('slug, images').eq('manufacturer_slug', 'viva').limit(10);
  const noImg = (d2 || []).filter(r => !r.images || r.images.length === 0 || r.images[0] === null);
  console.log(`\nViva total checked: ${d2?.length}, no image: ${noImg.length}`);
  for (const r of noImg) console.log(`  ${r.slug}: NONE`);
}
main().catch(console.error);
