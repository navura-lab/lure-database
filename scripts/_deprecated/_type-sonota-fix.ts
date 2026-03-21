/**
 * _type-sonota-fix.ts — type='その他' 1,343件を正しいタイプに再分類
 *
 * name/description のキーワード + メーカー別デフォルトで分類。
 * 自動分類できないものは「その他」のまま残す。
 *
 * Usage:
 *   npx tsx scripts/_type-sonota-fix.ts              # dry-run
 *   npx tsx scripts/_type-sonota-fix.ts --apply       # DB更新
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

// ──────────────────────────────────────────────
// キーワード → タイプ マッピング（優先度順）
// ──────────────────────────────────────────────
// 長いキーワードを先にチェック（部分一致の誤マッチ防止）
const KEYWORD_TYPE_MAP: [RegExp, string][] = [
  // 複合語（先にチェック）
  [/メタルバイブ/i, 'メタルバイブ'],
  [/メタルジグ/i, 'メタルジグ'],
  [/スピナーベイト/i, 'スピナーベイト'],
  [/チャターベイト|ブレーデッドジグ/i, 'チャターベイト'],
  [/クローラーベイト/i, 'クローラーベイト'],
  [/スイムベイト|SWIMBAIT/i, 'スイムベイト'],
  [/ブレードベイト|BLADE\s*BAIT/i, 'ブレードベイト'],
  [/ラバージグ|RUBBER\s*JIG/i, 'ラバージグ'],
  [/ビッグベイト|BIG\s*BAIT/i, 'ビッグベイト'],
  [/ジグヘッド|JIG\s*HEAD/i, 'ジグヘッド'],
  [/クランクベイト|CRANKBAIT/i, 'クランクベイト'],
  [/トップウォーター|TOPWATER|TOP\s*WATER/i, 'トップウォーター'],

  // 単独語
  [/ミノー|MINNOW/i, 'ミノー'],
  [/クランク(?!ベイト)|CRANK(?!BAIT)/i, 'クランクベイト'],
  [/シャッド(?!テール)|SHAD(?!TAIL)/i, 'シャッド'],
  [/バイブレーション|VIBRATION/i, 'バイブレーション'],
  [/ポッパー|POPPER/i, 'ポッパー'],
  [/ペンシル(?!ベイト)|PENCIL(?!BAIT)/i, 'ペンシルベイト'],
  [/ペンシルベイト|PENCILBAIT|PENCIL\s*BAIT/i, 'ペンシルベイト'],
  [/フロッグ|FROG/i, 'フロッグ'],
  [/スプーン|SPOON/i, 'スプーン'],
  [/ワーム|WORM|ソフトベイト|SOFT\s*BAIT|SOFT\s*PLASTIC|グラブ|ストレート(?:ワーム)?テール|シャッドテール|カーリーテール|ホグ系|クロー系|ピンテール/i, 'ワーム'],
  [/エギ|餌木|SQUID\s*JIG/i, 'エギ'],
  [/タイラバ|鯛ラバ|TAI\s*RUBBER/i, 'タイラバ'],
  [/テンヤ/i, 'テンヤ'],
  [/インチク/i, 'インチク'],
  [/スッテ|SUTTE/i, 'スッテ'],
  [/ジグ(?!ヘッド)|JIG(?!\s*HEAD)/i, 'メタルジグ'],  // 最後に — 他のジグ系に該当しなかった場合
];

// nameのみでチェックするパターン（descriptionだと誤マッチが多いもの）
const NAME_ONLY_MAP: [RegExp, string][] = [
  [/ブレード|BLADE/i, 'ブレードベイト'],  // 名前に「ブレード」はブレードベイト
];

// ──────────────────────────────────────────────
// メーカー別デフォルトタイプ
// ──────────────────────────────────────────────
const MANUFACTURER_DEFAULT: Record<string, string> = {
  'hots': 'メタルジグ',        // オフショアジグメーカー
  // YAMASHITAはエギ以外にタコベイト・仕掛け系も多いのでデフォルトなし
};

// ──────────────────────────────────────────────
// 除外パターン（誤分類防止）
// ──────────────────────────────────────────────
// name/descriptionにこれがあったら、そのキーワードマッチを無効化
const EXCLUSION_CONTEXTS: [RegExp, string][] = [
  // 「ジグヘッドで使える」→ ワームの説明
  [/ジグヘッド(?:で|と|に|を|リグ)/i, 'ジグヘッド'],
  // 「ラバージグのトレーラー」→ ワームの説明
  [/ラバージグ(?:の|に|と).*(?:トレーラー|セット|装着)/i, 'ラバージグ'],
  // 「スピナーベイトのトレーラー」→ ワームの説明
  [/スピナーベイト(?:の|に|と).*(?:トレーラー|セット|装着)/i, 'スピナーベイト'],
  // 「ワーム素材」「ワーム一体型」→ ハードルアー
  [/ワーム(?:素材|一体型)/i, 'ワーム'],
  // 「ポッパー的な」→ 比喩/裏技表現
  [/ポッパー(?:的|のよう)/i, 'ポッパー'],
  // 「スプーン3枚」→ セット商品説明
  [/スプーン\d/i, 'スプーン'],
  // 「タイラバ」がアシストフック/スカート/パーツの説明
  [/(?:アシスト(?:フック|アイテム)|スペアパーツ|スカート|ネクタイ|替え針)/i, 'タイラバ'],
  // ジグのネクタイ/アシストもパーツ
  [/(?:アシスト(?:フック|アイテム)|スペアパーツ|スカート|ネクタイ)/i, 'メタルジグ'],
];

// ──────────────────────────────────────────────
// パーツ/アクセサリ除外（名前ベース）
// これらに該当するものは分類せず「その他」のまま
// ──────────────────────────────────────────────
const PARTS_PATTERNS: RegExp[] = [
  /スカート|ネクタイ|アシスト|フック|キーパー|パック|セット(?:商品|品)?$/i,
  /スペア|リペア|パーツ|替え針|替え鈎/i,
  /シリコンスカート/i,
];

// ──────────────────────────────────────────────
// 個別マッピング（slug単位で手動指定）
// ──────────────────────────────────────────────
const MANUAL_OVERRIDES: Record<string, string> = {
  // Tackle House
  'tacklehouse/rollingbait': 'バイブレーション',  // ローリングベイトはバイブレーション系
  'tacklehouse/elfin-shurinpu': 'クランクベイト',  // ディープダイビングクランク
  'tacklehouse/elfin-minigurasuhoppa': 'トップウォーター', // 虫系トップ

  // Gary Yamamoto
  'gary-yamamoto/grub-guard-gurabugado': '__SKIP__',  // フック/アクセサリ

  // Tackle House HOTS
  'hots/bigfin': 'インチク',  // タコ系/インチクルアー
};

// ──────────────────────────────────────────────
// 分類ロジック
// ──────────────────────────────────────────────
function classifyLure(
  name: string,
  description: string | null,
  manufacturerSlug: string,
  slug: string
): string | null {
  // -1. 手動オーバーライド
  const manualKey = `${manufacturerSlug}/${slug}`;
  if (MANUAL_OVERRIDES[manualKey]) {
    return MANUAL_OVERRIDES[manualKey] === '__SKIP__' ? null : MANUAL_OVERRIDES[manualKey];
  }

  // 0. パーツ/アクセサリ除外
  const nameAndDesc = `${name} ${description || ''}`;
  if (PARTS_PATTERNS.some(p => p.test(name))) {
    // 名前がパーツっぽい → 分類しない
    // ただしインチクやタイラバ本体は除外しない
    if (!/インチク|タイラバ|鯛ラバ|エギ|餌木/.test(name)) {
      return null;
    }
  }

  const text = nameAndDesc;

  // 1. name + description でキーワードチェック
  for (const [pattern, type] of KEYWORD_TYPE_MAP) {
    if (pattern.test(name) || (description && pattern.test(description))) {
      // 除外コンテキストチェック
      const excluded = EXCLUSION_CONTEXTS.some(
        ([excPattern, excType]) => excType === type && excPattern.test(text)
      );
      if (!excluded) return type;
    }
  }

  // 2. name限定キーワード
  for (const [pattern, type] of NAME_ONLY_MAP) {
    if (pattern.test(name)) return type;
  }

  // 3. メーカー別デフォルト
  if (MANUFACTURER_DEFAULT[manufacturerSlug]) {
    return MANUFACTURER_DEFAULT[manufacturerSlug];
  }

  // 分類不能
  return null;
}

// ──────────────────────────────────────────────
// メイン
// ──────────────────────────────────────────────
interface LureRecord {
  manufacturer_slug: string;
  slug: string;
  name: string;
  description: string | null;
}

async function fetchSonotaLures(): Promise<LureRecord[]> {
  const PAGE = 1000;
  const all: LureRecord[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb.from('lures')
      .select('manufacturer_slug, slug, name, description')
      .eq('type', 'その他')
      .range(from, from + PAGE - 1);

    if (error) {
      console.error(`Fetch error at offset ${from}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  console.log('=== type="その他" 再分類スクリプト ===\n');

  const lures = await fetchSonotaLures();
  console.log(`対象レコード: ${lures.length} 件\n`);

  // slug単位で重複排除（同じシリーズは1回だけ分類）
  const uniqueBySlug = new Map<string, LureRecord>();
  for (const l of lures) {
    const key = `${l.manufacturer_slug}/${l.slug}`;
    if (!uniqueBySlug.has(key)) {
      uniqueBySlug.set(key, l);
    }
  }
  console.log(`ユニークシリーズ: ${uniqueBySlug.size} 件\n`);

  // 分類実行
  const changes: { manufacturer_slug: string; slug: string; name: string; newType: string }[] = [];
  let unclassified = 0;

  for (const [, lure] of uniqueBySlug) {
    const newType = classifyLure(lure.name, lure.description, lure.manufacturer_slug, lure.slug);
    if (newType) {
      changes.push({
        manufacturer_slug: lure.manufacturer_slug,
        slug: lure.slug,
        name: lure.name,
        newType,
      });
    } else {
      unclassified++;
    }
  }

  // タイプ別に集計して表示
  const byType = new Map<string, typeof changes>();
  for (const c of changes) {
    if (!byType.has(c.newType)) byType.set(c.newType, []);
    byType.get(c.newType)!.push(c);
  }

  const sortedTypes = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [type, items] of sortedTypes) {
    console.log(`── ${type} (${items.length}シリーズ) ──`);
    // メーカー別にさらに集約して表示
    const byMfr = new Map<string, string[]>();
    for (const c of items) {
      if (!byMfr.has(c.manufacturer_slug)) byMfr.set(c.manufacturer_slug, []);
      byMfr.get(c.manufacturer_slug)!.push(c.name);
    }
    for (const [mfr, names] of [...byMfr.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${mfr}: ${names.length}件`);
      // 最大5件まで名前表示
      for (const n of names.slice(0, 5)) {
        console.log(`    - ${n}`);
      }
      if (names.length > 5) console.log(`    ... 他${names.length - 5}件`);
    }
    console.log('');
  }

  // サマリー
  console.log('── サマリー ──');
  for (const [type, items] of sortedTypes) {
    // 同一シリーズの全レコード数を計算
    const totalRecords = items.reduce((sum, c) => {
      return sum + lures.filter(l => l.manufacturer_slug === c.manufacturer_slug && l.slug === c.slug).length;
    }, 0);
    console.log(`  ${type}: ${items.length}シリーズ (${totalRecords}レコード)`);
  }
  console.log(`  分類不能（その他のまま）: ${unclassified}シリーズ`);
  console.log(`  合計分類: ${changes.length}シリーズ / ${uniqueBySlug.size}シリーズ`);

  // 全レコード数
  const totalRecordsToUpdate = changes.reduce((sum, c) => {
    return sum + lures.filter(l => l.manufacturer_slug === c.manufacturer_slug && l.slug === c.slug).length;
  }, 0);
  console.log(`  更新レコード数: ${totalRecordsToUpdate} / ${lures.length}\n`);

  // --apply モード
  if (APPLY) {
    console.log('── DB更新実行 ──');
    let updated = 0;
    let errors = 0;

    for (const c of changes) {
      const { error } = await sb.from('lures')
        .update({ type: c.newType })
        .eq('manufacturer_slug', c.manufacturer_slug)
        .eq('slug', c.slug);

      if (error) {
        console.error(`  ❌ ${c.manufacturer_slug}/${c.slug}: ${error.message}`);
        errors++;
      } else {
        updated++;
      }
    }
    console.log(`\n✅ 完了: ${updated}シリーズ更新, ${errors}件エラー`);
  } else {
    console.log('⚠️ dry-runモード: DBは更新されません');
    console.log('  実行するには: npx tsx scripts/_type-sonota-fix.ts --apply');
  }
}

main().catch(console.error);
