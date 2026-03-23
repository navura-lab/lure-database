/**
 * description空のルアーに対して、source_urlからスクレイパーを呼んで
 * descriptionだけを再取得・書き込むスクリプト
 *
 * Usage: npx tsx scripts/_refill-empty-descriptions.ts --maker <maker> [--dry-run]
 *
 * 2026-03-23: 安全のため1メーカーずつ実行する設計
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getScraper, getRegisteredManufacturers } from './scrapers/index.js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const makerArg = process.argv.find((a, i) => process.argv[i - 1] === '--maker');
  const dryRun = process.argv.includes('--dry-run');

  if (!makerArg) {
    console.log('Usage: npx tsx scripts/_refill-empty-descriptions.ts --maker <maker> [--dry-run]');
    console.log('Available makers:', getRegisteredManufacturers().join(', '));
    return;
  }

  const scraper = getScraper(makerArg);
  if (!scraper) {
    console.error(`スクレイパーが見つかりません: ${makerArg}`);
    console.log('Available:', getRegisteredManufacturers().join(', '));
    return;
  }

  // description空のslugリストを取得
  const targets = new Map<string, string>(); // slug -> source_url
  let offset = 0;
  while (true) {
    const { data } = await sb.from('lures')
      .select('slug, source_url, description')
      .eq('manufacturer_slug', makerArg)
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;

    for (const r of data) {
      const desc = (r.description || '').trim();
      if (desc.length < 10 && r.source_url && !targets.has(r.slug)) {
        targets.set(r.slug, r.source_url);
      }
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`[${makerArg}] description空: ${targets.size}件 ${dryRun ? '(DRY RUN)' : ''}\n`);
  if (targets.size === 0) {
    console.log('対象なし');
    return;
  }

  let updated = 0;
  let errors = 0;
  let skipped = 0;

  for (const [slug, sourceUrl] of targets) {
    try {
      console.log(`  スクレイプ中: ${slug} ...`);
      const result = await scraper(sourceUrl);

      if (!result || !result.description || result.description.trim().length < 10) {
        console.log(`  ⏭️ ${slug}: description取得できず`);
        skipped++;
        continue;
      }

      const newDesc = result.description.trim().substring(0, 500);

      // 会社概要テキストではないことを確認
      if (/公式サイトです|株式会社.*の|copyright/i.test(newDesc)) {
        console.log(`  ⏭️ ${slug}: 会社概要テキスト（スキップ）`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  📝 ${slug}: ${newDesc.slice(0, 60)}...`);
        updated++;
      } else {
        const { data, error } = await sb.from('lures')
          .update({ description: newDesc })
          .eq('manufacturer_slug', makerArg)
          .eq('slug', slug)
          .select('id');

        if (error) {
          console.log(`  ❌ ${slug}: ${error.message}`);
          errors++;
        } else {
          console.log(`  ✅ ${slug}: ${newDesc.slice(0, 50)}... (${data?.length}行)`);
          updated += data?.length || 0;
        }
      }
    } catch (e) {
      console.log(`  ❌ ${slug}: ${(e as Error).message?.slice(0, 80)}`);
      errors++;
    }
  }

  console.log(`\n完了: 更新=${updated}, スキップ=${skipped}, エラー=${errors}`);
}

main().catch(console.error);
