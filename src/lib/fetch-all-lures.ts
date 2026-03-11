import { supabase } from './supabase';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_FILE = join(process.cwd(), '.cache', 'lures.json');

/**
 * 全ルアーデータを取得する。
 *
 * 優先順位:
 * 1. メモリキャッシュ（同一ビルド内で2回目以降） → egress 0, disk I/O 0
 * 2. ローカルファイルキャッシュ (.cache/lures.json) → egress 0
 * 3. Supabase API（フォールバック）
 *
 * ⚠️ ビルド時14ルートから呼ばれるが、メモリキャッシュにより
 *    Supabase APIは最大1回しか叩かない（egress 1/14に削減）
 *
 * キャッシュファイルは scripts/dump-lures-cache.ts で生成する。
 * パイプライン実行後に自動更新される。
 */

// メモリキャッシュ: 同一プロセス内で共有（ビルド中14回呼ばれても1回だけフェッチ）
let memoryCache: any[] | null = null;

export async function fetchAllLures() {
  // 1. メモリキャッシュ（同一ビルド内の2回目以降）
  if (memoryCache) {
    console.log(`[memory] ${memoryCache.length} lures from memory cache`);
    return memoryCache;
  }

  // 2. ファイルキャッシュ
  if (existsSync(CACHE_FILE)) {
    try {
      const raw = readFileSync(CACHE_FILE, 'utf-8');
      const lures = JSON.parse(raw);
      console.log(`[file] Loaded ${lures.length} lures from .cache/lures.json`);
      memoryCache = lures;
      return lures;
    } catch (e) {
      console.warn('⚠️ キャッシュ読み込み失敗、Supabaseにフォールバック:', e);
    }
  }

  // 3. Supabase API（フォールバック）
  console.log('⚠️ キャッシュなし、Supabaseから取得中...');
  let allLures: any[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('lures')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(`Error fetching lures (offset ${from}):`, error);
      break;
    }

    if (data && data.length > 0) {
      allLures = allLures.concat(data);
      from += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  console.log(`[supabase] Fetched ${allLures.length} lures total`);

  // 安全チェック: データが0件ならビルドをクラッシュさせる（空デプロイ防止）
  if (allLures.length === 0) {
    throw new Error(
      '❌ ルアーデータが0件です。Supabase egress制限の可能性があります。\n' +
      '   → npx tsx scripts/dump-lures-cache.ts でキャッシュを生成してからビルドしてください。'
    );
  }

  memoryCache = allLures;
  return allLures;
}
