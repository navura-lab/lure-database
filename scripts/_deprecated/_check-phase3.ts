import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY as string
);

async function main() {
  // Paginate to get ALL rows (Supabase default limit is 1000)
  let allData: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb.from('lures').select('manufacturer_slug').range(from, from + pageSize - 1);
    if (error) { console.error(error); process.exit(1); }
    allData = allData.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  const data = allData;

  const counts: Record<string, number> = {};
  data.forEach((r: any) => { counts[r.manufacturer_slug] = (counts[r.manufacturer_slug] || 0) + 1; });

  const phase3 = ['attic','damiki','dreemup','god-hands','grassroots','itocraft','ivy-line','jazz','jungle-gym','mibro','obasslive','pickup','pozidrive-garage','sea-falcon','shout','signal','skagit','souls','viva','yarie','phat-lab','th-tackle'];

  console.log('Phase 3 makers in Supabase:');
  let total = 0;
  let withData = 0;
  let noData: string[] = [];
  phase3.sort().forEach(s => {
    const c = counts[s] || 0;
    total += c;
    if (c > 0) {
      withData++;
      console.log(`  ${s.padEnd(22)} ${c} rows`);
    } else {
      noData.push(s);
      console.log(`  ${s.padEnd(22)} -- NO DATA`);
    }
  });
  console.log('---');
  console.log(`With data: ${withData}/${phase3.length}`);
  console.log(`No data: ${noData.join(', ')}`);
  console.log(`Total Phase 3 rows: ${total}`);
  console.log(`Total distinct manufacturers: ${Object.keys(counts).length}`);
  console.log(`Total rows in Supabase: ${data.length}`);
}

main();
