/**
 * 検索用JSONインデックスを生成して public/ に配置
 * ビルド後スクリプトとして実行される
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(import.meta.dirname, '..', '.cache', 'lures.json');
const OUT_FILE = path.join(import.meta.dirname, '..', 'public', 'search-index.json');

async function main() {
  // .cache/lures.json からデータ読み込み（ビルド時に生成済み）
  if (!fs.existsSync(CACHE_FILE)) {
    console.log('[search-index] .cache/lures.json が見つかりません。npm run build を先に実行してください。');
    return;
  }

  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  
  // シリーズにグルーピング
  const seriesMap = new Map<string, any>();
  for (const lure of raw) {
    const key = `${lure.manufacturer_slug}/${lure.slug}`;
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        s: lure.slug,
        n: lure.name || '',
        k: lure.name_kana || '',
        m: lure.manufacturer || '',
        ms: lure.manufacturer_slug || '',
        t: lure.type || '',
        f: lure.target_fish || [],
        i: (lure.images && lure.images[0]) || '',
        c: 1,
        p: lure.price || 0,
      });
    } else {
      seriesMap.get(key)!.c++;
    }
  }

  const index = [...seriesMap.values()];
  fs.writeFileSync(OUT_FILE, JSON.stringify(index));
  console.log(`[search-index] ${index.length}件を ${OUT_FILE} に生成（${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)}KB）`);
}

main().catch(console.error);
