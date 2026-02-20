// One-time script to apply rewritten descriptions to Supabase
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface RewriteItem {
  slug: string;
  rewritten: string;
}

async function main() {
  const rewritten: RewriteItem[] = JSON.parse(
    fs.readFileSync('scripts/_daiwa-rewritten-all.json', 'utf-8'),
  );

  console.log(`Total items to update: ${rewritten.length}`);

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rewritten.length; i++) {
    const item = rewritten[i];

    if (!item.rewritten || item.rewritten.length < 20) {
      console.log(`  Skipping ${item.slug}: rewrite too short (${item.rewritten.length})`);
      continue;
    }

    const { error } = await supabase
      .from('lures')
      .update({ description: item.rewritten })
      .eq('slug', item.slug)
      .eq('manufacturer_slug', 'daiwa');

    if (error) {
      console.log(`  ERROR updating ${item.slug}: ${error.message}`);
      errors++;
    } else {
      updated++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[${i + 1}/${rewritten.length}] Updated: ${updated}, Errors: ${errors}`);
    }
  }

  console.log('========================================');
  console.log('Summary');
  console.log(`Updated: ${updated}, Errors: ${errors}`);
  console.log('========================================');
}

main().catch(console.error);
