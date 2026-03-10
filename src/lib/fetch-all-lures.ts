import { supabase } from './supabase';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CACHE_FILE = join(process.cwd(), '.cache', 'lures.json');

/**
 * 全ルアーデータを取得する。
 *
 * 優先順位:
 * 1. ローカルキャッシュ (.cache/lures.json) があればそこから読む → egress 0
 * 2. キャッシュがなければ Supabase から直接取得（フォールバック）
 *
 * キャッシュは scripts/dump-lures-cache.ts で生成する。
 * パイプライン実行後に自動更新される。
 */
export async function fetchAllLures() {
  // キャッシュファイルがあればそこから読む
  if (existsSync(CACHE_FILE)) {
    try {
      const raw = readFileSync(CACHE_FILE, 'utf-8');
      const lures = JSON.parse(raw);
      console.log(`Loaded ${lures.length} lures from cache`);
      return lures;
    } catch (e) {
      console.warn('⚠️ キャッシュ読み込み失敗、Supabaseにフォールバック:', e);
    }
  }

  // フォールバック: Supabase から直接取得
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

  console.log(`Fetched ${allLures.length} lures total`);
  return allLures;
}
