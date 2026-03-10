/**
 * Supabase から全ルアーデータをダンプして .cache/lures.json に保存する。
 * ビルド時はこのキャッシュを使い、Supabase へのegressを削減する。
 *
 * 使い方:
 *   npx tsx scripts/dump-lures-cache.ts
 *
 * パイプライン完了後に自動実行される（run-pipeline-*.sh から呼び出し）。
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'lures.json');

async function main() {
  const url = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('❌ Supabase URL/Key が設定されていません');
    process.exit(1);
  }

  const sb = createClient(url, key);

  console.log('⏳ Supabase から全ルアーを取得中...');
  const startTime = Date.now();

  let allLures: any[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await sb
      .from('lures')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(`❌ Supabase エラー (offset ${from}):`, error.message);
      process.exit(1);
    }

    if (data && data.length > 0) {
      allLures = allLures.concat(data);
      from += pageSize;
      hasMore = data.length === pageSize;
      // 進捗表示
      if (from % 10000 === 0) {
        process.stdout.write(`  ${allLures.length.toLocaleString()} 行...\r`);
      }
    } else {
      hasMore = false;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ ${allLures.length.toLocaleString()} 行取得 (${elapsed}s)`);

  // .cache/ ディレクトリ作成
  mkdirSync(CACHE_DIR, { recursive: true });

  // JSON書き出し（改行なし、サイズ最小化）
  writeFileSync(CACHE_FILE, JSON.stringify(allLures));

  const size = statSync(CACHE_FILE).size;
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  console.log(`📁 キャッシュ保存: ${CACHE_FILE} (${sizeMB} MB)`);
  console.log(`💡 次回ビルドはこのキャッシュから読み込み、Supabase egressを消費しません`);
}

main();
