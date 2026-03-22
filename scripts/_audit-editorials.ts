/**
 * エディトリアル内容の正確性チェック v1
 *
 * 検出ロジック（今後追加していく）:
 *
 * Rule 1: usage/situationとDB descriptionの矛盾
 *   - エディトリアルが「バチ抜け」と書いてるが、公式descriptionにバチの言及なし
 *   - エディトリアルが「サーフ」と書いてるが、公式descriptionにサーフの言及なし
 *   etc.
 *
 * Rule 2: 対象魚の矛盾
 *   - エディトリアルがシーバス用と書いてるが、DBのtarget_fishにシーバスなし
 *
 * Rule 3: type由来のテンプレ推測検出
 *   - auto-editorial.tsのTYPE_TEMPLATESのsituationsがそのまま使われてないか
 *   - テンプレ文言がそのまま入ってたら「検証なしのテンプレ推測」として検出
 *
 * Rule 4: サイズ/重量と用途の矛盾
 *   - 60g以上のルアーに「バチ抜け」「ライトゲーム」等
 *   - 3g以下のルアーに「ショアジギング」「青物」等
 *
 * 出力: 問題件数と具体例
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const EDITORIALS_DIR = join(import.meta.dirname, '..', 'src', 'data', 'seo', 'editorials');

// ====== キャッシュからDBデータ取得 ======
interface LureRow {
  slug: string;
  name: string;
  type: string;
  target_fish: string[];
  description: string;
  weight_g: number | null;
  length_mm: number | null;
  manufacturer_slug: string;
}

function loadLureData(): Map<string, LureRow[]> {
  const raw = JSON.parse(readFileSync('.cache/lures.json', 'utf-8'));
  const bySlug = new Map<string, LureRow[]>();
  for (const r of raw) {
    const existing = bySlug.get(r.slug) || [];
    existing.push(r);
    bySlug.set(r.slug, existing);
  }
  return bySlug;
}

// ====== エディトリアルからテキスト抽出 ======
function extractEditorialText(filePath: string): { slug: string; fullText: string; usageTexts: string[] } {
  const content = readFileSync(filePath, 'utf-8');

  // slug抽出
  const slugMatch = content.match(/slug:\s*'([^']+)'/);
  const slug = slugMatch?.[1] || basename(filePath, '.ts');

  // usage/scene テキスト抽出
  const usageTexts: string[] = [];
  const sceneRegex = /scene:\s*'([^']+)'/g;
  let m;
  while ((m = sceneRegex.exec(content)) !== null) {
    usageTexts.push(m[1]);
  }

  return { slug, fullText: content, usageTexts };
}

// ====== 検出ルール ======

interface Finding {
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detail: string;
  editorial_says: string;
  db_says: string;
}

// --- Rule 1: 用途キーワードとdescriptionの矛盾 ---
const USAGE_KEYWORDS = [
  { keyword: 'バチ', label: 'バチ抜け', description_required: /バチ|バチ抜|BACHI/i },
  { keyword: 'エギング', label: 'エギング', description_required: /エギ|イカ|アオリ|EGING/i },
  { keyword: 'アジング', label: 'アジング', description_required: /アジ|アジング|AJING/i },
  { keyword: 'メバリング', label: 'メバリング', description_required: /メバル|メバリング|MEBARING/i },
  { keyword: 'タイラバ', label: 'タイラバ', description_required: /タイラバ|マダイ|鯛|TAIRABA/i },
  { keyword: 'ヒラメ', label: 'ヒラメ狙い', description_required: /ヒラメ|フラットフィッシュ|HIRAME|FLATFISH|サーフ/i },
];

function checkRule1(fullText: string, dbRows: LureRow[]): Finding[] {
  const findings: Finding[] = [];
  const desc = dbRows.map(r => r.description || '').join(' ');
  const name = dbRows[0]?.name || '';
  const type = dbRows[0]?.type || '';

  for (const uk of USAGE_KEYWORDS) {
    if (fullText.includes(uk.keyword) && !uk.description_required.test(desc) && !uk.description_required.test(name)) {
      findings.push({
        rule: 'Rule1:用途矛盾',
        severity: 'high',
        detail: `エディトリアルが「${uk.label}」に言及しているが、公式descriptionに関連語なし`,
        editorial_says: uk.label,
        db_says: `type=${type}, description先頭80字: ${desc.slice(0, 80)}`,
      });
    }
  }
  return findings;
}

// --- Rule 2: 対象魚の矛盾 ---
const FISH_KEYWORDS = [
  { keyword: 'シーバス', fish: ['シーバス', 'スズキ'] },
  { keyword: 'ブラックバス', fish: ['ブラックバス', 'バス'] },
  { keyword: '青物', fish: ['青物', 'ブリ', 'ヒラマサ', 'カンパチ'] },
  { keyword: 'トラウト', fish: ['トラウト', 'ニジマス', 'ヤマメ', 'イワナ'] },
  { keyword: 'アジ', fish: ['アジ'] },
  { keyword: 'メバル', fish: ['メバル', 'ロックフィッシュ'] },
  { keyword: 'イカ', fish: ['イカ', 'アオリイカ'] },
];

function checkRule2(fullText: string, dbRows: LureRow[]): Finding[] {
  const findings: Finding[] = [];
  const dbFish = new Set(dbRows.flatMap(r => r.target_fish || []));

  for (const fk of FISH_KEYWORDS) {
    // エディトリアルのusage/sceneに魚種言及がある
    const editorialMentions = fullText.includes(`${fk.keyword}狙い`) ||
      fullText.includes(`${fk.keyword}ゲーム`) ||
      fullText.includes(`${fk.keyword}アングラー`);

    if (editorialMentions && !fk.fish.some(f => dbFish.has(f))) {
      // descriptionにも言及がないかチェック
      const desc = dbRows.map(r => r.description || '').join(' ');
      const descHasFish = fk.fish.some(f => desc.includes(f));
      if (!descHasFish) {
        findings.push({
          rule: 'Rule2:対象魚矛盾',
          severity: 'medium',
          detail: `エディトリアルが「${fk.keyword}」向けと記述しているが、DBのtarget_fishにもdescriptionにも言及なし`,
          editorial_says: `${fk.keyword}向け`,
          db_says: `target_fish=${[...dbFish].join(',')}`,
        });
      }
    }
  }
  return findings;
}

// --- Rule 3: テンプレ文言そのまま検出 ---
const TEMPLATE_PHRASES = [
  // auto-editorial.tsのTYPE_TEMPLATES.situationsから
  { phrase: 'バチ抜けでの使用に適している', source: 'シンキングペンシルテンプレ' },
  { phrase: '河口のシーバスでの使用に適している', source: 'シンキングペンシルテンプレ' },
  { phrase: 'サーフのヒラメでの使用に適している', source: 'シンキングペンシルテンプレ' },
  { phrase: '朝マヅメでの使用に適している', source: 'ペンシルベイトテンプレ' },
  { phrase: 'リップラップでの使用に適している', source: 'クランクベイトテンプレ' },
  { phrase: 'ショアジギングでの使用に適している', source: 'メタルジグテンプレ' },
  { phrase: '管理釣り場での使用に適している', source: 'スプーンテンプレ' },
  { phrase: 'カバー撃ちでの使用に適している', source: 'ワーム/ラバージグテンプレ' },
  { phrase: 'バスのビッグベイトゲームでの使用に適している', source: 'ジョイントベイトテンプレ' },
  { phrase: 'リリーパッドでの使用に適している', source: 'フロッグテンプレ' },
  { phrase: '濁りでの使用に適している', source: 'スピナーベイトテンプレ' },
];

function checkRule3(fullText: string): Finding[] {
  const findings: Finding[] = [];
  for (const tp of TEMPLATE_PHRASES) {
    if (fullText.includes(tp.phrase)) {
      findings.push({
        rule: 'Rule3:テンプレ文言',
        severity: 'low',
        detail: `auto-editorial.tsのテンプレ文言がそのまま使用されている（${tp.source}）`,
        editorial_says: tp.phrase,
        db_says: '(テンプレ由来のため個別検証なし)',
      });
    }
  }
  return findings;
}

// --- Rule 4: サイズ/重量と用途の矛盾 ---
function checkRule4(fullText: string, dbRows: LureRow[]): Finding[] {
  const findings: Finding[] = [];
  const weights = dbRows.map(r => r.weight_g).filter((w): w is number => w != null);
  const maxWeight = Math.max(...weights, 0);
  const minWeight = Math.min(...weights, Infinity);

  // 60g以上のルアーにバチ/ライトゲーム/アジング/メバリング
  if (maxWeight >= 40) {
    const lightTerms = ['バチ抜け', 'ライトゲーム', 'アジング', 'メバリング', 'フィネス'];
    for (const term of lightTerms) {
      if (fullText.includes(term)) {
        findings.push({
          rule: 'Rule4:重量矛盾',
          severity: 'critical',
          detail: `${maxWeight}gのルアーに「${term}」は不適切`,
          editorial_says: term,
          db_says: `max_weight=${maxWeight}g`,
        });
      }
    }
  }

  // 5g以下のルアーにショアジギング/青物
  if (maxWeight > 0 && maxWeight <= 5) {
    const heavyTerms = ['ショアジギング', '青物', 'ジギング'];
    for (const term of heavyTerms) {
      if (fullText.includes(term)) {
        findings.push({
          rule: 'Rule4:重量矛盾',
          severity: 'critical',
          detail: `${maxWeight}gのルアーに「${term}」は不適切`,
          editorial_says: term,
          db_says: `max_weight=${maxWeight}g`,
        });
      }
    }
  }

  return findings;
}

// ====== メイン実行 ======
async function main() {
  console.log('DBデータ読み込み中...');
  const lureData = loadLureData();
  console.log(`DB: ${lureData.size} シリーズ`);

  const editorialFiles = readdirSync(EDITORIALS_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'huggos.ts'); // huggosは型定義

  console.log(`エディトリアル: ${editorialFiles.length} 件\n`);

  interface AuditResult {
    slug: string;
    file: string;
    findings: Finding[];
    score: number;
  }

  const results: AuditResult[] = [];
  let totalFindings = 0;

  for (const file of editorialFiles) {
    const filePath = join(EDITORIALS_DIR, file);
    const { slug, fullText, usageTexts } = extractEditorialText(filePath);

    // DBデータ取得
    const dbRows = lureData.get(slug) || [];

    const findings: Finding[] = [];

    if (dbRows.length > 0) {
      findings.push(...checkRule1(fullText, dbRows));
      findings.push(...checkRule2(fullText, dbRows));
      findings.push(...checkRule4(fullText, dbRows));
    }

    findings.push(...checkRule3(fullText));

    if (findings.length > 0) {
      const score = findings.reduce((sum, f) => {
        const w = { critical: 10, high: 5, medium: 2, low: 1 }[f.severity];
        return sum + w;
      }, 0);
      results.push({ slug, file, findings, score });
      totalFindings += findings.length;
    }
  }

  // ソート: スコア降順
  results.sort((a, b) => b.score - a.score);

  // ====== レポート出力 ======
  const today = new Date().toISOString().slice(0, 10);

  const bySeverity = {
    critical: results.flatMap(r => r.findings).filter(f => f.severity === 'critical').length,
    high: results.flatMap(r => r.findings).filter(f => f.severity === 'high').length,
    medium: results.flatMap(r => r.findings).filter(f => f.severity === 'medium').length,
    low: results.flatMap(r => r.findings).filter(f => f.severity === 'low').length,
  };

  const byRule = results.flatMap(r => r.findings).reduce((acc, f) => {
    acc[f.rule] = (acc[f.rule] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`=== エディトリアル監査結果 (${today}) ===\n`);
  console.log(`検出ファイル: ${results.length}/${editorialFiles.length} (${(results.length / editorialFiles.length * 100).toFixed(1)}%)`);
  console.log(`検出数合計: ${totalFindings}`);
  console.log(`\n重要度別:`);
  console.log(`  critical: ${bySeverity.critical}`);
  console.log(`  high:     ${bySeverity.high}`);
  console.log(`  medium:   ${bySeverity.medium}`);
  console.log(`  low:      ${bySeverity.low}`);
  console.log(`\nルール別:`);
  Object.entries(byRule).sort((a, b) => b[1] - a[1]).forEach(([rule, count]) => {
    console.log(`  ${rule}: ${count}`);
  });

  // Top 20
  console.log(`\n--- Top 20 問題ファイル ---`);
  for (const r of results.slice(0, 20)) {
    const dbRows = lureData.get(r.slug);
    const name = dbRows?.[0]?.name || r.slug;
    console.log(`\n[score=${r.score}] ${name} (${r.file})`);
    for (const f of r.findings) {
      console.log(`  [${f.severity}] ${f.rule}: ${f.detail}`);
    }
  }

  // JSON出力
  mkdirSync('logs', { recursive: true });
  writeFileSync(
    join('logs', `editorial-audit-${today}.json`),
    JSON.stringify({ summary: { total: editorialFiles.length, flagged: results.length, bySeverity, byRule }, results }, null, 2),
  );
  console.log(`\nJSON: logs/editorial-audit-${today}.json`);
}

main().catch(console.error);
