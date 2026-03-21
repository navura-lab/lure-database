// scripts/_sea-falcon-fix.ts
// Sea Falcon データ品質修正
//
// 問題: discoverSeaFalcon が wp/v2/posts（ブログ記事）を商品として取り込んでいた
// seafalcon.jp にはそもそも商品ページが存在しない（ショップは shop.seafalcon.jp = MakeShop）
// 全19件が「臨時休業のお知らせ」「フィッシングショー出展」等のブログ記事
//
// 対処:
// 1. Supabase lures テーブルから sea-falcon 全19件を削除
// 2. Airtable lure URL テーブルから seafalcon.jp の12件を削除
// 3. 全メーカーの異常に長い slug を検出（レポートのみ）
//
// Usage:
//   npx tsx scripts/_sea-falcon-fix.ts              # dry-run
//   npx tsx scripts/_sea-falcon-fix.ts --execute    # 実行

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--execute');
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';
const AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---------------------------------------------------------------------------
// 1. Supabase: sea-falcon 全件削除
// ---------------------------------------------------------------------------

async function deleteSeaFalconFromSupabase() {
  log('=== Supabase: sea-falcon レコード削除 ===');

  const { data, error } = await sb
    .from('lures')
    .select('id, slug, name, source_url')
    .eq('manufacturer_slug', 'sea-falcon');

  if (error) {
    log(`ERROR: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) {
    log('sea-falcon レコードなし。スキップ。');
    return;
  }

  log(`削除対象: ${data.length}件`);
  for (const row of data) {
    log(`  - [${row.slug}] ${row.name} | ${row.source_url}`);
  }

  if (DRY_RUN) {
    log('DRY RUN: 削除スキップ');
    return;
  }

  const ids = data.map(r => r.id);
  const { error: delError } = await sb
    .from('lures')
    .delete()
    .in('id', ids);

  if (delError) {
    log(`ERROR deleting: ${delError.message}`);
  } else {
    log(`✓ ${ids.length}件削除完了`);
  }
}

// ---------------------------------------------------------------------------
// 2. Airtable: seafalcon.jp URL レコード削除
// ---------------------------------------------------------------------------

async function deleteSeaFalconFromAirtable() {
  log('=== Airtable: seafalcon.jp レコード削除 ===');

  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}?filterByFormula=SEARCH('seafalcon',{URL})`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });
  if (!res.ok) {
    log(`ERROR: Airtable fetch failed: ${res.status}`);
    return;
  }
  const json = await res.json();
  const records = json.records || [];

  if (records.length === 0) {
    log('seafalcon.jp レコードなし。スキップ。');
    return;
  }

  log(`削除対象: ${records.length}件`);
  for (const r of records) {
    log(`  - ${r.id} | ${r.fields?.URL || '(no URL)'}`);
  }

  if (DRY_RUN) {
    log('DRY RUN: 削除スキップ');
    return;
  }

  // Airtable batch delete (max 10 per request)
  const ids: string[] = records.map((r: any) => r.id);
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const params = batch.map(id => `records[]=${id}`).join('&');
    const delRes = await fetch(
      `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_LURE_URL_TABLE_ID}?${params}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
      }
    );
    if (!delRes.ok) {
      log(`ERROR: Airtable delete failed: ${delRes.status}`);
    } else {
      log(`✓ batch ${i / 10 + 1}: ${batch.length}件削除完了`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. 全メーカー slug 長さ監査
// ---------------------------------------------------------------------------

async function auditLongSlugs() {
  log('=== 全メーカー: 異常に長い slug の検出 ===');

  // slug が 40文字以上のレコードを取得
  const { data, error } = await sb
    .from('lures')
    .select('slug, name, manufacturer_slug, source_url')
    .order('manufacturer_slug');

  if (error) {
    log(`ERROR: ${error.message}`);
    return;
  }
  if (!data) {
    log('データなし');
    return;
  }

  const SLUG_LENGTH_THRESHOLD = 40;
  const longSlugs = data.filter(r => r.slug && r.slug.length >= SLUG_LENGTH_THRESHOLD);

  if (longSlugs.length === 0) {
    log(`slug が ${SLUG_LENGTH_THRESHOLD}文字以上のレコードなし。`);
    return;
  }

  // ローマ字化された日本語っぽいパターン
  const romajiPattern = /(?:[aeiou]{2,}|shi|chi|tsu|sha|sho|shu|cha|cho|chu|kyu|ryu|gyo|nyo|myo|byo|pyo|kya|rya|nya|mya|hya|bya|pya|gya|jya|sya|tya|dya|zya)/i;

  log(`slug >= ${SLUG_LENGTH_THRESHOLD}文字: ${longSlugs.length}件`);
  log('');

  // メーカー別にグループ化
  const byMaker: Record<string, typeof longSlugs> = {};
  for (const r of longSlugs) {
    const maker = r.manufacturer_slug || 'unknown';
    if (!byMaker[maker]) byMaker[maker] = [];
    byMaker[maker].push(r);
  }

  let suspiciousCount = 0;
  for (const [maker, records] of Object.entries(byMaker).sort()) {
    // ローマ字化パターンが2つ以上あるものだけフラグ
    const suspicious = records.filter(r => {
      const matches = r.slug.match(new RegExp(romajiPattern.source, 'gi'));
      return matches && matches.length >= 3;
    });
    if (suspicious.length > 0) {
      log(`[${maker}] 疑わしい slug: ${suspicious.length}件`);
      for (const r of suspicious) {
        log(`  slug: ${r.slug} (${r.slug.length}文字)`);
        log(`  name: ${r.name}`);
        log(`  url:  ${r.source_url}`);
        log('');
      }
      suspiciousCount += suspicious.length;
    }
  }

  if (suspiciousCount === 0) {
    log('ローマ字化された説明文 slug は見つかりませんでした。');
  } else {
    log(`合計 ${suspiciousCount}件の疑わしい slug を検出。`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(DRY_RUN ? '=== DRY RUN モード ===' : '=== 実行モード ===');
  log('');

  await deleteSeaFalconFromSupabase();
  log('');

  await deleteSeaFalconFromAirtable();
  log('');

  await auditLongSlugs();
  log('');

  log('完了');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
