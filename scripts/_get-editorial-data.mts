import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!
);

const targets = [
  'buroin-80s',
  'louder70',
  'rapala-ssdrg',
  'shugamino-40s50f-s-soruto',
  'la-tour-rattln-vibe',
  'elfin-gurasuhoppa',
  'shot-over-7',
  'dera-break',
  'chupazo-60',
  'pamuborunekusuto-1-8g-2-3g',
  'rapala-rvb',
  'combatcrank60',
  'borakon-150',
  'hit-stick',
  'bassroid-jr-tripledouble',
  'bfreeze128-salt',
  'stunna',
  'cramp-shad-4.58243',
  'chibi-pepino',
  'rapala-bfcs',
];

for (const slug of targets) {
  const { data, error } = await sb
    .from('lures')
    .select('*')
    .eq('slug', slug)
    .limit(5);
  
  if (error || !data || data.length === 0) {
    process.stderr.write(`Error or no data for ${slug}\n`);
    continue;
  }
  
  const sample = data[0];
  process.stdout.write(`\n=== ${slug} ===\n`);
  process.stdout.write(`name: ${sample.name}\n`);
  process.stdout.write(`manufacturer_slug: ${sample.manufacturer_slug}\n`);
  process.stdout.write(`type: ${sample.type}\n`);
  process.stdout.write(`target_fish: ${JSON.stringify(sample.target_fish)}\n`);
  process.stdout.write(`length: ${sample.length}mm\n`);
  process.stdout.write(`weight: ${sample.weight}g\n`);
  process.stdout.write(`color_count: ${data.length}+\n`);
  process.stdout.write(`description: ${sample.description || '(empty)'}\n`);
}
