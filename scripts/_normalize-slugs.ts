/**
 * slug正規化スクリプト
 *
 * 全ルアーのslugを `lowercase-alphanumeric-dash` 形式に統一する。
 * 対象: 数値slug、日本語slug、アンダースコア、大文字、URLエンコード
 *
 * wanakanaでカタカナ/ひらがな→ローマ字変換を行う。
 * 漢字は除去しASCII部分のみ使用。
 *
 * 使い方:
 *   npx tsx scripts/_normalize-slugs.ts --dry-run   # 変更プレビュー
 *   npx tsx scripts/_normalize-slugs.ts              # 実行
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { toRomaji, isKana } from 'wanakana';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run');

// ─── 日本語文字をローマ字に変換（カタカナ・ひらがな対応） ───
function romanize(text: string): string {
  // 文字ごとに処理: カナはローマ字化、漢字は除去、ASCIIはそのまま
  let result = '';
  let kanaBuffer = '';

  for (const char of text) {
    if (isKana(char)) {
      kanaBuffer += char;
    } else {
      // カナバッファをフラッシュ
      if (kanaBuffer) {
        const romaji = toRomaji(kanaBuffer);
        // カナ→ASCII文字遷移時にハイフン挿入（単語境界）
        const isAlphaNum = /[a-zA-Z0-9]/.test(char);
        result += romaji + (isAlphaNum ? '-' : '');
        kanaBuffer = '';
      }
      // 漢字判定（CJK Unified Ideographs）
      const code = char.charCodeAt(0);
      if (code >= 0x4E00 && code <= 0x9FFF) {
        // 漢字は除去（ハイフンで区切る）
        result += '-';
      } else {
        result += char;
      }
    }
  }
  // 末尾のカナバッファをフラッシュ
  if (kanaBuffer) {
    result += toRomaji(kanaBuffer);
  }

  // 長音の簡略化（oo→o, aa→a, uu→u, ii→i, ee→e）
  // URLの可読性向上のため
  result = result
    .replace(/oo/g, 'o')
    .replace(/aa/g, 'a')
    .replace(/uu/g, 'u')
    .replace(/ii/g, 'i')
    .replace(/ee/g, 'e')
    .replace(/ou/g, 'o');

  return result;
}

// ─── slug正規化関数 ───
function normalizeSlug(name: string): string {
  // 全角→半角変換（英数字）
  let s = name.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );

  // よくあるUnicode記号の置換
  s = s
    .replace(/[Ⅱ]/g, '2')
    .replace(/[Ⅲ]/g, '3')
    .replace(/[Ⅳ]/g, '4')
    .replace(/[×✕]/g, 'x')
    .replace(/[・•]/g, '-')
    .replace(/[＃#]/g, '')
    .replace(/[！!？?]/g, '')
    .replace(/['＇'']/g, '')
    .replace(/[＆&]/g, 'and')
    .replace(/[＋+]/g, 'plus')
    .replace(/[／/]/g, '-')
    .replace(/[（(）)]/g, '')
    .replace(/[【】\[\]]/g, '')
    .replace(/[　\s]+/g, '-');

  // カタカナ・ひらがな→ローマ字変換
  s = romanize(s);

  // 小文字化
  s = s.toLowerCase();

  // 残った非ASCII文字を除去
  s = s.replace(/[^\x20-\x7E]/g, '');

  // 英数字とハイフンのみ残す
  s = s.replace(/[^a-z0-9-]/g, '-');

  // 連続ハイフン→単一、前後のハイフン除去
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');

  // 最大80文字
  s = s.substring(0, 80);

  return s;
}

// ─── slugが問題ありかチェック ───
function isProblematic(slug: string): boolean {
  if (/^\d+$/.test(slug)) return true;           // 純粋数値
  if (/[^\x00-\x7F]/.test(slug)) return true;    // 非ASCII（日本語等）
  if (slug.includes('_')) return true;            // アンダースコア
  if (/[A-Z]/.test(slug)) return true;            // 大文字
  if (slug.includes('%')) return true;             // URLエンコード
  if (slug.length > 80) return true;              // 長すぎ
  return false;
}

// ─── メイン処理 ───
async function main() {
  console.log(`=== slug正規化 ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ===\n`);

  // 全ルアー取得
  const allRows: { manufacturer_slug: string; slug: string; name: string }[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('manufacturer_slug, slug, name')
      .range(from, from + PAGE - 1)
      .order('manufacturer_slug');
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    from += data.length;
    if (data.length < PAGE) break;
  }
  console.log(`DB総行数: ${allRows.length}`);

  // ユニークシリーズ（manufacturer_slug + slug でグルーピング）
  const seriesMap = new Map<string, { manufacturer_slug: string; slug: string; name: string }>();
  for (const r of allRows) {
    const key = `${r.manufacturer_slug}/${r.slug}`;
    if (!seriesMap.has(key)) seriesMap.set(key, r);
  }
  console.log(`ユニークシリーズ数: ${seriesMap.size}`);

  // 問題のあるslugを抽出
  const problematic = [...seriesMap.values()].filter(r => isProblematic(r.slug));
  console.log(`問題slug数: ${problematic.length}\n`);

  // メーカーごとにグルーピング（同一メーカー内で重複チェックが必要）
  const byMaker = new Map<string, typeof problematic>();
  for (const r of problematic) {
    const arr = byMaker.get(r.manufacturer_slug) || [];
    arr.push(r);
    byMaker.set(r.manufacturer_slug, arr);
  }

  // 既存の正常slugを集める（重複回避用）
  const existingSlugs = new Map<string, Set<string>>();
  for (const r of seriesMap.values()) {
    if (!existingSlugs.has(r.manufacturer_slug)) {
      existingSlugs.set(r.manufacturer_slug, new Set());
    }
    existingSlugs.get(r.manufacturer_slug)!.add(r.slug);
  }

  // 変更計画を作成
  const changes: { manufacturer_slug: string; oldSlug: string; newSlug: string; name: string }[] = [];
  let emptyCount = 0;

  for (const [maker, items] of byMaker) {
    const usedSlugs = existingSlugs.get(maker) || new Set<string>();

    for (const item of items) {
      let newSlug: string;

      // URLデコードを試みてから正規化
      let nameForSlug = item.name;
      if (item.slug.includes('%')) {
        try {
          nameForSlug = decodeURIComponent(item.slug);
        } catch { /* ignore */ }
      }

      newSlug = normalizeSlug(nameForSlug);

      // 正規化結果が空 or 短すぎ → 元のslugから試行
      if (newSlug.length < 2) {
        newSlug = normalizeSlug(item.slug);
      }

      // それでも空なら、product- + 元のslugでフォールバック
      if (newSlug.length < 2) {
        newSlug = `product-${item.slug}`;
        emptyCount++;
      }

      // 変更なしならスキップ
      if (newSlug === item.slug) continue;

      // 重複回避: 同一メーカー内で同じslugがあれば連番付与
      let finalSlug = newSlug;
      let counter = 2;
      while (usedSlugs.has(finalSlug)) {
        finalSlug = `${newSlug}-${counter}`;
        counter++;
      }

      usedSlugs.add(finalSlug);

      changes.push({
        manufacturer_slug: maker,
        oldSlug: item.slug,
        newSlug: finalSlug,
        name: item.name,
      });
    }
  }

  console.log(`変更対象: ${changes.length}件`);
  if (emptyCount > 0) console.log(`フォールバック使用: ${emptyCount}件`);

  // カテゴリ別集計
  const stats = {
    numeric: changes.filter(c => /^\d+$/.test(c.oldSlug)).length,
    japanese: changes.filter(c => /[^\x00-\x7F]/.test(c.oldSlug)).length,
    underscore: changes.filter(c => c.oldSlug.includes('_')).length,
    uppercase: changes.filter(c => /[A-Z]/.test(c.oldSlug)).length,
    encoded: changes.filter(c => c.oldSlug.includes('%')).length,
  };
  console.log(`  数値→ローマ字: ${stats.numeric}`);
  console.log(`  日本語→ローマ字: ${stats.japanese}`);
  console.log(`  アンダースコア→ハイフン: ${stats.underscore}`);
  console.log(`  大文字→小文字: ${stats.uppercase}`);
  console.log(`  URLエンコード→デコード: ${stats.encoded}`);

  // サンプル表示
  console.log('\n--- 変更サンプル（先頭30件） ---');
  for (const c of changes.slice(0, 30)) {
    console.log(`  ${c.manufacturer_slug}/${c.oldSlug} → ${c.newSlug}  (${c.name})`);
  }

  // 数値→ローマ字のサンプルも表示
  const numericChanges = changes.filter(c => /^\d+$/.test(c.oldSlug));
  if (numericChanges.length > 0) {
    console.log('\n--- 数値slug変換サンプル（先頭15件） ---');
    for (const c of numericChanges.slice(0, 15)) {
      console.log(`  ${c.manufacturer_slug}/${c.oldSlug} → ${c.newSlug}  (${c.name})`);
    }
  }

  // 日本語slugのサンプルも表示
  const jpChanges = changes.filter(c => /[^\x00-\x7F]/.test(c.oldSlug));
  if (jpChanges.length > 0) {
    console.log('\n--- 日本語slug変換サンプル（先頭10件） ---');
    for (const c of jpChanges.slice(0, 10)) {
      console.log(`  ${c.manufacturer_slug}/${c.oldSlug} → ${c.newSlug}  (${c.name})`);
    }
  }

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN完了。実行するには --dry-run を外してください。');

    // 全変更リストをJSON保存
    const outPath = `scripts/_slug-changes-${new Date().toISOString().slice(0,10)}.json`;
    const fs = await import('fs');
    fs.writeFileSync(outPath, JSON.stringify(changes, null, 2));
    console.log(`変更リスト保存: ${outPath}`);
    return;
  }

  // ─── 実行 ───
  console.log('\n⚡ Supabaseを更新中...');
  let success = 0;
  let errors = 0;

  // バッチ処理（1件ずつ、同一manufacturer_slug + slug の全行を更新）
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const { error } = await sb
      .from('lures')
      .update({ slug: c.newSlug })
      .eq('manufacturer_slug', c.manufacturer_slug)
      .eq('slug', c.oldSlug);

    if (error) {
      console.error(`  ❌ ${c.manufacturer_slug}/${c.oldSlug}: ${error.message}`);
      errors++;
    } else {
      success++;
    }

    // 進捗表示（100件ごと）
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${changes.length} 完了...`);
    }
  }

  console.log(`\n✅ 完了: ${success}件成功, ${errors}件エラー`);

  // バックアップ保存
  const outPath = `scripts/_slug-changes-${new Date().toISOString().slice(0,10)}.json`;
  const fs = await import('fs');
  fs.writeFileSync(outPath, JSON.stringify(changes, null, 2));
  console.log(`変更リスト保存: ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
