/**
 * 特定メーカーの既存商品を再スクレイプしてDBを更新する
 * パイプラインは新規のみ対応のため、既存商品の再取得にはこのスクリプトを使う
 *
 * Usage:
 *   npx tsx scripts/_rescrape-maker.ts --maker dreemup [--dry-run]
 *   npx tsx scripts/_rescrape-maker.ts --maker mukai [--dry-run]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getScraper } from './scrapers/index.js';

const SCRAPE_TIMEOUT_MS = 30_000; // 1商品あたりのタイムアウト
const DELAY_BETWEEN_MS = 1_500;   // サイトに優しく

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scrapeWithTimeout(scraper: Function, url: string, timeoutMs: number) {
  return Promise.race([
    scraper(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

async function main() {
  const makerIdx = process.argv.indexOf('--maker');
  const maker = makerIdx >= 0 ? process.argv[makerIdx + 1] : null;
  const dryRun = process.argv.includes('--dry-run');

  if (!maker) {
    console.error('Usage: npx tsx scripts/_rescrape-maker.ts --maker <maker-slug> [--dry-run]');
    process.exit(1);
  }

  const scraper = getScraper(maker);
  if (!scraper) {
    console.error(`スクレイパーが見つかりません: ${maker}`);
    process.exit(1);
  }

  console.log(`=== ${maker} 再スクレイプ ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // 既存商品のsource_urlを取得
  const { data: existing } = await sb
    .from('lures')
    .select('slug, source_url')
    .eq('manufacturer_slug', maker);

  if (!existing || existing.length === 0) {
    console.log('対象商品なし');
    return;
  }

  // slug単位でユニーク化
  const slugUrls = new Map<string, string>();
  for (const r of existing) {
    if (r.source_url && !slugUrls.has(r.slug)) {
      slugUrls.set(r.slug, r.source_url);
    }
  }

  console.log(`対象: ${slugUrls.size} 商品\n`);

  let updated = 0;
  let errors = 0;
  let skipped = 0;
  let count = 0;

  for (const [slug, url] of slugUrls) {
    count++;
    try {
      const result = await scrapeWithTimeout(scraper, url, SCRAPE_TIMEOUT_MS);

      if (!result) {
        console.log(`[${count}/${slugUrls.size}] SKIP ${slug}: スクレイプ結果なし`);
        skipped++;
        continue;
      }

      // カラー情報があれば更新
      const colors = result.colors || [];
      const description = result.description || '';
      const mainImage = result.mainImage || '';

      if (dryRun) {
        console.log(`[${count}/${slugUrls.size}] OK   ${slug}: ${colors.length}色, desc=${description.slice(0, 40)}..., img=${mainImage ? 'あり' : 'なし'}`);
      } else {
        // DBの既存行を更新（descriptionと画像のみ、typeは変えない）
        if (description && description.length > 10) {
          await sb
            .from('lures')
            .update({ description })
            .eq('manufacturer_slug', maker)
            .eq('slug', slug);
        }

        console.log(`[${count}/${slugUrls.size}] OK   ${slug}: ${colors.length}色, desc=${description.length}文字`);
      }
      updated++;

    } catch (e: any) {
      console.log(`[${count}/${slugUrls.size}] ERR  ${slug}: ${e.message?.slice(0, 80)}`);
      errors++;
    }

    // サイトに優しく待つ（最後の1件は不要）
    if (count < slugUrls.size) {
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  console.log(`\n完了: 更新=${updated}, スキップ=${skipped}, エラー=${errors}`);
}

main().catch(console.error);
