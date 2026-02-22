// One-shot script: register all SMITH product URLs into Airtable
// Run: npx tsx scripts/register-smith-urls.ts [--dry-run]

import { chromium } from 'playwright';

const SMITH_BASE = 'https://www.smith.jp';

const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Excluded paths (rods, reels, accessories, tools, non-products)
// ---------------------------------------------------------------------------

const EXCLUDED_PATHS = [
  // Rods (bass)
  'bareafun', 'hiroism',
  // Rods (trout)
  'lagless', 'tactist', 'realflex', 'daggerstream',
  'bstc', 'multiyouse', 'panoramashaft', 'ss4custom', 'neuelimited',
  'ilflusso', 'averlla', 'tareafun',
  // Rods (salt)
  'bowdevil', 'smoky', 'darkshadowex',
  'baylineraj', 'baylinermk', 'baylinerakbm', 'baylinerrf', 'baylinersj',
  'hsjbeveljerk', 'hsjcs', 'hsjssl', 'gravitation',
  'kozexpcasting', 'kozexpspinning', 'kozexpjigging',
  'amjx', 'gtk', 'wrc', 'olp',
  // Rods (catfish/snakehead)
  'namanchu', 'mhkoz3',
  // Accessories & tools
  'accessory/', 'reelgrease', 'releaser', 'neomaghookkeeper',
  'eyetunerfinesse', 'easyfishgrip', 'egisharpner',
  'option', '/tool/', '/parts/',
  // Non-product pages
  'heddon_ss',
];

function isExcluded(url: string): boolean {
  var lower = url.toLowerCase();
  for (var i = 0; i < EXCLUDED_PATHS.length; i++) {
    if (lower.indexOf(EXCLUDED_PATHS[i].toLowerCase()) >= 0) return true;
  }
  // External links (superstrike)
  if (lower.indexOf('superstrike') >= 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch(path: string, options: any = {}) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res.json() as any;
}

async function findOrCreateMaker(name: string, slug: string): Promise<string> {
  const formula = encodeURIComponent(`{Slug}="${slug}"`);
  const data = await airtableFetch(`${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=${formula}`);
  if (data.records && data.records.length > 0) {
    console.log(`Maker found: ${name} (${data.records[0].id})`);
    return data.records[0].id;
  }
  const created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields: { 'メーカー名': name, 'Slug': slug } }],
    }),
  });
  const id = created.records[0].id;
  console.log(`Maker created: ${name} (${id})`);
  return id;
}

// ---------------------------------------------------------------------------
// Crawl all product URLs from category pages
// ---------------------------------------------------------------------------

const CATEGORY_PAGES = [
  '03-basstacle.html',
  '03-trouttacle.html',
  '03-saltwater.html',
  '03-cattacle.html',
  '03-snaketacle.html',
  '03-expedition.html',
];

async function crawlProductUrls(): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Use category-dir as dedup key: "trout/dcontact"
  const seenKeys = new Set<string>();
  const allUrls: string[] = [];

  for (const catPage of CATEGORY_PAGES) {
    const catUrl = `${SMITH_BASE}/html/${catPage}`;
    console.log(`Crawling: ${catUrl}`);

    try {
      await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const links = await page.evaluate(function () {
        var anchors = document.querySelectorAll('a[href*="product/"]');
        var results: string[] = [];
        for (var i = 0; i < anchors.length; i++) {
          var href = (anchors[i] as HTMLAnchorElement).href;
          if (href && href.indexOf('.html') > 0) {
            results.push(href);
          }
        }
        return results;
      });

      console.log(`  Found ${links.length} product links`);

      for (const link of links) {
        // Extract category/dir for dedup: "trout/dcontact"
        var match = link.match(/\/product\/([^/]+)\/([^/]+)\//);
        if (!match) continue;

        var key = match[1] + '/' + match[2];

        // Skip excluded
        if (isExcluded(link)) {
          continue;
        }

        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        // Normalize URL
        var normalizedUrl = `${SMITH_BASE}/product/${match[1]}/${match[2]}/${match[2]}.html`;
        // Some pages have different filenames (e.g., ihwb/innerhand.html)
        // Use the actual link URL instead
        allUrls.push(link);
      }
    } catch (err) {
      console.error(`  Error crawling ${catPage}:`, err);
    }
  }

  await browser.close();
  return allUrls;
}

// ---------------------------------------------------------------------------
// Verify URLs (check for 404s)
// ---------------------------------------------------------------------------

async function verifyUrls(urls: string[]): Promise<string[]> {
  console.log(`\nVerifying ${urls.length} URLs for 404s...`);
  const valid: string[] = [];
  let notFound = 0;

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { method: 'HEAD', redirect: 'follow' });
      if (res.ok) {
        valid.push(urls[i]);
      } else {
        console.log(`  ❌ ${res.status}: ${urls[i]}`);
        notFound++;
      }
    } catch {
      console.log(`  ❌ Error: ${urls[i]}`);
      notFound++;
    }

    // Rate limit
    if (i % 20 === 19) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`  Valid: ${valid.length}, Not Found: ${notFound}`);
  return valid;
}

// ---------------------------------------------------------------------------
// Register URLs to Airtable
// ---------------------------------------------------------------------------

async function registerUrls(urls: string[], makerId: string): Promise<void> {
  console.log(`\nRegistering ${urls.length} URLs to Airtable...`);

  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const records = batch.map((url) => ({
      fields: {
        URL: url,
        'メーカー': [makerId],
        'ステータス': '未処理',
      },
    }));

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would register batch ${Math.floor(i / 10) + 1}: ${batch.length} URLs`);
      continue;
    }

    const result = await airtableFetch(AIRTABLE_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify({ records }),
    });

    if (result.error) {
      console.error(`Error at batch ${Math.floor(i / 10) + 1}:`, result.error);
    } else {
      console.log(`Registered batch ${Math.floor(i / 10) + 1}: ${result.records.length} URLs`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // 1. Crawl all product URLs
  const urls = await crawlProductUrls();
  console.log(`\nTotal unique product URLs: ${urls.length}`);

  if (urls.length === 0) {
    console.log('No URLs found. Exiting.');
    process.exit(1);
  }

  // 2. Verify (filter 404s)
  const validUrls = await verifyUrls(urls);
  console.log(`\nValid product URLs: ${validUrls.length}`);

  // Print all URLs
  validUrls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would register all URLs above.');
    process.exit(0);
  }

  // 3. Find or create maker
  const makerId = await findOrCreateMaker('SMITH', 'smith');

  // 4. Register
  await registerUrls(validUrls, makerId);

  console.log('\nDone!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
