import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 名前に含まれるキーワードと期待されるタイプのマッピング
const NAME_TO_TYPE_RULES: { keyword: string; expectedType: string; priority: number }[] = [
  // 複合語を先にチェック（優先度が高いほど先に評価）
  { keyword: 'スピナーベイト', expectedType: 'スピナーベイト', priority: 100 },
  { keyword: 'スピナベ', expectedType: 'スピナーベイト', priority: 100 },
  { keyword: 'ラバージグ', expectedType: 'ラバージグ', priority: 100 },
  { keyword: 'ジグヘッド', expectedType: 'ジグヘッド', priority: 100 },
  { keyword: 'メタルジグ', expectedType: 'メタルジグ', priority: 100 },
  { keyword: 'メタルバイブ', expectedType: 'メタルバイブレーション', priority: 95 },
  { keyword: 'バイブレーション', expectedType: 'バイブレーション', priority: 90 },
  { keyword: 'バイブ', expectedType: 'バイブレーション', priority: 80 },
  { keyword: 'クランクベイト', expectedType: 'クランクベイト', priority: 90 },
  { keyword: 'クランク', expectedType: 'クランクベイト', priority: 80 },
  { keyword: 'ミノー', expectedType: 'ミノー', priority: 80 },
  { keyword: 'エギ', expectedType: 'エギ', priority: 80 },
  { keyword: 'スプーン', expectedType: 'スプーン', priority: 80 },
  { keyword: 'ポッパー', expectedType: 'ポッパー', priority: 80 },
  { keyword: 'ペンシルベイト', expectedType: 'ペンシルベイト', priority: 90 },
  { keyword: 'ペンシル', expectedType: 'ペンシルベイト', priority: 75 },
  { keyword: 'ワーム', expectedType: 'ワーム', priority: 70 },
  { keyword: 'フロッグ', expectedType: 'フロッグ', priority: 80 },
  { keyword: 'シャッド', expectedType: 'シャッド', priority: 70 },
  { keyword: 'ジグ', expectedType: 'メタルジグ', priority: 50 }, // 単独「ジグ」は曖昧だが一応チェック
  { keyword: 'スイムベイト', expectedType: 'スイムベイト', priority: 85 },
  { keyword: 'ビッグベイト', expectedType: 'ビッグベイト', priority: 85 },
  { keyword: 'チャターベイト', expectedType: 'チャターベイト', priority: 85 },
  { keyword: 'バズベイト', expectedType: 'バズベイト', priority: 85 },
  { keyword: 'プラグ', expectedType: 'プラグ', priority: 50 },
];

// 優先度順にソート（高い方が先）
NAME_TO_TYPE_RULES.sort((a, b) => b.priority - a.priority);

// 類似タイプの許容マッピング（これらは「ミスマッチ」としない）
const ACCEPTABLE_ALIASES: Record<string, string[]> = {
  'バイブレーション': ['メタルバイブレーション', 'バイブレーション'],
  'メタルバイブレーション': ['バイブレーション', 'メタルバイブレーション'],
  'クランクベイト': ['クランク', 'クランクベイト'],
  'ペンシルベイト': ['ペンシル', 'ペンシルベイト', 'トップウォーター'],
  'ポッパー': ['トップウォーター', 'ポッパー'],
  'フロッグ': ['トップウォーター', 'フロッグ'],
  'シャッド': ['ミノー', 'シャッド'], // シャッドとミノーは近い
  'メタルジグ': ['ジグ', 'メタルジグ', 'ショアジギング'],
  'スイムベイト': ['ビッグベイト', 'スイムベイト'],
  'ビッグベイト': ['スイムベイト', 'ビッグベイト'],
};

async function main() {
  console.error('全件取得中...');

  // 全件取得（ページネーション対応）
  const allLures: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await sb
      .from('lures')
      .select('id, name, type, manufacturer_slug, slug')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('エラー:', error);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allLures.push(...data);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }

  console.error(`全${allLures.length}件取得完了`);

  // slug単位で重複排除（同じ商品の異なるカラーを除外）
  const uniqueBySlug = new Map<string, any>();
  for (const lure of allLures) {
    const key = `${lure.slug}_${lure.manufacturer_slug}`;
    if (!uniqueBySlug.has(key)) {
      uniqueBySlug.set(key, lure);
    }
  }
  const uniqueLures = Array.from(uniqueBySlug.values());
  console.error(`ユニーク商品数: ${uniqueLures.length}`);

  // 1. タイプ別件数
  const typeCounts: Record<string, number> = {};
  for (const lure of uniqueLures) {
    const t = lure.type || '(NULL/空)';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // 2. NULL/空のカウント
  const nullOrEmpty = uniqueLures.filter(l => !l.type || l.type.trim() === '');
  const nullOrEmptyCount = nullOrEmpty.length;

  // 3. ミスマッチ検出
  const mismatches: any[] = [];
  const otherReclassifiable: any[] = [];

  for (const lure of uniqueLures) {
    const name = lure.name || '';
    const currentType = lure.type || '';

    // 名前からタイプを推測
    for (const rule of NAME_TO_TYPE_RULES) {
      if (name.includes(rule.keyword)) {
        const expected = rule.expectedType;

        // 現在のタイプと期待が一致するかチェック
        if (currentType === expected) break; // 正しい

        // 許容エイリアスチェック
        const aliases = ACCEPTABLE_ALIASES[expected] || [expected];
        if (aliases.includes(currentType)) break; // 許容範囲内

        // 「その他」の場合は別カテゴリ
        if (currentType === 'その他' || currentType === '' || !currentType) {
          otherReclassifiable.push({
            id: lure.id,
            name: lure.name,
            slug: lure.slug,
            manufacturer_slug: lure.manufacturer_slug,
            current_type: currentType || '(NULL/空)',
            suggested_type: expected,
            reason: `名前に「${rule.keyword}」が含まれる`,
          });
        } else {
          mismatches.push({
            id: lure.id,
            name: lure.name,
            slug: lure.slug,
            manufacturer_slug: lure.manufacturer_slug,
            current_type: currentType,
            expected_type: expected,
            reason: `名前に「${rule.keyword}」が含まれるが、タイプは「${currentType}」`,
          });
        }

        break; // 最初にマッチしたルールのみ適用
      }
    }
  }

  // ソート
  const sortedTypeCounts = Object.fromEntries(
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
  );

  const result = {
    total_records: allLures.length,
    unique_products: uniqueLures.length,
    type_counts: sortedTypeCounts,
    null_or_empty_count: nullOrEmptyCount,
    mismatch_count: mismatches.length,
    mismatches: mismatches.sort((a, b) => a.manufacturer_slug.localeCompare(b.manufacturer_slug)),
    other_reclassifiable_count: otherReclassifiable.length,
    other_reclassifiable: otherReclassifiable.sort((a, b) => a.manufacturer_slug.localeCompare(b.manufacturer_slug)),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
