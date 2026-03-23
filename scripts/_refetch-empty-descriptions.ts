// scripts/_refetch-empty-descriptions.ts
// description空のルアーに対して、既存スクレイパーを使って再取得する
//
// Usage:
//   npx tsx scripts/_refetch-empty-descriptions.ts --maker evergreen --dry-run
//   npx tsx scripts/_refetch-empty-descriptions.ts --maker ima
//   npx tsx scripts/_refetch-empty-descriptions.ts --all --dry-run
//
// Options:
//   --maker <slug>   特定メーカーだけ処理
//   --all            全メーカー処理（スクレイパーがあるもののみ）
//   --dry-run        DBに書き込まない（取得結果を表示のみ）
//   --limit <N>      処理件数制限（デフォルト: 無制限）

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getScraper, getRegisteredManufacturers } from './scrapers/index.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DELAY_BETWEEN_SCRAPES_MS = 2000; // サイトに優しく

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}
const dryRun = args.includes('--dry-run');
const allMakers = args.includes('--all');
const makerArg = getArg('--maker');
const limitArg = getArg('--limit');
const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

if (!makerArg && !allMakers) {
  console.error('Usage: npx tsx scripts/_refetch-empty-descriptions.ts --maker <slug> [--dry-run] [--limit N]');
  console.error('       npx tsx scripts/_refetch-empty-descriptions.ts --all [--dry-run] [--limit N]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// テンプレ文・共通テキスト検知（これらはdescriptionとして使えない）
const BOILERPLATE_PATTERNS = [
  /^株式会社/,                           // tiemco: "株式会社ティムコの公式サイトです"
  /公式サイト/,                           // 共通テンプレ
  /公式ウェブサイト/,
  /公式ホームページ/,
  /copyright|©/i,
  /^fishing\s/i,                         // 汎用すぎるテキスト
  /ページが見つかりません/,
  /404\s*not\s*found/i,
  /お探しのページ/,
  /^商品情報をはじめ/,
  /電動ジギングならゼロドラゴン/,         // zero-dragon共通meta description
];

// 同一descriptionが全商品で出る = テンプレ文。実行中に記録して弾く
const descriptionCounts = new Map<string, number>();
function trackDescription(desc: string): void {
  const key = desc.substring(0, 60);
  descriptionCounts.set(key, (descriptionCounts.get(key) || 0) + 1);
}

function isBoilerplate(desc: string): boolean {
  return BOILERPLATE_PATTERNS.some(p => p.test(desc.trim()));
}

const MIN_DESC_LENGTH = 20; // 10文字ではキャッチコピーが通ってしまうので20文字に

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const registeredMakers = getRegisteredManufacturers();

  // 1. 全行取得（description空のみ）
  log('Fetching all lures with empty descriptions...');
  const allRows: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('id, manufacturer_slug, slug, source_url, description')
      .range(from, from + PAGE - 1);
    if (error) { console.error('DB error:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  log(`Total rows in DB: ${allRows.length}`);

  // description空をフィルタ（10文字未満）
  const emptyRows = allRows.filter(r => !r.description || r.description.trim().length < 10);

  // slugでユニーク化（同一slug = 同一商品、descriptionは共通）
  const uniqueBySlug = new Map<string, { manufacturer_slug: string; slug: string; source_url: string; ids: number[] }>();
  for (const r of emptyRows) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!uniqueBySlug.has(key)) {
      uniqueBySlug.set(key, {
        manufacturer_slug: r.manufacturer_slug,
        slug: r.slug,
        source_url: r.source_url,
        ids: [r.id],
      });
    } else {
      uniqueBySlug.get(key)!.ids.push(r.id);
    }
  }
  log(`Unique slugs with empty description: ${uniqueBySlug.size}`);

  // 2. 対象メーカーの決定
  const targetMakers = allMakers
    ? [...new Set([...uniqueBySlug.values()].map(r => r.manufacturer_slug))].filter(m => registeredMakers.includes(m))
    : makerArg ? [makerArg] : [];

  if (makerArg && !registeredMakers.includes(makerArg)) {
    console.error(`Scraper not found for: ${makerArg}`);
    console.error(`Registered scrapers: ${registeredMakers.join(', ')}`);
    process.exit(1);
  }

  // メーカーごとにグループ化
  const byMaker = new Map<string, typeof uniqueBySlug extends Map<string, infer V> ? V[] : never>();
  for (const entry of uniqueBySlug.values()) {
    if (!targetMakers.includes(entry.manufacturer_slug)) continue;
    const arr = byMaker.get(entry.manufacturer_slug) || [];
    arr.push(entry);
    byMaker.set(entry.manufacturer_slug, arr);
  }

  log(`Target makers: ${[...byMaker.keys()].join(', ')}`);
  for (const [maker, items] of byMaker) {
    log(`  ${maker}: ${items.length} slugs`);
  }

  // 3. スクレイプ実行
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const results: { maker: string; slug: string; description: string; status: string }[] = [];

  for (const [maker, items] of byMaker) {
    log(`\n=== Processing ${maker} (${items.length} items) ===`);
    const scraper = getScraper(maker);
    if (!scraper) {
      log(`  SKIP: No scraper registered for ${maker}`);
      continue;
    }

    for (const item of items) {
      if (totalProcessed >= limit) {
        log(`  Limit reached (${limit}), stopping.`);
        break;
      }

      if (!item.source_url) {
        log(`  SKIP: ${item.slug} — no source_url`);
        results.push({ maker, slug: item.slug, description: '', status: 'no-url' });
        totalSkipped++;
        continue;
      }

      totalProcessed++;
      log(`  [${totalProcessed}] Scraping ${item.slug} from ${item.source_url}`);

      try {
        const scraped = await scraper(item.source_url);
        const desc = scraped.description?.trim() || '';

        if (desc.length < MIN_DESC_LENGTH) {
          log(`    EMPTY: Got description < ${MIN_DESC_LENGTH} chars: "${desc}"`);
          results.push({ maker, slug: item.slug, description: desc, status: 'empty' });
          totalFailed++;
        } else if (isBoilerplate(desc)) {
          log(`    BOILERPLATE: "${desc.substring(0, 60)}..." — skipping`);
          results.push({ maker, slug: item.slug, description: desc, status: 'boilerplate' });
          totalFailed++;
        } else {
          log(`    OK: ${desc.substring(0, 80)}... (${desc.length}文字)`);
          results.push({ maker, slug: item.slug, description: desc, status: 'ok' });

          if (!dryRun) {
            // slugベースで全行更新（IDリスト方式はUUID多数でSupabaseが不安定）
            const { data: updated, error: err2 } = await sb
              .from('lures')
              .update({ description: desc })
              .eq('manufacturer_slug', maker)
              .eq('slug', item.slug)
              .select('id');

            if (err2) {
              log(`    DB ERROR: ${err2.message}`);
              totalFailed++;
            } else {
              log(`    UPDATED: ${updated?.length || 0} rows`);
              totalUpdated++;
            }
          } else {
            totalUpdated++;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`    ERROR: ${msg}`);
        results.push({ maker, slug: item.slug, description: '', status: `error: ${msg.substring(0, 100)}` });
        totalFailed++;
      }

      // サーバーに優しく待つ
      if (totalProcessed < items.length) {
        await sleep(DELAY_BETWEEN_SCRAPES_MS);
      }
    }

    if (totalProcessed >= limit) break;
  }

  // 4. サマリー
  log('\n=== Summary ===');
  log(`Processed: ${totalProcessed}`);
  log(`Updated: ${totalUpdated}${dryRun ? ' (dry-run)' : ''}`);
  log(`Empty/Failed: ${totalFailed}`);
  log(`Skipped: ${totalSkipped}`);

  // 結果一覧
  log('\n--- Results ---');
  for (const r of results) {
    const descPreview = r.description.length > 60 ? r.description.substring(0, 60) + '...' : r.description;
    log(`  ${r.status.padEnd(10)} ${r.maker}/${r.slug}: ${descPreview}`);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
