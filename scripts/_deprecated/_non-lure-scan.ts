/**
 * 全メーカー非ルアー商品スキャン
 *
 * 非ルアー商品の可能性があるキーワードを含む商品を洗い出す。
 * slug単位でユニーク化して表示。
 * 2026-03-04
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL as string,
  process.env.PUBLIC_SUPABASE_ANON_KEY as string
);

// 非ルアー商品の疑いがあるキーワード（名前に含まれていたら要確認）
const SUSPECT_KEYWORDS = [
  // アパレル
  'hoodie', 'hoody', 'パーカー', 'フーディ',
  't-shirt', 'tシャツ', 'シャツ',
  'cap', 'キャップ', 'ハット', 'hat', 'beanie', 'ビーニー', 'ニット帽',
  'jacket', 'ジャケット', 'ベスト', 'vest',
  'gaiter', 'ゲーター', 'mask', 'マスク', 'ネックウォーマー', 'グローブ', 'glove',
  // バッグ・ケース
  'bag', 'バッグ', 'バック', 'ポーチ', 'pouch', 'ケース', 'case',
  'wallet', 'ウォレット', 'backpack', 'リュック',
  'bakkan', 'バッカン', 'タックルボックス', 'tackle box',
  // 小物・アクセサリー
  'sticker', 'ステッカー', 'デカール', 'decal',
  'measure', 'メジャー', 'スケール',
  'holder', 'ホルダー', 'カラビナ', 'carabiner',
  'protector', 'プロテクター',
  'cooler', 'クーラー',
  'towel', 'タオル',
  'lanyard', 'ストラップ',
  // ロッド・リール（ルアーではない）
  'ロッド', 'rod ',  // スペース付きで "rod" を検索（prodやrodeo等を除外）
  'リール', 'reel',
  // ライン
  'ライン', 'line ',  // "line" はlureの名前にも出るので注意
  // フック・シンカー
  'フック', 'hook',
  'シンカー', 'sinker',
  // ツール
  'プライヤー', 'plier', 'フォーセップ', 'forcep',
  'はさみ', 'シザー', 'scissor',
  'ナイフ', 'knife',
  // ネット
  'ランディングネット', 'landing net',
  // ボトル
  'bottle', 'ボトル',
];

async function main() {
  // 全データ取得（ページング）
  let allData: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, name, manufacturer, manufacturer_slug, type')
      .order('manufacturer_slug')
      .range(offset, offset + batchSize - 1);

    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }

  console.log(`Total rows fetched: ${allData.length}`);

  // slug + manufacturer_slug でユニーク化
  const unique = new Map<string, { slug: string; name: string; manufacturer: string; manufacturer_slug: string; type: string }>();
  for (const r of allData) {
    const key = r.manufacturer_slug + '/' + r.slug;
    if (!unique.has(key)) {
      unique.set(key, r);
    }
  }

  console.log(`Unique series: ${unique.size}\n`);

  // キーワードマッチ
  const suspects: Array<{ manufacturer: string; manufacturer_slug: string; slug: string; name: string; type: string; matchedKeyword: string }> = [];

  for (const item of unique.values()) {
    const nameLower = item.name.toLowerCase();
    const slugLower = item.slug.toLowerCase();

    for (const kw of SUSPECT_KEYWORDS) {
      const kwLower = kw.toLowerCase();
      if (nameLower.includes(kwLower) || slugLower.includes(kwLower)) {
        suspects.push({
          ...item,
          matchedKeyword: kw,
        });
        break; // 1商品1キーワードで十分
      }
    }
  }

  // メーカー別にグルーピング
  const byMaker = new Map<string, typeof suspects>();
  for (const s of suspects) {
    const list = byMaker.get(s.manufacturer_slug) || [];
    list.push(s);
    byMaker.set(s.manufacturer_slug, list);
  }

  console.log(`=== 非ルアー疑い商品: ${suspects.length}件 (${byMaker.size}メーカー) ===\n`);

  for (const [mfr, items] of [...byMaker.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`\n--- ${items[0].manufacturer} (${mfr}) [${items.length}件] ---`);
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`  [${item.matchedKeyword}] ${item.name} | type=${item.type} | slug=${item.slug}`);
    }
  }
}

main().catch(console.error);
