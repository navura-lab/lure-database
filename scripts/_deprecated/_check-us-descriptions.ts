import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const { data } = await sb
    .from('lures')
    .select('slug,name,description,manufacturer_slug')
    .in('manufacturer_slug', ['strike-king', 'z-man', 'zoom'])
    .limit(200);

  const seen = new Map<string, any>();
  for (const r of data ?? []) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  const entries = [...seen.values()];
  console.log('US商品数:', entries.length);

  const longDesc = entries.filter(e => e.description && e.description.length > 250);
  console.log('250文字超え（未リライト）:', longDesc.length);
  const noDesc = entries.filter(e => !e.description);
  console.log('description null:', noDesc.length);

  // サンプル表示
  for (const e of entries.slice(0, 8)) {
    console.log('---');
    console.log(`${e.manufacturer_slug}/${e.slug}: ${e.name}`);
    console.log(`desc(${(e.description || '').length}文字): ${(e.description || 'NULL').substring(0, 200)}`);
  }
}

main().catch(console.error);
