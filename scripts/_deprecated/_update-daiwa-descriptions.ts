// One-time script to backfill descriptions for existing DAIWA products.
// Visits each unique DAIWA product page, extracts the description,
// and updates all matching rows in Supabase.
//
// Usage:
//   npx tsx scripts/_update-daiwa-descriptions.ts              # run
//   npx tsx scripts/_update-daiwa-descriptions.ts --dry-run    # preview only
//   npx tsx scripts/_update-daiwa-descriptions.ts --limit 5    # process only 5

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX !== -1 ? parseInt(process.argv[LIMIT_IDX + 1], 10) : 0;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function extractDescription(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const descTexts = await page.evaluate(() => {
    const texts: string[] = [];
    const headline = document.querySelector('div.area h2.font_Midashi');
    if (headline && headline.textContent) {
      texts.push(headline.textContent.trim());
    }
    const bodyEls = document.querySelectorAll('div.containerText div.text');
    bodyEls.forEach(el => {
      const t = (el.textContent || '').trim();
      if (t.length > 20) texts.push(t);
    });
    return texts;
  });

  return descTexts.join('\n').substring(0, 500);
}

async function main() {
  log('========================================');
  log('DAIWA Description Backfill');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log('========================================');

  // Get unique DAIWA slugs with their source_url (paginated to avoid 1000-row limit)
  const slugMap = new Map<string, string>();
  const PAGE_SIZE = 1000;
  let from = 0;

  while (true) {
    const { data: batch } = await supabase
      .from('lures')
      .select('slug,source_url')
      .eq('manufacturer_slug', 'daiwa')
      .range(from, from + PAGE_SIZE - 1);

    if (!batch || batch.length === 0) break;

    for (const row of batch) {
      if (!slugMap.has(row.slug) && row.source_url) {
        slugMap.set(row.slug, row.source_url);
      }
    }

    from += PAGE_SIZE;
    if (batch.length < PAGE_SIZE) break;
  }

  let slugs = Array.from(slugMap.entries());
  if (LIMIT > 0) slugs = slugs.slice(0, LIMIT);

  log(`Unique DAIWA products: ${slugMap.size}, processing: ${slugs.length}`);

  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < slugs.length; i++) {
    const [slug, sourceUrl] = slugs[i];
    log(`[${i + 1}/${slugs.length}] ${slug}: ${sourceUrl}`);

    try {
      const description = await extractDescription(page, sourceUrl);

      if (!description || description.length < 20) {
        log(`  Skipped: description too short (${description.length} chars)`);
        skipped++;
        continue;
      }

      log(`  Description (${description.length} chars): ${description.substring(0, 60)}...`);

      if (!DRY_RUN) {
        const { error } = await supabase
          .from('lures')
          .update({ description })
          .eq('slug', slug)
          .eq('manufacturer_slug', 'daiwa');

        if (error) {
          log(`  ERROR updating: ${error.message}`);
          errors++;
        } else {
          updated++;
        }
      } else {
        updated++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ERROR: ${msg}`);
      errors++;
    }

    // Polite delay
    if (i < slugs.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await browser.close();

  log('========================================');
  log('Summary');
  log(`Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
  log('========================================');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
