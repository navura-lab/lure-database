// scripts/register-jackall-urls.ts
// One-time URL registration for JACKALL products across all 4 sections.
// Crawls category listing pages, filters out non-lure categories, and
// registers product URLs in Airtable.
//
// Usage:
//   npx tsx scripts/register-jackall-urls.ts --dry-run   # preview only
//   npx tsx scripts/register-jackall-urls.ts              # live registration

import 'dotenv/config';
import { chromium, type Page } from 'playwright';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
const AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;

const DRY_RUN = process.argv.includes('--dry-run');
const JACKALL_BASE = 'https://www.jackall.co.jp';

// Sections to crawl: [sectionPath, sectionName]
const SECTIONS: [string, string][] = [
  ['/bass/', 'BASS'],
  ['/saltwater/shore-casting/', 'SALT SHORE'],
  ['/saltwater/offshore-casting/', 'SALT OFFSHORE'],
  ['/timon/', 'TROUT (Timon)'],
];

// Category slugs to EXCLUDE (non-lure: rods, accessories, tackle, etc.)
const EXCLUDED_CATEGORY_SLUGS = new Set([
  // Rods
  'rod', 'revoltage-rod', 'bpm', 'nazzy-choice',
  'cian-rod', 'casting', 'surf-rod', 'light-game',
  'tconnection', 't-connection-comfy-rod', 't-connection_s',
  'rod-tairkabura', 'rod-hitosutenya', 'boat-casting-rod',
  'rod-tachiuo-jigging', 'rod-bluefish-jigging',
  'tiprun-rod', 'fugu-rod', 'ikametalrod',
  // Reels
  'reel',
  // Tackle / accessories
  'accessory', 'apparel-tt', 'apparel-terminal-tackle', 'apparel',
  'hook-jighead', 'line', 'sinker', 'tool',
  'case-bag', 'sticker', 'jackall-works',
  'bag', 'wear',
  'hook', 'spare', 'parts',
  // Wader/vest
  'wader-gamevest',
  // Set/bundle pages (not individual lure products)
  'set',
  // Timon accessories (snaps, etc.)
  'other',
  // Custom parts (spare tails, propellers, rings etc)
  'custom-parts',
  // Salt offshore misc (non-lure)
  'salt-products-offs-246',
]);

// URL path keywords to exclude individual products
const EXCLUDED_URL_KEYWORDS = [
  'hook', 'spare', 'replacement', 'parts', 'sticker',
  'case', 'bag', 'apparel', 'wear', 'cap', 'shirt',
  'custom-weight', 'e-snap', 'esnap',
  'wader', 'vest',
  '/rod/',    // catches rod pages linked from lure categories (e.g. ayu)
  '/accessory/', // catches accessory pages linked from lure categories
  'sabiki', 'leader',
];

// Product name keywords to exclude (non-lure items ONLY — worms/soft baits ARE lures)
const EXCLUDED_NAME_KEYWORDS = [
  'フック', 'HOOK', 'スペア', 'SPARE', 'ｽﾍﾟｱ', '替え', '交換',
  'パーツ', 'PARTS', 'ケース', 'CASE', 'バッグ', 'BAG',
  'キャップ', 'CAP', 'シャツ', 'SHIRT', 'ステッカー', 'STICKER',
  'アパレル', 'ライン', 'LINE', 'シンカー', 'SINKER',
  'ロッド', 'ROD', 'リール', 'REEL',
  'イースナップ', 'E-SNAP', 'ESNAP',
  'ウェーダー', 'WADER', 'ベスト', 'VEST',
  'カスタムウェイト', 'CUSTOM WEIGHT',
  'スターターセット', 'STARTER SET',
  'ワンタッチラバー',
  'オーバルリング',
  'VCリーダー', 'LGフロート',
  // GEKIDAKI IKAMETAL LEADER is not a lure
  'LEADER', 'リーダー',
  // SABIKI rigs are fishing tackle, not lures
  'サビキ', 'SABIKI',
];

const PAGE_DELAY = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string { return new Date().toISOString(); }
function log(msg: string): void { console.log(`[${timestamp()}] ${msg}`); }
function logError(msg: string): void { console.error(`[${timestamp()}] ERROR: ${msg}`); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Crawl one section
// ---------------------------------------------------------------------------

interface DiscoveredProduct {
  url: string;
  name: string;
  section: string;
  category: string;
}

async function crawlSection(
  page: Page,
  sectionPath: string,
  sectionName: string,
): Promise<DiscoveredProduct[]> {
  log(`\n=== Crawling section: ${sectionName} (${sectionPath}) ===`);
  const products: DiscoveredProduct[] = [];
  const seen = new Set<string>();

  // Step 1: Get all category page URLs from the section's products page
  const productsUrl = `${JACKALL_BASE}${sectionPath}products/`;
  log(`Loading products index: ${productsUrl}`);
  await page.goto(productsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(PAGE_DELAY);

  // Find all category links
  const categoryLinks = await page.evaluate((basePath: string) => {
    const links: { url: string; slug: string }[] = [];
    const anchors = document.querySelectorAll(`a[href*="${basePath}products/category/"]`);
    const seen = new Set<string>();

    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href) continue;
      // Extract category slug
      const match = href.match(/\/products\/category\/([^/]+)/);
      if (!match) continue;
      const slug = match[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const fullUrl = href.startsWith('http') ? href : `https://www.jackall.co.jp${href}`;
      links.push({ url: fullUrl, slug });
    }
    return links;
  }, sectionPath);

  log(`Found ${categoryLinks.length} categories`);

  // Step 2: For each non-excluded category, crawl all pages
  for (const cat of categoryLinks) {
    // Check excluded categories
    if (EXCLUDED_CATEGORY_SLUGS.has(cat.slug)) {
      log(`  Skipping excluded category: ${cat.slug}`);
      continue;
    }

    log(`  Category: ${cat.slug}`);

    // Paginate through category pages
    for (let pageNum = 1; pageNum <= 20; pageNum++) {
      const pageUrl = pageNum === 1
        ? cat.url
        : `${cat.url.replace(/\/$/, '')}/page/${pageNum}/`;

      try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(PAGE_DELAY);

        const pageProducts = await page.evaluate(() => {
          const results: { url: string; name: string }[] = [];
          const items = document.querySelectorAll('.product-list__item a');

          for (const a of items) {
            const href = a.getAttribute('href');
            if (!href) continue;
            // Must be a product detail page, not a category page
            if (href.includes('/category/')) continue;

            // Extract product name
            const jpName = a.querySelector('.product-list__title--main')?.textContent?.trim() || '';
            const enName = a.querySelector('.product-list__title--sub, h4.common-list__meta')?.textContent?.trim().replace(/\s*NEW\s*$/i, '') || '';
            const name = jpName || enName || '';

            results.push({ url: href, name });
          }
          return results;
        });

        if (pageProducts.length === 0) {
          if (pageNum === 1) log(`    (empty category)`);
          break;
        }

        let newCount = 0;
        for (const p of pageProducts) {
          const fullUrl = p.url.startsWith('http') ? p.url : `${JACKALL_BASE}${p.url}`;
          const normalized = fullUrl.replace(/\/$/, '');

          if (seen.has(normalized)) continue;

          // Check URL exclusions
          const urlLower = normalized.toLowerCase();
          if (EXCLUDED_URL_KEYWORDS.some(kw => urlLower.includes(kw))) {
            log(`    Excluded (URL keyword): ${p.name || normalized}`);
            continue;
          }

          // Check name exclusions
          if (p.name && EXCLUDED_NAME_KEYWORDS.some(kw => p.name.toUpperCase().includes(kw.toUpperCase()))) {
            log(`    Excluded (name keyword): ${p.name}`);
            continue;
          }

          seen.add(normalized);
          products.push({
            url: normalized,
            name: p.name || '(名前取得失敗)',
            section: sectionName,
            category: cat.slug,
          });
          newCount++;
        }

        log(`    Page ${pageNum}: ${pageProducts.length} items, ${newCount} new`);

        // Check for next page
        const hasNext = await page.evaluate((currentPage: number) => {
          const pageLinks = document.querySelectorAll('.page-pagnation a, .navigation.pagination a');
          for (const link of pageLinks) {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\/page\/(\d+)/);
            if (match && parseInt(match[1]) > currentPage) return true;
          }
          return false;
        }, pageNum);

        if (!hasNext) break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logError(`    Failed page ${pageNum}: ${errMsg}`);
        break;
      }
    }
  }

  log(`Section ${sectionName}: ${products.length} products discovered`);
  return products;
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch<T>(tableId: string, path: string = '', options: RequestInit = {}): Promise<T> {
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function getOrCreateMaker(): Promise<string> {
  const filter = encodeURIComponent(`{Slug}='jackall'`);
  const data = await airtableFetch<{
    records: Array<{ id: string }>;
  }>(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  if (data.records.length > 0) {
    return data.records[0].id;
  }

  // Create maker record
  log('Creating JACKALL maker record in Airtable...');
  const created = await airtableFetch<{ id: string }>(
    AIRTABLE_MAKER_TABLE_ID,
    '',
    {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          'メーカー名': 'JACKALL',
          'Slug': 'jackall',
        },
      }),
    },
  );
  log(`Created maker record: ${created.id}`);
  return created.id;
}

async function registerBatch(
  records: Array<{ name: string; url: string }>,
  makerId: string,
): Promise<{ success: number; errors: number }> {
  let success = 0;
  let errors = 0;

  // Batch 10 at a time
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    try {
      await airtableFetch(
        AIRTABLE_LURE_URL_TABLE_ID,
        '',
        {
          method: 'POST',
          body: JSON.stringify({
            records: batch.map(r => ({
              fields: {
                'ルアー名': r.name,
                'URL': r.url,
                'メーカー': [makerId],
                'ステータス': '未処理',
                '備考': `自動登録 (${new Date().toISOString().split('T')[0]})`,
              },
            })),
          }),
        },
      );
      success += batch.length;
      log(`  Batch ${Math.floor(i / 10) + 1}: ${batch.length} registered`);
    } catch (err) {
      errors += batch.length;
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`  Batch ${Math.floor(i / 10) + 1} failed: ${errMsg}`);
    }
    await sleep(250); // rate limit
  }

  return { success, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('========================================');
  log(`JACKALL URL Registration — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  log('========================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  const allProducts: DiscoveredProduct[] = [];

  try {
    for (const [sectionPath, sectionName] of SECTIONS) {
      const products = await crawlSection(page, sectionPath, sectionName);
      allProducts.push(...products);
    }
  } finally {
    await browser.close();
    log('Browser closed');
  }

  // Summary
  log('\n========================================');
  log('Discovery Summary');
  log('========================================');
  const bySection = new Map<string, number>();
  for (const p of allProducts) {
    bySection.set(p.section, (bySection.get(p.section) || 0) + 1);
  }
  for (const [section, count] of bySection) {
    log(`  ${section}: ${count} products`);
  }
  log(`  TOTAL: ${allProducts.length} products`);

  if (DRY_RUN) {
    log('\n--- All discovered products ---');
    for (const p of allProducts) {
      log(`  [${p.section}/${p.category}] ${p.name}: ${p.url}`);
    }
    log('\nDRY RUN: No Airtable writes.');
    return;
  }

  // Register in Airtable
  log('\nRegistering in Airtable...');
  const makerId = await getOrCreateMaker();
  log(`Maker record ID: ${makerId}`);

  const { success, errors } = await registerBatch(
    allProducts.map(p => ({ name: p.name, url: p.url })),
    makerId,
  );

  log(`\nRegistered: ${success}, Errors: ${errors}`);
  log('Done.');
}

main().catch(err => {
  logError(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
