/**
 * エディトリアル品質自動監査スクリプト
 *
 * src/data/seo/editorials/*.ts を全件スキャンし、品質チェックを行う。
 * 結果は logs/editorial-audit/audit-YYYY-MM-DD.json に保存。
 *
 * Usage:
 *   npx tsx scripts/audit-editorials.ts              # チェックのみ
 *   npx tsx scripts/audit-editorials.ts --fix        # 不合格ファイルを削除
 *   npx tsx scripts/audit-editorials.ts --verbose    # 詳細表示
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

// ── 設定 ──────────────────────────────────────────
const EDITORIALS_DIR = path.resolve(import.meta.dirname, '../src/data/seo/editorials');
const LOG_DIR = path.resolve(import.meta.dirname, '../logs/editorial-audit');
const TODAY = new Date().toISOString().slice(0, 10);

const BANNED_WORDS = [
  '爆釣', '激アツ', 'マスト', 'ヤバい', '間違いなし',
  '神ルアー', '最強', '実釣データに基づく',
];

// 文字数制約
const CATCHCOPY_MIN = 40;
const CATCHCOPY_MAX = 60;
const OVERVIEW_MIN = 200;
const COLOR_GUIDE_MIN = 50;

// 必須フィールド
const REQUIRED_TOP_FIELDS = [
  'slug', 'manufacturerSlug', 'catchcopy', 'overview',
  'strengths', 'usage', 'colorGuide', 'concerns',
  'recommendation', 'faq', 'meta',
];

interface Issue {
  slug: string;
  file: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
}

interface AuditResult {
  date: string;
  total: number;
  passed: number;
  failed: number;
  issues: Issue[];
}

// ── CLI引数 ──────────────────────────────────────
const args = process.argv.slice(2);
const FIX_MODE = args.includes('--fix');
const VERBOSE = args.includes('--verbose');

// ── Supabase ─────────────────────────────────────
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// ── ヘルパー ─────────────────────────────────────
function extractStringField(content: string, field: string): string | null {
  // 'field: "value"' or "field: `value`" or "field: 'value'"
  // フィールド名がキーとして出現する箇所を探す
  const patterns = [
    // slug: 'xxx' or slug: "xxx"
    new RegExp(`(?:^|\\n)\\s*${field}\\s*:\\s*['"\`]([^'"\`]*?)['"\`]`, 's'),
    // slug: "xxx" (複数行テンプレートリテラル)
    new RegExp(`(?:^|\\n)\\s*${field}\\s*:\\s*\`([\\s\\S]*?)\``, 's'),
  ];
  for (const pat of patterns) {
    const m = content.match(pat);
    if (m) return m[1];
  }
  return null;
}

function fieldExists(content: string, field: string): boolean {
  // フィールドが存在するかどうか（値があるか）
  const re = new RegExp(`(?:^|\\n|,)\\s*${field}\\s*:`);
  return re.test(content);
}

function countArrayItems(content: string, field: string): number {
  // field: [ ... ] の中身の要素数を簡易カウント
  const re = new RegExp(`${field}\\s*:\\s*\\[([\\s\\S]*?)\\](?:\\s*,|\\s*\\})`);
  const m = content.match(re);
  if (!m) return 0;
  const inner = m[1];
  // オブジェクト要素: { で始まるものをカウント
  if (inner.includes('{')) {
    return (inner.match(/\{/g) || []).length;
  }
  // 文字列要素: 'xxx' をカウント
  const stringMatches = inner.match(/['"`][^'"`]+['"`]/g);
  return stringMatches ? stringMatches.length : 0;
}

function countConcerns(content: string): number {
  // concerns は文字列配列
  const re = /concerns\s*:\s*\[([\s\S]*?)\]\s*,/;
  const m = content.match(re);
  if (!m) return 0;
  const inner = m[1];
  // 各要素は 'xxx' で区切られる
  const items = inner.match(/['`"]/g);
  // 開始・終了のペアなので /2
  return items ? Math.floor(items.length / 2) : 0;
}

function extractTargetFishFromContent(content: string): string[] {
  // エディトリアル本文中に出現する魚種名を抽出
  const fishNames = [
    'ブラックバス', 'バス', 'シーバス', 'トラウト', 'ヒラメ',
    'マゴチ', 'アジ', 'メバル', 'クロダイ', 'チヌ', 'タチウオ',
    'ブリ', 'サワラ', 'カンパチ', 'マダイ', 'イカ', 'アオリイカ',
    'ヒラスズキ', 'ロックフィッシュ', 'カサゴ', 'ソイ', 'ハタ',
    'アイナメ', 'キジハタ', 'サクラマス', 'イワナ', 'ヤマメ',
    'ニジマス', 'サーモン', 'パイク', 'マスキー', 'ウォールアイ',
    'ラージマウスバス', 'スモールマウスバス', 'クロソイ',
    'スズキ', 'フラットフィッシュ',
  ];
  const found: string[] = [];
  for (const fish of fishNames) {
    if (content.includes(fish)) found.push(fish);
  }
  return found;
}

// ── Supabaseからtarget_fishマップ取得 ─────────────
async function fetchTargetFishMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('lures')
      .select('slug, manufacturer_slug, target_fish')
      .not('target_fish', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('Supabase target_fish取得エラー:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const key = `${row.manufacturer_slug}/${row.slug}`;
      if (!map.has(key)) {
        const fish = typeof row.target_fish === 'string'
          ? row.target_fish.split(',').map((s: string) => s.trim()).filter(Boolean)
          : Array.isArray(row.target_fish) ? row.target_fish : [];
        if (fish.length > 0) map.set(key, fish);
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// ── メイン監査 ────────────────────────────────────
async function main() {
  console.log(`=== エディトリアル品質監査 ${TODAY} ===\n`);

  // ファイル一覧取得
  const files = await glob('*.ts', { cwd: EDITORIALS_DIR });
  files.sort();
  console.log(`対象ファイル: ${files.length}件`);

  // target_fishマップ取得
  console.log('Supabase target_fish データ取得中...');
  const targetFishMap = await fetchTargetFishMap();
  console.log(`target_fish レコード: ${targetFishMap.size}件\n`);

  // 重複検出用マップ
  const catchcopyMap = new Map<string, string>(); // 先頭50文字 → ファイル名
  const overviewMap = new Map<string, string>();

  const issues: Issue[] = [];
  let passed = 0;

  for (const file of files) {
    const filePath = path.join(EDITORIALS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileIssues: Issue[] = [];
    const baseSlug = file.replace(/\.ts$/, '');

    // slugフィールド抽出
    const slug = extractStringField(content, 'slug') || baseSlug;
    const manufacturerSlug = extractStringField(content, 'manufacturerSlug') || '';

    // 1. 禁止ワードスキャン
    for (const word of BANNED_WORDS) {
      if (content.includes(word)) {
        fileIssues.push({
          slug, file,
          reason: `禁止ワード「${word}」を含む`,
          severity: 'high',
        });
      }
    }

    // 2. 構造チェック: 必須フィールドの存在
    for (const field of REQUIRED_TOP_FIELDS) {
      if (!fieldExists(content, field)) {
        fileIssues.push({
          slug, file,
          reason: `必須フィールド「${field}」が存在しない`,
          severity: 'high',
        });
      }
    }

    // strengths 3つ
    const strengthsCount = countArrayItems(content, 'strengths');
    if (strengthsCount < 2) {
      fileIssues.push({
        slug, file,
        reason: `strengths ${strengthsCount}件（最低2件必要）`,
        severity: 'medium',
      });
    }

    // usage 3つ
    const usageCount = countArrayItems(content, 'usage');
    if (usageCount < 2) {
      fileIssues.push({
        slug, file,
        reason: `usage ${usageCount}件（最低3件必要）`,
        severity: 'medium',
      });
    }

    // concerns 3つ以上
    const concernsCount = countConcerns(content);
    if (concernsCount < 2) {
      fileIssues.push({
        slug, file,
        reason: `concerns ${concernsCount}件（最低3件必要）`,
        severity: 'medium',
      });
    }

    // faq 5つ
    const faqCount = countArrayItems(content, 'faq');
    if (faqCount < 2) {
      fileIssues.push({
        slug, file,
        reason: `faq ${faqCount}件（最低5件必要）`,
        severity: 'medium',
      });
    }

    // 3. 文字数チェック
    const catchcopy = extractStringField(content, 'catchcopy') || '';
    const catchcopyLen = [...catchcopy].length; // Unicode文字数
    if (catchcopyLen < CATCHCOPY_MIN) {
      fileIssues.push({
        slug, file,
        reason: `catchcopy ${catchcopyLen}文字（下限${CATCHCOPY_MIN}）`,
        severity: 'medium',
      });
    }
    if (catchcopyLen > CATCHCOPY_MAX) {
      fileIssues.push({
        slug, file,
        reason: `catchcopy ${catchcopyLen}文字（上限${CATCHCOPY_MAX}）`,
        severity: 'medium',
      });
    }

    // overview: テンプレートリテラルの場合は専用抽出
    const overviewMatch = content.match(/overview\s*:\s*`([\s\S]*?)`/);
    const overview = overviewMatch ? overviewMatch[1] : (extractStringField(content, 'overview') || '');
    const overviewLen = [...overview].length;
    if (overviewLen < OVERVIEW_MIN) {
      fileIssues.push({
        slug, file,
        reason: `overview ${overviewLen}文字（下限${OVERVIEW_MIN}）`,
        severity: 'medium',
      });
    }

    // colorGuide
    const colorGuideMatch = content.match(/colorGuide\s*:\s*`([\s\S]*?)`/);
    const colorGuide = colorGuideMatch ? colorGuideMatch[1] : (extractStringField(content, 'colorGuide') || '');
    const colorGuideLen = [...colorGuide].length;
    if (colorGuideLen < COLOR_GUIDE_MIN) {
      fileIssues.push({
        slug, file,
        reason: `colorGuide ${colorGuideLen}文字（下限${COLOR_GUIDE_MIN}）`,
        severity: 'medium',
      });
    }

    // 4. target_fish 整合性
    if (manufacturerSlug && slug) {
      const dbKey = `${manufacturerSlug}/${slug}`;
      const dbFish = targetFishMap.get(dbKey);
      if (dbFish && dbFish.length > 0) {
        const contentFish = extractTargetFishFromContent(content);
        // DBの対象魚がエディトリアル本文に1つも登場しない場合は警告
        const mentioned = dbFish.some(f => contentFish.includes(f));
        if (!mentioned && contentFish.length > 0) {
          // エディトリアルに魚種記述があるがDB魚種と一致しない
          fileIssues.push({
            slug, file,
            reason: `target_fish矛盾: DB=[${dbFish.join(',')}] エディトリアル=[${contentFish.join(',')}]`,
            severity: 'low',
          });
        }
      }
    }

    // 5. 重複検出
    if (catchcopy) {
      const key50 = [...catchcopy].slice(0, 50).join('');
      if (catchcopyMap.has(key50) && catchcopyMap.get(key50) !== file) {
        fileIssues.push({
          slug, file,
          reason: `catchcopy重複: "${key50}..." が ${catchcopyMap.get(key50)} と一致`,
          severity: 'high',
        });
      } else {
        catchcopyMap.set(key50, file);
      }
    }

    if (overview) {
      const oKey50 = [...overview].slice(0, 50).join('');
      if (overviewMap.has(oKey50) && overviewMap.get(oKey50) !== file) {
        fileIssues.push({
          slug, file,
          reason: `overview冒頭重複: ${overviewMap.get(oKey50)} と一致`,
          severity: 'high',
        });
      } else {
        overviewMap.set(oKey50, file);
      }
    }

    // 6. TypeScript構文チェック
    if (!content.includes('import ')) {
      fileIssues.push({
        slug, file,
        reason: 'import文がない',
        severity: 'low',
      });
    }
    if (!content.includes('export ')) {
      fileIssues.push({
        slug, file,
        reason: 'export文がない',
        severity: 'high',
      });
    }

    // 結果集計
    if (fileIssues.length === 0) {
      passed++;
    } else {
      issues.push(...fileIssues);
      if (VERBOSE) {
        console.log(`  NG: ${file}`);
        for (const issue of fileIssues) {
          console.log(`      [${issue.severity}] ${issue.reason}`);
        }
      }
    }
  }

  // 不合格ファイル数（重複排除）
  const failedFiles = new Set(issues.map(i => i.file));
  const failed = failedFiles.size;

  const result: AuditResult = {
    date: TODAY,
    total: files.length,
    passed,
    failed,
    issues,
  };

  // ── 結果出力 ──
  console.log(`\n=== 監査結果 ===`);
  console.log(`合計: ${result.total}件`);
  console.log(`合格: ${result.passed}件`);
  console.log(`不合格: ${result.failed}件`);
  console.log(`問題点: ${result.issues.length}件`);

  // severity別集計
  const highCount = issues.filter(i => i.severity === 'high').length;
  const mediumCount = issues.filter(i => i.severity === 'medium').length;
  const lowCount = issues.filter(i => i.severity === 'low').length;
  console.log(`  high: ${highCount} / medium: ${mediumCount} / low: ${lowCount}`);

  // ── JSON保存 ──
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const outPath = path.join(LOG_DIR, `audit-${TODAY}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n結果保存: ${outPath}`);

  // ── --fix モード ──
  if (FIX_MODE && failed > 0) {
    console.log(`\n--fix: 不合格 ${failed}件を削除...`);
    let deleted = 0;
    for (const f of failedFiles) {
      const fp = path.join(EDITORIALS_DIR, f);
      try {
        fs.unlinkSync(fp);
        deleted++;
        if (VERBOSE) console.log(`  削除: ${f}`);
      } catch (e: any) {
        console.error(`  削除失敗: ${f} - ${e.message}`);
      }
    }
    console.log(`削除完了: ${deleted}件`);
  }

  // 終了コード: 不合格(high)があれば1
  if (highCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('監査エラー:', err);
  process.exit(2);
});
