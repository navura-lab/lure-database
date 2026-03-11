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
    .in('manufacturer_slug', ['strike-king', 'z-man', 'zoom']);

  const seen = new Map<string, any>();
  for (const r of data ?? []) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  // 250文字以下のdescriptionを確認（英語かどうか）
  const shortOnes = [...seen.values()].filter(e => e.description && e.description.length <= 250);
  for (const e of shortOnes) {
    console.log(`${e.manufacturer_slug}/${e.slug}: (${e.description.length}文字)`);
    console.log(`  ${e.description}`);
    console.log('');
  }
}

main().catch(console.error);
