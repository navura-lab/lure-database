import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,name,name_kana').range(offset, offset+999);
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  const seen = new Map<string,any>();
  for (const r of all) {
    const k = r.manufacturer_slug+'/'+r.slug;
    if (!seen.has(k)) seen.set(k, r);
  }
  const targets = [...seen.values()].filter((r: any) =>
    !r.name_kana && r.name && /^[a-zA-Z0-9\s\-\/\.\(\)'&]+$/.test(r.name)
  );
  console.log('対象:', targets.length, '件');
  targets.forEach((r: any) => console.log(r.manufacturer_slug + '\t' + r.name));
}
main();
