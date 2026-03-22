/**
 * 既存記事の機械的ファクトチェック
 *
 * チェック項目:
 * 1. 禁止ワード・根拠なし断言パターン検出
 * 2. 記事タイプ別の問題分類
 * 3. 問題レベルの判定 → 全削除 or 修正対象の仕分け
 *
 * 出力: logs/article-audit-YYYY-MM-DD.json + .md
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const ARTICLES_DIR = join(import.meta.dirname, '..', 'src', 'data', 'articles');

// ====== 禁止・問題ワードパターン ======
const CRITICAL_PATTERNS = [
  // CLAUDE.mdで明示的に禁止されているワード
  { pattern: /爆釣/g, category: 'banned_word', severity: 'critical' as const, reason: 'CLAUDE.md禁止ワード' },
  { pattern: /激アツ/g, category: 'banned_word', severity: 'critical' as const, reason: 'CLAUDE.md禁止ワード' },
  { pattern: /マスト/g, category: 'banned_word', severity: 'critical' as const, reason: 'CLAUDE.md禁止ワード' },
  { pattern: /ヤバい/g, category: 'banned_word', severity: 'critical' as const, reason: 'CLAUDE.md禁止ワード' },
  { pattern: /間違いなし/g, category: 'banned_word', severity: 'critical' as const, reason: 'CLAUDE.md禁止ワード' },
  { pattern: /神ルアー/g, category: 'banned_word', severity: 'critical' as const, reason: 'CLAUDE.md禁止ワード' },
];

const UNSUPPORTED_CLAIM_PATTERNS = [
  // 根拠なし断言パターン
  { pattern: /最強[のな]/g, category: 'unsupported_claim', severity: 'high' as const, reason: '「最強」は根拠なしで使用不可' },
  { pattern: /不動の人気/g, category: 'unsupported_claim', severity: 'high' as const, reason: '人気の根拠データがない' },
  { pattern: /圧倒的[なに]/g, category: 'unsupported_claim', severity: 'high' as const, reason: '比較根拠がない' },
  { pattern: /唯一無二/g, category: 'unsupported_claim', severity: 'medium' as const, reason: '他サイト引用の受け売りの可能性' },
  { pattern: /もはや餌/g, category: 'unsupported_claim', severity: 'medium' as const, reason: '他サイト引用の受け売り' },
  { pattern: /ほぼ確実に/g, category: 'unsupported_claim', severity: 'high' as const, reason: '釣りに確実はない' },
  { pattern: /絶対的/g, category: 'unsupported_claim', severity: 'high' as const, reason: '根拠なし断言' },
  { pattern: /王道中の王道/g, category: 'unsupported_claim', severity: 'high' as const, reason: '根拠なし断言' },
  { pattern: /史上最[もっと]/g, category: 'unsupported_claim', severity: 'high' as const, reason: '売上データなしで使用不可' },
  { pattern: /実釣データに基づ[くいき]/g, category: 'unsupported_claim', severity: 'high' as const, reason: '実釣データの出典がない' },
  { pattern: /販売実績に基づ[くいき]/g, category: 'unsupported_claim', severity: 'high' as const, reason: '販売実績データの出典がない' },
  { pattern: /狂わせる/g, category: 'unsupported_claim', severity: 'medium' as const, reason: '根拠のない誇張' },
  { pattern: /折り紙つき/g, category: 'unsupported_claim', severity: 'medium' as const, reason: '根拠のない評価' },
  { pattern: /鉄板[のだで]/g, category: 'unsupported_claim', severity: 'low' as const, reason: '根拠のない断言（文脈次第）' },
  { pattern: /定番[のだで]/g, category: 'unsupported_claim', severity: 'low' as const, reason: '根拠のない断言（文脈次第）' },
  { pattern: /一軍[のだで]/g, category: 'unsupported_claim', severity: 'low' as const, reason: '根拠のない断言' },
  { pattern: /即買い/g, category: 'unsupported_claim', severity: 'medium' as const, reason: '購入誘導' },
  { pattern: /おすすめ[だで]/g, category: 'unsupported_claim', severity: 'low' as const, reason: '根拠なしの推奨（文脈次第）' },
];

const EXTERNAL_QUOTE_PATTERNS = [
  // 他サイト引用（独自検証なしの受け売り判定）
  { pattern: /のインプレ(記事|)では/g, category: 'external_quote', severity: 'medium' as const, reason: '他サイトインプレの引用（独自検証なし）' },
  { pattern: /との(報告|評価)が(ある|複数|多い)/g, category: 'external_quote', severity: 'medium' as const, reason: '出典不明の報告引用' },
  { pattern: /と(評|表現)されている/g, category: 'external_quote', severity: 'low' as const, reason: '他サイト引用（出典不明）' },
  { pattern: /TSURI\s*HACK/g, category: 'external_quote', severity: 'medium' as const, reason: '他サイト名の直接言及' },
  { pattern: /ルアーのすすめ/g, category: 'external_quote', severity: 'medium' as const, reason: '他サイト名の直接言及' },
  { pattern: /シーバスラボラトリー/g, category: 'external_quote', severity: 'medium' as const, reason: '他サイト名の直接言及' },
];

const ALL_PATTERNS = [
  ...CRITICAL_PATTERNS,
  ...UNSUPPORTED_CLAIM_PATTERNS,
  ...EXTERNAL_QUOTE_PATTERNS,
];

// ====== 記事タイプ定義 ======
type ArticleCategory = 'vs' | 'review' | 'color-guide' | 'selection-guide' | 'howto' | 'other';

function categorize(slug: string, fileContent: string): ArticleCategory {
  if (slug.includes('-vs-')) return 'vs';
  if (slug.includes('-review')) return 'review';
  if (slug.includes('-color') || fileContent.includes("type: 'color-guide'")) return 'color-guide';
  if (fileContent.includes("type: 'selection-guide'")) return 'selection-guide';
  if (fileContent.includes("type: 'howto'")) return 'howto';
  return 'other';
}

// ====== メイン処理 ======
interface Finding {
  pattern: string;
  category: string;
  severity: string;
  reason: string;
  context: string; // 前後20文字含む
  line: number;
}

interface ArticleAudit {
  slug: string;
  category: ArticleCategory;
  findings: Finding[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  totalScore: number; // critical*10 + high*5 + medium*2 + low*1
  verdict: 'DELETE' | 'REWRITE' | 'MINOR_FIX' | 'OK';
}

function auditArticle(slug: string, filePath: string): ArticleAudit {
  const content = readFileSync(filePath, 'utf-8');
  const category = categorize(slug, content);
  const lines = content.split('\n');
  const findings: Finding[] = [];

  for (const patternDef of ALL_PATTERNS) {
    // 各行をチェック
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      while ((match = regex.exec(line)) !== null) {
        const start = Math.max(0, match.index - 20);
        const end = Math.min(line.length, match.index + match[0].length + 20);
        const context = line.slice(start, end).trim();
        findings.push({
          pattern: match[0],
          category: patternDef.category,
          severity: patternDef.severity,
          reason: patternDef.reason,
          context,
          line: i + 1,
        });
      }
    }
  }

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const highCount = findings.filter(f => f.severity === 'high').length;
  const mediumCount = findings.filter(f => f.severity === 'medium').length;
  const lowCount = findings.filter(f => f.severity === 'low').length;
  const totalScore = criticalCount * 10 + highCount * 5 + mediumCount * 2 + lowCount * 1;

  let verdict: ArticleAudit['verdict'];
  if (criticalCount > 0 || totalScore >= 20) {
    verdict = 'DELETE';
  } else if (highCount > 0 || totalScore >= 10) {
    verdict = 'REWRITE';
  } else if (mediumCount > 0 || totalScore >= 3) {
    verdict = 'MINOR_FIX';
  } else {
    verdict = 'OK';
  }

  // vs記事・review記事は全てREWRITE以上（構造的に問題がある）
  if ((category === 'vs' || category === 'review') && verdict === 'OK') {
    verdict = 'REWRITE';
  }
  if ((category === 'vs' || category === 'review') && verdict === 'MINOR_FIX') {
    verdict = 'REWRITE';
  }

  return { slug, category, findings, criticalCount, highCount, mediumCount, lowCount, totalScore, verdict };
}

// ====== 実行 ======
const files = readdirSync(ARTICLES_DIR)
  .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
  .sort();

const results: ArticleAudit[] = [];

for (const file of files) {
  const slug = basename(file, '.ts');
  const filePath = join(ARTICLES_DIR, file);
  results.push(auditArticle(slug, filePath));
}

// ====== 集計 ======
const deleteCount = results.filter(r => r.verdict === 'DELETE').length;
const rewriteCount = results.filter(r => r.verdict === 'REWRITE').length;
const minorFixCount = results.filter(r => r.verdict === 'MINOR_FIX').length;
const okCount = results.filter(r => r.verdict === 'OK').length;

const byCategory = {
  vs: results.filter(r => r.category === 'vs'),
  review: results.filter(r => r.category === 'review'),
  'color-guide': results.filter(r => r.category === 'color-guide'),
  'selection-guide': results.filter(r => r.category === 'selection-guide'),
  howto: results.filter(r => r.category === 'howto'),
  other: results.filter(r => r.category === 'other'),
};

// ====== Markdown出力 ======
const today = new Date().toISOString().slice(0, 10);
const logsDir = join(import.meta.dirname, '..', 'logs');
mkdirSync(logsDir, { recursive: true });

let md = `# 記事監査レポート (${today})\n\n`;
md += `## サマリ\n\n`;
md += `| 判定 | 件数 | 割合 |\n|------|------|------|\n`;
md += `| DELETE（全削除） | ${deleteCount} | ${(deleteCount / results.length * 100).toFixed(1)}% |\n`;
md += `| REWRITE（書き直し） | ${rewriteCount} | ${(rewriteCount / results.length * 100).toFixed(1)}% |\n`;
md += `| MINOR_FIX（軽微修正） | ${minorFixCount} | ${(minorFixCount / results.length * 100).toFixed(1)}% |\n`;
md += `| OK | ${okCount} | ${(okCount / results.length * 100).toFixed(1)}% |\n`;
md += `| **合計** | **${results.length}** | |\n\n`;

md += `## カテゴリ別\n\n`;
md += `| カテゴリ | 件数 | DELETE | REWRITE | MINOR_FIX | OK |\n|---------|------|--------|---------|-----------|----|\n`;
for (const [cat, items] of Object.entries(byCategory)) {
  if (items.length === 0) continue;
  md += `| ${cat} | ${items.length} | ${items.filter(i => i.verdict === 'DELETE').length} | ${items.filter(i => i.verdict === 'REWRITE').length} | ${items.filter(i => i.verdict === 'MINOR_FIX').length} | ${items.filter(i => i.verdict === 'OK').length} |\n`;
}

md += `\n## DELETE対象 (${deleteCount}件)\n\n`;
for (const r of results.filter(r => r.verdict === 'DELETE').sort((a, b) => b.totalScore - a.totalScore)) {
  md += `### ${r.slug} (score: ${r.totalScore})\n`;
  md += `カテゴリ: ${r.category} | critical: ${r.criticalCount} high: ${r.highCount} medium: ${r.mediumCount} low: ${r.lowCount}\n\n`;
  for (const f of r.findings.filter(f => f.severity === 'critical' || f.severity === 'high')) {
    md += `- **[${f.severity}]** \`${f.pattern}\` — ${f.reason}\n  > ...${f.context}...\n`;
  }
  md += '\n';
}

md += `\n## REWRITE対象 (${rewriteCount}件)\n\n`;
for (const r of results.filter(r => r.verdict === 'REWRITE').sort((a, b) => b.totalScore - a.totalScore)) {
  md += `- **${r.slug}** (${r.category}, score: ${r.totalScore})`;
  const highFindings = r.findings.filter(f => f.severity === 'high');
  if (highFindings.length > 0) {
    md += ` — ${highFindings.map(f => f.pattern).join(', ')}`;
  }
  md += '\n';
}

md += `\n## MINOR_FIX対象 (${minorFixCount}件)\n\n`;
for (const r of results.filter(r => r.verdict === 'MINOR_FIX').sort((a, b) => b.totalScore - a.totalScore)) {
  md += `- **${r.slug}** (${r.category}, score: ${r.totalScore}) — ${r.findings.map(f => f.pattern).join(', ')}\n`;
}

md += `\n## OK (${okCount}件)\n\n`;
for (const r of results.filter(r => r.verdict === 'OK')) {
  md += `- ${r.slug}\n`;
}

// ====== ファイル出力 ======
writeFileSync(join(logsDir, `article-audit-${today}.md`), md);
writeFileSync(join(logsDir, `article-audit-${today}.json`), JSON.stringify(results, null, 2));

// ====== コンソール出力 ======
console.log(`\n=== 記事監査結果 (${today}) ===\n`);
console.log(`DELETE:     ${deleteCount}件 (${(deleteCount / results.length * 100).toFixed(1)}%)`);
console.log(`REWRITE:    ${rewriteCount}件 (${(rewriteCount / results.length * 100).toFixed(1)}%)`);
console.log(`MINOR_FIX:  ${minorFixCount}件 (${(minorFixCount / results.length * 100).toFixed(1)}%)`);
console.log(`OK:         ${okCount}件 (${(okCount / results.length * 100).toFixed(1)}%)`);
console.log(`\n合計: ${results.length}件`);
console.log(`\nレポート: logs/article-audit-${today}.md`);
