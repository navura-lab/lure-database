/**
 * エディトリアルレビュー × Supabase type 整合性チェック
 *
 * 各エディトリアル .ts ファイルから slug と本文を抽出し、
 * Supabase の type と矛盾がないか検証する。
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

const EDITORIALS_DIR = path.resolve(
  __dirname_local,
  '../src/data/seo/editorials',
);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ---- ルアータイプのキーワードマッピング ----
// エディトリアル本文中に現れるキーワードから推測されるタイプ
const TYPE_KEYWORDS: Record<string, string[]> = {
  'ミノー': ['ミノー', 'ジャークベイト', 'minnow', 'jerkbait'],
  'クランクベイト': ['クランクベイト', 'クランク', 'crankbait', 'crank'],
  'バイブレーション': ['バイブレーション', 'vibration', 'バイブ'],
  'スピナーベイト': ['スピナーベイト', 'spinnerbait'],
  'バズベイト': ['バズベイト', 'buzzbait'],
  'スプーン': ['スプーン', 'spoon'],
  'メタルジグ': ['メタルジグ', 'ジグ', 'metal jig', 'jig'],
  'ワーム': ['ワーム', 'ソフトベイト', 'ソフトルアー', 'worm', 'soft bait', 'グラブ', 'ストレート', 'シャッドテール', 'ホッグ', 'クロー', 'クリーチャー', 'カーリーテール', 'スティックベイト'],
  'ポッパー': ['ポッパー', 'popper'],
  'ペンシルベイト': ['ペンシルベイト', 'ペンシル', 'pencil bait', 'pencil'],
  'フロッグ': ['フロッグ', 'frog'],
  'ラバージグ': ['ラバージグ', 'rubber jig', 'ジグヘッド'],
  'シンキングペンシル': ['シンキングペンシル', 'シンペン', 'sinking pencil'],
  'ビッグベイト': ['ビッグベイト', 'big bait', 'ジョイント'],
  'スイムベイト': ['スイムベイト', 'swimbait'],
  'タイラバ': ['タイラバ', '鯛ラバ', 'tai rubber', 'タイカブラ'],
  'インチク': ['インチク'],
  'エギ': ['エギ', 'エギング', 'squid jig'],
  'トップウォーター': ['トップウォーター', 'topwater', 'ドッグウォーク', 'バド'],
  'チャターベイト': ['チャターベイト', 'chatterbait', 'ブレーデッドジグ'],
  'メタルバイブ': ['メタルバイブ', 'metal vibe', '鉄板バイブ'],
  'スピンテール': ['スピンテール', 'スピンテールジグ', 'spin tail'],
  'プラグ': ['プラグ'],
  'ジグヘッド': ['ジグヘッド', 'jighead'],
};

// type名の正規化（Supabase上の表記ゆれ対応）
function normalizeType(t: string): string {
  const map: Record<string, string> = {
    'minnow': 'ミノー',
    'crankbait': 'クランクベイト',
    'vibration': 'バイブレーション',
    'spinnerbait': 'スピナーベイト',
    'buzzbait': 'バズベイト',
    'spoon': 'スプーン',
    'metal jig': 'メタルジグ',
    'worm': 'ワーム',
    'soft bait': 'ワーム',
    'popper': 'ポッパー',
    'pencil bait': 'ペンシルベイト',
    'frog': 'フロッグ',
    'rubber jig': 'ラバージグ',
    'sinking pencil': 'シンキングペンシル',
    'big bait': 'ビッグベイト',
    'swimbait': 'スイムベイト',
    'topwater': 'トップウォーター',
    'chatterbait': 'チャターベイト',
    'metal vibe': 'メタルバイブ',
    'spin tail': 'スピンテール',
    'plug': 'プラグ',
    'jighead': 'ジグヘッド',
  };
  return map[t.toLowerCase()] || t;
}

// ---- エディトリアルファイルを解析 ----
interface EditorialInfo {
  filename: string;
  slug: string;
  manufacturerSlug: string;
  catchcopy: string;
  fullText: string; // catchcopy + overview + strengths を結合したもの
}

function parseEditorialFile(filepath: string): EditorialInfo | null {
  const content = fs.readFileSync(filepath, 'utf-8');
  const filename = path.basename(filepath);

  // slug
  const slugMatch = content.match(/slug:\s*['"]([^'"]+)['"]/);
  if (!slugMatch) return null;

  // manufacturerSlug
  const mfgMatch = content.match(/manufacturerSlug:\s*['"]([^'"]+)['"]/);

  // catchcopy
  const catchMatch = content.match(/catchcopy:\s*['"`]([^'"`]+)['"`]/);

  // overview (テンプレートリテラルも対応)
  const overviewMatch = content.match(/overview:\s*`([\s\S]*?)`/);

  // strengths の title と body をまとめて取得
  const strengthMatches = [...content.matchAll(/title:\s*['"`]([^'"`]+)['"`][\s\S]*?body:\s*`([\s\S]*?)`/g)];
  const strengthsText = strengthMatches.map(m => `${m[1]} ${m[2]}`).join('\n');

  // usage
  const usageMatches = [...content.matchAll(/scene:\s*['"`]([^'"`]+)['"`][\s\S]*?body:\s*`([\s\S]*?)`/g)];
  const usageText = usageMatches.map(m => `${m[1]} ${m[2]}`).join('\n');

  // concerns
  const concernsMatch = content.match(/concerns:\s*\[([\s\S]*?)\]/);
  const concernsText = concernsMatch ? concernsMatch[1] : '';

  const fullText = [
    catchMatch?.[1] || '',
    overviewMatch?.[1] || '',
    strengthsText,
    usageText,
    concernsText,
  ].join('\n');

  return {
    filename,
    slug: slugMatch[1],
    manufacturerSlug: mfgMatch?.[1] || '',
    catchcopy: catchMatch?.[1] || '',
    fullText,
  };
}

// ---- 本文からタイプを推測 ----
function inferTypeFromText(text: string): string[] {
  const found: string[] = [];
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        found.push(type);
        break;
      }
    }
  }
  return found;
}

// ---- 互換性チェック ----
// あるDBタイプとエディトリアル内容が矛盾するかどうか
function isTypeConflict(dbType: string, inferredTypes: string[], fullText: string): { conflict: boolean; reason: string } {
  const normalized = normalizeType(dbType);

  // エディトリアルから何も推測できない場合はスキップ
  if (inferredTypes.length === 0) {
    return { conflict: false, reason: '' };
  }

  // DBタイプが推測タイプに含まれていればOK
  if (inferredTypes.includes(normalized)) {
    return { conflict: false, reason: '' };
  }

  // 互換とみなすペア
  const compatible: Record<string, string[]> = {
    'ミノー': ['シンキングペンシル', 'プラグ', 'ペンシルベイト'],
    'シンキングペンシル': ['ミノー', 'プラグ', 'ペンシルベイト'],
    'ペンシルベイト': ['ミノー', 'シンキングペンシル', 'トップウォーター', 'プラグ'],
    'クランクベイト': ['プラグ', 'ミノー'],
    'バイブレーション': ['メタルバイブ', 'プラグ'],
    'メタルバイブ': ['バイブレーション', 'メタルジグ'],
    'メタルジグ': ['メタルバイブ', 'スプーン', 'スピンテール', 'ジグヘッド'],
    'ポッパー': ['トップウォーター', 'プラグ'],
    'トップウォーター': ['ポッパー', 'ペンシルベイト', 'フロッグ', 'バズベイト', 'プラグ'],
    'スイムベイト': ['ビッグベイト', 'ワーム'],
    'ビッグベイト': ['スイムベイト', 'プラグ'],
    'スピナーベイト': ['バズベイト', 'チャターベイト'],
    'チャターベイト': ['スピナーベイト'],
    'タイラバ': ['インチク', 'メタルジグ'],
    'インチク': ['タイラバ', 'メタルジグ'],
    'ワーム': ['スイムベイト', 'ラバージグ'],
    'ラバージグ': ['ワーム', 'メタルジグ', 'ジグヘッド'],
    'スプーン': ['メタルジグ'],
    'フロッグ': ['トップウォーター'],
    'プラグ': ['ミノー', 'クランクベイト', 'バイブレーション', 'ポッパー', 'ペンシルベイト', 'シンキングペンシル', 'トップウォーター', 'ビッグベイト'],
    'エギ': [],
    'スピンテール': ['メタルジグ', 'メタルバイブ', 'バイブレーション'],
    'ジグヘッド': ['ワーム', 'メタルジグ', 'ラバージグ'],
  };

  const compatibleTypes = compatible[normalized] || [];

  // 推測タイプのどれかが互換ならOK
  for (const it of inferredTypes) {
    if (compatibleTypes.includes(it)) {
      return { conflict: false, reason: '' };
    }
  }

  // 本文中にDBタイプ名が明示的に言及されている場合はOK（例: 概要で「〜はバイブレーションルアーだ」）
  if (fullText.includes(normalized)) {
    return { conflict: false, reason: '' };
  }

  return {
    conflict: true,
    reason: `DB: ${dbType} (${normalized}) だがエディトリアルは [${inferredTypes.join(', ')}] を示唆`,
  };
}

async function main() {
  // 1. エディトリアルファイルを全件読み込み
  const files = fs.readdirSync(EDITORIALS_DIR)
    .filter(f => f.endsWith('.ts') && !f.startsWith('_') && f !== 'huggos.ts')
    .map(f => path.join(EDITORIALS_DIR, f));

  console.log(`📂 エディトリアルファイル数: ${files.length}`);

  const editorials: EditorialInfo[] = [];
  for (const f of files) {
    const info = parseEditorialFile(f);
    if (info) editorials.push(info);
  }
  console.log(`✅ 解析成功: ${editorials.length} 件`);

  // 2. Supabaseから全slugのtype情報を取得（1slugずつ or 小バッチ+ページング）
  const slugs = editorials.map(e => e.slug);
  const batchSize = 30; // 1slugあたり複数行あるのでバッチを小さく
  const dbRecords = new Map<string, { type: string; name: string }>();

  for (let i = 0; i < slugs.length; i += batchSize) {
    const batch = slugs.slice(i, i + batchSize);
    // ページング: 最大1000行を取得（30 slug × 平均カラー数 で十分）
    const { data, error } = await supabase
      .from('lures')
      .select('slug, type, name')
      .in('slug', batch)
      .limit(5000);

    if (error) {
      console.error(`❌ Supabase エラー (batch ${i}):`, error);
      continue;
    }
    for (const row of data || []) {
      // 同一slugは最初の1件だけ（typeは同一のはず）
      if (!dbRecords.has(row.slug)) {
        dbRecords.set(row.slug, { type: row.type || '(null)', name: row.name });
      }
    }
    if ((i / batchSize) % 5 === 0) {
      process.stdout.write(`  ... ${Math.min(i + batchSize, slugs.length)}/${slugs.length} slugs queried\n`);
    }
  }
  console.log(`📊 Supabase レコード取得: ${dbRecords.size} 件`);

  // slug が見つからないもの
  const notFound = editorials.filter(e => !dbRecords.has(e.slug));
  if (notFound.length > 0) {
    console.log(`\n⚠️ Supabase に存在しないslug (${notFound.length}件):`);
    for (const e of notFound) {
      console.log(`  - ${e.filename}: slug="${e.slug}"`);
    }
  }

  // 3. 矛盾チェック
  interface Mismatch {
    filename: string;
    slug: string;
    dbType: string;
    dbName: string;
    inferredTypes: string[];
    reason: string;
    catchcopy: string;
  }

  const mismatches: Mismatch[] = [];
  let checkedCount = 0;
  let nullTypeCount = 0;

  for (const ed of editorials) {
    const db = dbRecords.get(ed.slug);
    if (!db) continue;

    if (db.type === '(null)' || !db.type) {
      nullTypeCount++;
      continue;
    }

    checkedCount++;
    const inferredTypes = inferTypeFromText(ed.fullText);
    const { conflict, reason } = isTypeConflict(db.type, inferredTypes, ed.fullText);

    if (conflict) {
      mismatches.push({
        filename: ed.filename,
        slug: ed.slug,
        dbType: db.type,
        dbName: db.name,
        inferredTypes,
        reason,
        catchcopy: ed.catchcopy,
      });
    }
  }

  console.log(`\n========================================`);
  console.log(`📋 チェック結果`);
  console.log(`========================================`);
  console.log(`チェック対象: ${checkedCount} 件`);
  console.log(`type NULL: ${nullTypeCount} 件`);
  console.log(`矛盾検出: ${mismatches.length} 件`);

  if (mismatches.length > 0) {
    console.log(`\n----------------------------------------`);
    console.log(`矛盾リスト`);
    console.log(`----------------------------------------`);
    for (const m of mismatches) {
      console.log(`\n📍 ${m.filename}`);
      console.log(`   slug: ${m.slug}`);
      console.log(`   DB name: ${m.dbName}`);
      console.log(`   DB type: ${m.dbType}`);
      console.log(`   推測type: [${m.inferredTypes.join(', ')}]`);
      console.log(`   理由: ${m.reason}`);
      console.log(`   catchcopy: ${m.catchcopy}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`完了`);
  console.log(`========================================`);
}

main().catch(console.error);
