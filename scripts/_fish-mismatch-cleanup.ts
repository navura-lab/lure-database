/**
 * fish不一致エディトリアル削除スクリプト
 *
 * /tmp/editorial-verification.json のfish不一致112件を分析し、
 * メインターゲットが完全に間違っているエディトリアルを削除する。
 *
 * 判定基準:
 * - catchcopy/overviewの冒頭でDBにない魚種をメインターゲットとして記述 → 削除
 * - usage/strengthsでDBにない魚種の具体的な使い方を記述 → 削除
 * - 「〜も狙える」程度の言及 → 許容（削除しない）
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITORIALS_DIR = path.join(__dirname, '../src/data/seo/editorials');
const VERIFICATION_FILE = '/tmp/editorial-verification.json';
const OUTPUT_FILE = '/tmp/editorial-fish-deletions.json';

// 魚種キーワードパターン（メインターゲット判定用）
const FISH_KEYWORDS: Record<string, string[]> = {
  'シーバス': ['シーバス用', 'シーバスゲーム', 'シーバスミノー', 'シーバスルアー', 'シーバスフィッシング', 'シーバスブランド', 'シーバスアングラー', 'シーバス向け', 'シーバス専用'],
  'バス': ['バス用', 'バスフィッシング', 'バス釣り', 'バスルアー', 'バスアングラー', 'バス向け', 'バス専用'],
  'トラウト': ['トラウト用', 'トラウト向け', 'トラウトフィッシング', 'トラウトルアー', 'トラウトアングラー', 'エリアトラウト', 'ネイティブトラウト', 'トラウト専用'],
  'アジ': ['アジング', 'アジ用', 'アジ向け', 'アジ専用'],
  'メバル': ['メバリング', 'メバル用', 'メバル向け'],
  'タチウオ': ['タチウオ用', 'タチウオ向け', 'タチウオ専用'],
  'ヒラメ': ['ヒラメ用', 'ヒラメ向け', 'ヒラメ専用'],
  'マゴチ': ['マゴチ用', 'マゴチ向け', 'マゴチ専用'],
  'マダイ': ['マダイ用', 'マダイ向け', 'マダイ専用', 'タイラバ'],
  '青物': ['青物用', '青物向け', '青物専用'],
  'イカ': ['エギング', 'イカ用', 'イカ向け'],
  'サワラ': ['サワラ用', 'サワラ向け'],
};

// 「サブターゲット」として許容するパターン
const SUB_TARGET_PATTERNS = [
  'も狙える', 'も対応', 'にも効く', 'にも使える', 'にも対応',
  'まで幅広', 'から.*まで', 'だけでなく', 'に加えて',
  'の他にも', 'でも実績', 'でも使用', 'でも活躍',
];

interface VerificationData {
  issues: Array<{
    file: string;
    slug: string;
    manufacturerSlug: string;
    dbType: string;
    dbTargetFish: string[];
    problems: string[];
  }>;
}

interface DeletionResult {
  file: string;
  slug: string;
  manufacturerSlug: string;
  dbTargetFish: string[];
  reason: string;
  mentionedFish: string[];
}

function readEditorialFile(filename: string): string | null {
  const filepath = path.join(EDITORIALS_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, 'utf-8');
}

/**
 * エディトリアルのcatchcopy/overviewを抽出
 */
function extractMainContent(content: string): { catchcopy: string; overview: string } {
  // catchcopy抽出
  const catchcopyMatch = content.match(/catchcopy:\s*(?:'|`)([\s\S]*?)(?:'|`)/);
  // overview抽出（テンプレートリテラルまたはシングルクオート）
  const overviewMatch = content.match(/overview:\s*`([\s\S]*?)`/);

  return {
    catchcopy: catchcopyMatch?.[1] || '',
    overview: overviewMatch?.[1] || '',
  };
}

/**
 * DBのtarget_fishに含まれない魚種がメインターゲットとして書かれているか判定
 */
function isMainTargetWrong(
  content: string,
  dbTargetFish: string[],
  problems: string[]
): { shouldDelete: boolean; reason: string; mentionedFish: string[] } {
  const { catchcopy, overview } = extractMainContent(content);
  const mentionedFish: string[] = [];

  // DBのtarget_fishに含まれる魚種名（部分一致用）
  const dbFishNormalized = dbTargetFish.map(f => f.replace(/（.*?）/g, ''));

  // problemsから言及されている魚種を抽出
  const fishMentions = new Set<string>();
  for (const p of problems) {
    if (!p.includes('[FISH]')) continue;
    const match = p.match(/「(.*?)」/);
    if (match) {
      // 魚種名を特定
      for (const [fish] of Object.entries(FISH_KEYWORDS)) {
        if (match[1].includes(fish) || match[1].includes(fish.replace('バス', 'バス'))) {
          fishMentions.add(fish);
        }
      }
    }
  }

  // 言及されている魚種がDBのtarget_fishに含まれるか（部分一致）
  const wrongFish: string[] = [];
  for (const fish of fishMentions) {
    const isInDb = dbFishNormalized.some(dbf =>
      dbf.includes(fish) || fish.includes(dbf) ||
      (fish === 'バス' && dbf.includes('ブラックバス')) ||
      (fish === 'バス' && dbf.includes('バス')) ||
      (fish === 'アジ' && dbf.includes('アジ')) ||
      (fish === 'イカ' && dbf.includes('イカ'))
    );
    if (!isInDb) {
      wrongFish.push(fish);
    }
  }

  if (wrongFish.length === 0) {
    return { shouldDelete: false, reason: 'DBに含まれる魚種の言及のみ', mentionedFish: [] };
  }

  // catchcopy/overviewにメインターゲットとして書かれているか判定
  const mainText = catchcopy + '\n' + overview;

  // パターン1: catchcopy/overviewで「○○用」「○○ゲーム」等のメインターゲット表現
  for (const fish of wrongFish) {
    const mainKeywords = FISH_KEYWORDS[fish] || [];
    for (const kw of mainKeywords) {
      if (mainText.includes(kw)) {
        mentionedFish.push(fish);
        return {
          shouldDelete: true,
          reason: `catchcopy/overviewで「${kw}」をメインターゲットとして記述（DB: ${dbTargetFish.join(', ')}）`,
          mentionedFish: [...new Set(mentionedFish)],
        };
      }
    }
  }

  // パターン2: overview/catchcopyにはメイン記述がないが、strengths/usageで大量に言及
  // → problemsでoverviewやcatchcopyに言及がなくても、strengths/usageで3回以上言及 = 削除対象
  for (const fish of wrongFish) {
    const fishProblems = problems.filter(p =>
      p.includes('[FISH]') && p.includes(fish)
    );

    // usage/strengthsでの言及が多い（3件以上）
    const usageStrengthsMentions = fishProblems.filter(p =>
      p.includes('usage[') || p.includes('strengths[')
    );

    if (usageStrengthsMentions.length >= 3) {
      // サブターゲット表現かチェック
      const fileContent = content;
      let isSubTarget = false;
      for (const pattern of SUB_TARGET_PATTERNS) {
        const regex = new RegExp(fish + '.*?' + pattern + '|' + pattern + '.*?' + fish);
        if (regex.test(fileContent)) {
          isSubTarget = true;
          break;
        }
      }

      if (!isSubTarget) {
        mentionedFish.push(fish);
        return {
          shouldDelete: true,
          reason: `strengths/usageで「${fish}」を${usageStrengthsMentions.length}回具体的に言及（DB: ${dbTargetFish.join(', ')}）`,
          mentionedFish: [...new Set(mentionedFish)],
        };
      }
    }
  }

  // パターン3: overview/catchcopyにメイン記述があるが、サブターゲット表現
  // → 許容
  return {
    shouldDelete: false,
    reason: `サブターゲットとしての言及のみ（${wrongFish.join(', ')}）`,
    mentionedFish: wrongFish,
  };
}

async function main() {
  const data: VerificationData = JSON.parse(
    fs.readFileSync(VERIFICATION_FILE, 'utf-8')
  );

  // fish不一致のissuesを抽出
  const fishIssues = data.issues.filter(i =>
    i.problems.some(p => p.includes('[FISH]'))
  );

  console.log(`\nfish不一致: ${fishIssues.length}件を分析中...\n`);

  const deletions: DeletionResult[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];

  for (const issue of fishIssues) {
    const content = readEditorialFile(issue.file);
    if (!content) {
      console.log(`  [SKIP] ${issue.file} — ファイルが見つかりません`);
      skipped.push({ file: issue.file, reason: 'ファイルなし' });
      continue;
    }

    const fishProblems = issue.problems.filter(p => p.includes('[FISH]'));
    const result = isMainTargetWrong(content, issue.dbTargetFish, fishProblems);

    if (result.shouldDelete) {
      console.log(`  [DELETE] ${issue.file}`);
      console.log(`           理由: ${result.reason}`);
      deletions.push({
        file: issue.file,
        slug: issue.slug,
        manufacturerSlug: issue.manufacturerSlug,
        dbTargetFish: issue.dbTargetFish,
        reason: result.reason,
        mentionedFish: result.mentionedFish,
      });
    } else {
      console.log(`  [KEEP]   ${issue.file} — ${result.reason}`);
      skipped.push({ file: issue.file, reason: result.reason });
    }
  }

  console.log(`\n=== 結果 ===`);
  console.log(`削除対象: ${deletions.length}件`);
  console.log(`スキップ: ${skipped.length}件`);

  // 実際に削除
  let deletedCount = 0;
  for (const d of deletions) {
    const filepath = path.join(EDITORIALS_DIR, d.file);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      deletedCount++;
    }
  }
  console.log(`\n削除完了: ${deletedCount}件`);

  // 結果をJSONに保存
  const output = {
    processedAt: new Date().toISOString(),
    totalAnalyzed: fishIssues.length,
    deleted: deletions.length,
    skipped: skipped.length,
    deletions,
    skippedDetails: skipped,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n結果を ${OUTPUT_FILE} に保存しました`);
}

main().catch(console.error);
