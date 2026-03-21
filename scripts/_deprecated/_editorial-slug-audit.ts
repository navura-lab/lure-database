/**
 * エディトリアルslug → Supabase存在チェック
 *
 * 全エディトリアルファイルのslugがSupabaseのluresテーブルに存在するか一括チェック
 * 不一致のものは同メーカー内から類似slug候補を提案
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITORIALS_DIR = path.resolve(__dirname, '../src/data/seo/editorials');

interface EditorialInfo {
  filename: string;
  slug: string;
  manufacturerSlug: string;
  lureName: string;
}

// 全エディトリアルファイルからslug/manufacturerSlugを抽出
function extractEditorials(): EditorialInfo[] {
  const files = fs.readdirSync(EDITORIALS_DIR)
    .filter(f => f.endsWith('.ts') && !f.startsWith('_'));

  const editorials: EditorialInfo[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(EDITORIALS_DIR, file), 'utf-8');
    const slugMatch = content.match(/slug:\s*['"]([^'"]+)['"]/);
    const mfrMatch = content.match(/manufacturerSlug:\s*['"]([^'"]+)['"]/);
    const commentMatch = content.match(/\*\s*(.+?)エディトリアルレビュー/);

    if (slugMatch) {
      editorials.push({
        filename: file,
        slug: slugMatch[1],
        manufacturerSlug: mfrMatch ? mfrMatch[1] : '(不明)',
        lureName: commentMatch ? commentMatch[1].trim() : '',
      });
    } else {
      console.warn(`⚠️ slug抽出失敗: ${file}`);
    }
  }

  return editorials;
}

// DB全ユニークslugを取得（ページネーションで全件）
async function getAllUniqueSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  let total = 0;

  while (true) {
    const { data, error } = await supabase
      .from('lures')
      .select('slug')
      .range(from, from + pageSize - 1)
      .order('slug');

    if (error) {
      console.error(`Supabaseエラー (offset ${from}):`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      slugs.add(row.slug);
    }
    total += data.length;
    if (total % 10000 === 0) {
      process.stderr.write(`\r  DB slug読み込み中: ${total}行 → ${slugs.size}ユニーク`);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  process.stderr.write(`\r  DB slug読み込み完了: ${total}行 → ${slugs.size}ユニーク\n`);
  return slugs;
}

// メーカー別にDBのユニークslug+nameを取得
async function getManufacturerLures(mfrSlug: string): Promise<{ slug: string; name: string }[]> {
  const all: { slug: string; name: string }[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('lures')
      .select('slug, name')
      .eq('manufacturer_slug', mfrSlug)
      .range(from, from + pageSize - 1);

    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // ユニーク化
  const seen = new Set<string>();
  return all.filter(d => {
    if (seen.has(d.slug)) return false;
    seen.add(d.slug);
    return true;
  });
}

// 名前の正規化
function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[-_\s　]+/g, '')
    .replace(/[（）()]/g, '')
    .replace(/['"]/g, '')
    .replace(/ー/g, '')
    .replace(/\./g, '');
}

// 類似度スコア
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  const lcs = longestCommonSubstring(na, nb);
  return lcs / Math.max(na.length, nb.length);
}

function longestCommonSubstring(a: string, b: string): number {
  let max = 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > max) max = dp[i][j];
      }
    }
  }
  return max;
}

async function main() {
  console.log('=== エディトリアルslug監査 ===\n');

  // 1. ファイルからslug抽出
  const editorials = extractEditorials();
  console.log(`📁 エディトリアルファイル数: ${editorials.length}\n`);

  // 2. DB全ユニークslug取得
  console.log('Supabaseから全slug取得中...');
  const dbSlugs = await getAllUniqueSlugs();

  // 3. 分類
  const matched: EditorialInfo[] = [];
  const mismatched: EditorialInfo[] = [];

  for (const ed of editorials) {
    if (dbSlugs.has(ed.slug)) {
      matched.push(ed);
    } else {
      mismatched.push(ed);
    }
  }

  console.log(`\n✅ マッチ: ${matched.length}/${editorials.length}`);
  console.log(`❌ 不一致: ${mismatched.length}/${editorials.length}\n`);

  if (mismatched.length === 0) {
    console.log('🎉 全slugがSupabaseに存在します！');
    return;
  }

  // 4. 不一致のメーカー別グルーピング
  const byMfr = new Map<string, EditorialInfo[]>();
  for (const m of mismatched) {
    const list = byMfr.get(m.manufacturerSlug) || [];
    list.push(m);
    byMfr.set(m.manufacturerSlug, list);
  }

  // 5. 類似slug検索
  const results: {
    editorial: EditorialInfo;
    candidates: { slug: string; name: string; score: number }[];
  }[] = [];

  let processedMfrs = 0;
  const totalMfrs = byMfr.size;

  for (const [mfr, items] of byMfr) {
    processedMfrs++;
    if (processedMfrs % 10 === 0) {
      process.stderr.write(`\r  メーカー処理中: ${processedMfrs}/${totalMfrs}`);
    }

    const dbLures = await getManufacturerLures(mfr);

    for (const item of items) {
      const searchTerm = item.slug.replace(/^[a-z]+-/, '');
      const lureName = item.lureName || item.slug;

      const candidates = dbLures
        .map(d => ({
          slug: d.slug,
          name: d.name,
          score: Math.max(
            similarity(item.slug, d.slug),
            similarity(lureName, d.name),
            similarity(searchTerm, d.slug),
            similarity(searchTerm, d.name),
          ),
        }))
        .filter(c => c.score >= 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      results.push({ editorial: item, candidates });
    }
  }
  process.stderr.write('\n');

  // 6. レポート出力
  const withCandidates = results.filter(r => r.candidates.length > 0);
  const noCandidates = results.filter(r => r.candidates.length === 0);

  const highConfidence = withCandidates.filter(r => r.candidates[0].score >= 0.7);
  const lowConfidence = withCandidates.filter(r => r.candidates[0].score < 0.7);

  console.log('\n=== 詳細レポート ===\n');
  console.log(`⚠️ 高確度マッチ (score >= 0.7): ${highConfidence.length}件`);
  console.log(`🔍 低確度マッチ (score < 0.7): ${lowConfidence.length}件`);
  console.log(`❓ 候補なし: ${noCandidates.length}件\n`);

  // 高確度マッチ一覧
  if (highConfidence.length > 0) {
    console.log('--- ⚠️ 高確度マッチ（slugを修正すべき） ---\n');
    for (const r of highConfidence.sort((a, b) => b.candidates[0].score - a.candidates[0].score)) {
      const c = r.candidates[0];
      console.log(`  ${r.editorial.filename}`);
      console.log(`    現slug: "${r.editorial.slug}" (${r.editorial.manufacturerSlug})`);
      console.log(`    → 候補: "${c.slug}" (${c.name}) [score: ${c.score.toFixed(2)}]`);
      if (r.candidates.length > 1) {
        for (const alt of r.candidates.slice(1)) {
          console.log(`      他: "${alt.slug}" (${alt.name}) [${alt.score.toFixed(2)}]`);
        }
      }
    }
  }

  // 低確度マッチ
  if (lowConfidence.length > 0) {
    console.log('\n--- 🔍 低確度マッチ（要手動確認） ---\n');
    const lcByMfr = new Map<string, typeof lowConfidence>();
    for (const r of lowConfidence) {
      const list = lcByMfr.get(r.editorial.manufacturerSlug) || [];
      list.push(r);
      lcByMfr.set(r.editorial.manufacturerSlug, list);
    }
    for (const [mfr, items] of [...lcByMfr.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  📦 ${mfr} (${items.length}件)`);
      for (const r of items) {
        const c = r.candidates[0];
        console.log(`    ${r.editorial.slug} → "${c.slug}" (${c.name}) [${c.score.toFixed(2)}]`);
      }
    }
  }

  // 候補なし
  if (noCandidates.length > 0) {
    console.log('\n--- ❓ 候補なし（DBに存在しない可能性） ---\n');
    const ncByMfr = new Map<string, typeof noCandidates>();
    for (const r of noCandidates) {
      const list = ncByMfr.get(r.editorial.manufacturerSlug) || [];
      list.push(r);
      ncByMfr.set(r.editorial.manufacturerSlug, list);
    }
    for (const [mfr, items] of [...ncByMfr.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  📦 ${mfr} (${items.length}件)`);
      for (const r of items) {
        console.log(`    ${r.editorial.slug} (${r.editorial.lureName || '-'})`);
      }
    }
  }

  // サマリー
  console.log('\n\n=== サマリー ===');
  console.log(`総ファイル数: ${editorials.length}`);
  console.log(`✅ 完全マッチ: ${matched.length} (${(matched.length / editorials.length * 100).toFixed(1)}%)`);
  console.log(`❌ 不一致: ${mismatched.length} (${(mismatched.length / editorials.length * 100).toFixed(1)}%)`);
  console.log(`  ⚠️ 高確度マッチ: ${highConfidence.length} (自動修正可能)`);
  console.log(`  🔍 低確度マッチ: ${lowConfidence.length} (手動確認要)`);
  console.log(`  ❓ 候補なし: ${noCandidates.length} (DBに存在しない?)`);
}

main().catch(console.error);
