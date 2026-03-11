import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const data: Array<{slug: string; name: string; manufacturer_slug: string; description: string}> = JSON.parse(
  readFileSync('/tmp/us-eng-rewritten-all.json', 'utf-8')
);

console.log(`US英語リライト第2弾: ${data.length}件を書き込み開始`);

let success = 0;
let errors = 0;

for (const item of data) {
  const { error } = await sb
    .from('lures')
    .update({ description: item.description })
    .eq('manufacturer_slug', item.manufacturer_slug)
    .eq('slug', item.slug);

  if (error) {
    console.error(`❌ ${item.manufacturer_slug}/${item.slug}: ${error.message}`);
    errors++;
  } else {
    success++;
  }
}

console.log(`\n完了: ${success}成功, ${errors}エラー / ${data.length}件`);
