import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, color_name, images, source_url').eq('slug', 'shimmy-flat');
  if (!data) return;
  console.log(`shimmy-flat: ${data.length} records`);
  for (const r of data) {
    const img = r.images?.[0] || 'NONE';
    const isR2 = img.includes('r2.dev');
    const isValid = img.startsWith('https://');
    console.log(`  ${r.color_name}: valid=${isValid} r2=${isR2} img=${img.slice(-80)}`);
    if (isValid && isR2) {
      try {
        const res = await fetch(img, { method: 'HEAD' });
        console.log(`    HTTP ${res.status}`);
      } catch (e: any) {
        console.log(`    FETCH ERROR: ${e.message}`);
      }
    }
  }
}
main().catch(console.error);
