import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.from('lures').select('slug, color_name, images').eq('slug', 'kozo-spin');
  if (!data) return;
  
  let ok = 0, fail = 0;
  for (const r of data) {
    const img = r.images?.[0];
    if (!img) { fail++; continue; }
    try {
      const res = await fetch(img, { method: 'HEAD' });
      if (res.status === 200) ok++;
      else {
        fail++;
        console.log(`404: ${r.color_name} → ${img.slice(-30)}`);
      }
    } catch { fail++; }
  }
  console.log(`\nTotal: ${data.length}, OK: ${ok}, 404: ${fail}`);
}
main().catch(console.error);
