// Check slug and manufacturer_slug status across all manufacturers
import { createClient } from '@supabase/supabase-js';

var c = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

async function main() {
  var all: any[] = [];
  var from = 0;
  while (true) {
    var batch = await c.from('lures').select('manufacturer_slug, slug').range(from, from + 999);
    if (batch.data === null || batch.data.length === 0) break;
    all = all.concat(batch.data);
    from += 1000;
  }
  console.log('Total rows: ' + all.length);

  var byMaker: Record<string, number> = {};
  var nullSlugByMaker: Record<string, number> = {};
  var nullMakerSlug = 0;
  all.forEach(function(r: any) {
    var ms = r.manufacturer_slug || '(null)';
    byMaker[ms] = (byMaker[ms] || 0) + 1;
    if (r.slug === null || r.slug === '') {
      nullSlugByMaker[ms] = (nullSlugByMaker[ms] || 0) + 1;
    }
    if (r.manufacturer_slug === null || r.manufacturer_slug === '') nullMakerSlug++;
  });

  console.log('Rows with null manufacturer_slug: ' + nullMakerSlug);
  console.log('');

  var makers = Object.keys(byMaker).sort();
  console.log('Manufacturer | Total | NullSlug');
  console.log('---|---|---');
  makers.forEach(function(m: string) {
    var nullCount = nullSlugByMaker[m] || 0;
    var flag = nullCount > 0 ? ' *** PROBLEM' : '';
    console.log(m + ' | ' + byMaker[m] + ' | ' + nullCount + flag);
  });
}
main();
