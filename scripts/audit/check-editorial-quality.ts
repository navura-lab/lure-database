/**
 * エディトリアル品質チェックスクリプト
 *
 * 禁止ワード検出 + FACT/PERSPECTIVE混在検出 + 文末パターン重複検出
 *
 * Usage:
 *   npx tsx scripts/audit/check-editorial-quality.ts              # 全件チェック
 *   npx tsx scripts/audit/check-editorial-quality.ts --recent 20  # 最新20件
 *   npx tsx scripts/audit/check-editorial-quality.ts --file slug  # 特定ファイル
 */

import fs from 'fs';
import path from 'path';

const EDITORIAL_DIR = path.join(process.cwd(), 'src/data/seo/editorials');

// 禁止ワードリスト
const BANNED_WORDS = [
  { pattern: /最高の|究極の|間違いなく|絶対に|まさに/g, label: '根拠なき最上級表現' },
  { pattern: /と言えるでしょう|ではないでしょうか/g, label: 'AI敬語' },
  { pattern: /いかがでしたでしょうか|参考になれば幸いです/g, label: 'AI定型文' },
  { pattern: /コスパ最強/g, label: '根拠なし断言' },
  { pattern: /初心者から上級者まで/g, label: '思考停止ワード' },
  { pattern: /してみてはいかがでしょうか/g, label: 'AI定型文' },
  { pattern: /おすすめです！/g, label: '感嘆符付き推薦' },
  { pattern: /爆釣|激アツ|マスト|ヤバい|神ルアー/g, label: 'CLAUDE.md禁止ワード' },
];

// FACT/PERSPECTIVE混在パターン（1文にFactとPerspectiveが混在）
const MIXED_PATTERNS = [
  { pattern: /を搭載しており.{0,20}(最高|最強|抜群|圧倒的)/g, label: 'FACT+誇張混在' },
  { pattern: /\d+(mm|g|oz).{0,30}(間違いない|最高|究極)/g, label: 'スペック+誇張混在' },
];

// 文末パターン重複検出
function checkEndingRepetition(text: string): string[] {
  const sentences = text.split(/[。\n]/).filter(s => s.trim().length > 5);
  const endings: string[] = [];
  const issues: string[] = [];

  for (const s of sentences) {
    const trimmed = s.trim();
    const ending = trimmed.slice(-10);
    endings.push(ending);
  }

  // 3連続同じ文末パターン検出
  for (let i = 0; i < endings.length - 2; i++) {
    const suffix3 = endings[i].slice(-3);
    if (endings[i + 1].endsWith(suffix3) && endings[i + 2].endsWith(suffix3)) {
      issues.push(`文末「${suffix3}」が3回以上連続（${i + 1}文目〜）`);
    }
  }

  return issues;
}

interface QualityIssue {
  file: string;
  slug: string;
  issues: { label: string; match: string; location: string }[];
}

function checkFile(filePath: string): QualityIssue | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const slug = path.basename(filePath, '.ts');
  const issues: { label: string; match: string; location: string }[] = [];

  // 禁止ワードチェック
  for (const rule of BANNED_WORDS) {
    const matches = content.match(rule.pattern);
    if (matches) {
      for (const m of matches) {
        // 変数名やコメント内は除外
        if (content.indexOf(`'${m}'`) !== -1 || content.indexOf(`"${m}"`) !== -1) continue;
        issues.push({ label: rule.label, match: m, location: 'テキスト内' });
      }
    }
  }

  // FACT/PERSPECTIVE混在チェック
  for (const rule of MIXED_PATTERNS) {
    const matches = content.match(rule.pattern);
    if (matches) {
      for (const m of matches) {
        issues.push({ label: rule.label, match: m.slice(0, 40), location: 'テキスト内' });
      }
    }
  }

  // 文末パターン重複チェック（overview, strengths, usage内）
  const textBlocks = content.match(/`[^`]{50,}`/g) || [];
  for (const block of textBlocks) {
    const endingIssues = checkEndingRepetition(block);
    for (const issue of endingIssues) {
      issues.push({ label: '文末重複', match: issue, location: 'テンプレートリテラル内' });
    }
  }

  return issues.length > 0 ? { file: path.basename(filePath), slug, issues } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const recentN = args.includes('--recent') ? parseInt(args[args.indexOf('--recent') + 1]) || 20 : 0;
  const targetFile = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

  let files = fs.readdirSync(EDITORIAL_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'huggos.ts' && !f.startsWith('_'));

  if (targetFile) {
    files = files.filter(f => f.includes(targetFile));
  }

  if (recentN > 0) {
    // 更新日時順でソートして最新N件
    files = files
      .map(f => ({ name: f, mtime: fs.statSync(path.join(EDITORIAL_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, recentN)
      .map(f => f.name);
  }

  console.log(`=== エディトリアル品質チェック ===`);
  console.log(`対象: ${files.length}件\n`);

  let totalIssues = 0;
  let filesWithIssues = 0;

  for (const file of files) {
    const result = checkFile(path.join(EDITORIAL_DIR, file));
    if (result) {
      filesWithIssues++;
      totalIssues += result.issues.length;
      console.log(`❌ ${result.slug}`);
      for (const issue of result.issues) {
        console.log(`   [${issue.label}] ${issue.match}`);
      }
    }
  }

  console.log(`\n=== 結果 ===`);
  console.log(`チェック: ${files.length}件`);
  console.log(`問題あり: ${filesWithIssues}件 (${totalIssues}個の問題)`);
  console.log(`問題なし: ${files.length - filesWithIssues}件`);
}

main().catch(console.error);
