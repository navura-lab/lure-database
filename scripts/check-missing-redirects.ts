/**
 * 削除されたページのvercel.jsonリダイレクト漏れチェック＋自動修正
 *
 * 対象ページタイプ（git履歴で削除されたファイルから検出）:
 *   - src/data/articles/{slug}.ts         → /article/{slug}/ と /en/article/{slug}/
 *   - src/data/seasonal-guides/*.ts       → /season/{slug}/ と /en/season/{slug}/
 *   - src/data/fishing-methods/*.ts       → /method/{slug}/ と /en/method/{slug}/
 *   - src/data/guides/*.ts や guides.ts   → /guide/{slug}/ と /en/guide/{slug}/
 *
 * ※ src/data/seo/editorials/*.ts は独立したURLページを持たないため対象外
 *
 * 使い方:
 *   npx tsx scripts/check-missing-redirects.ts         → チェックのみ（CI用、漏れあり=終了コード1）
 *   npx tsx scripts/check-missing-redirects.ts --fix   → 自動修正してvercel.jsonを更新
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// --- 設定 ---

const ROOT = path.resolve(import.meta.dirname, '..');
const VERCEL_JSON = path.join(ROOT, 'vercel.json');

/** ファイルパスパターン → URLルールのマッピング */
const FILE_TO_URL_RULES: Array<{
  /** ファイルパスに対するregex（マッチしたらslugを抽出） */
  pattern: RegExp;
  /** slugからURLペアを生成 */
  getUrls: (slug: string) => Array<{ source: string; destination: string }>;
}> = [
  {
    // src/data/articles/{slug}.ts → /article/{slug}/
    // _index.ts, _types.ts はスキップ
    pattern: /^src\/data\/articles\/(?!_)([^/]+)\.ts$/,
    getUrls: (slug) => [
      { source: `/article/${slug}/`, destination: '/' },
      { source: `/en/article/${slug}/`, destination: '/en/' },
    ],
  },
  {
    // src/data/seasonal-guides.ts はシングルファイル（スキップ）
    // src/data/seasonal-guides/{slug}.ts があればこちらで処理
    pattern: /^src\/data\/seasonal-guides\/(?!_)([^/]+)\.ts$/,
    getUrls: (slug) => [
      { source: `/season/${slug}/`, destination: '/' },
      { source: `/en/season/${slug}/`, destination: '/en/' },
    ],
  },
  {
    // src/data/fishing-methods/{slug}.ts があればこちらで処理
    pattern: /^src\/data\/fishing-methods\/(?!_)([^/]+)\.ts$/,
    getUrls: (slug) => [
      { source: `/method/${slug}/`, destination: '/' },
      { source: `/en/method/${slug}/`, destination: '/en/' },
    ],
  },
  {
    // src/data/guides/{slug}.ts があればこちらで処理
    pattern: /^src\/data\/guides\/(?!_)([^/]+)\.ts$/,
    getUrls: (slug) => [
      { source: `/guide/${slug}/`, destination: '/' },
      { source: `/en/guide/${slug}/`, destination: '/en/' },
    ],
  },
];

/** seasonal-guides.ts, fishing-methods.ts, guides.ts のslugを含む行を解析するパターン */
const SINGLE_FILE_SLUG_PATTERNS: Array<{
  /** 削除されたファイルパス（シングルファイル型） */
  filePath: string;
  /** slug: 'xxx' の形式で抽出するregex */
  slugRegex: RegExp;
  /** slugからURLペアを生成 */
  getUrls: (slug: string) => Array<{ source: string; destination: string }>;
}> = [
  {
    filePath: 'src/data/seasonal-guides.ts',
    slugRegex: /slug:\s*['"]([^'"]+)['"]/g,
    getUrls: (slug) => [
      { source: `/season/${slug}/`, destination: '/' },
      { source: `/en/season/${slug}/`, destination: '/en/' },
    ],
  },
  {
    filePath: 'src/data/fishing-methods.ts',
    slugRegex: /slug:\s*['"]([^'"]+)['"]/g,
    getUrls: (slug) => [
      { source: `/method/${slug}/`, destination: '/' },
      { source: `/en/method/${slug}/`, destination: '/en/' },
    ],
  },
  {
    filePath: 'src/data/guides.ts',
    slugRegex: /slug:\s*['"]([^'"]+)['"]/g,
    getUrls: (slug) => [
      { source: `/guide/${slug}/`, destination: '/' },
      { source: `/en/guide/${slug}/`, destination: '/en/' },
    ],
  },
];

// --- メイン処理 ---

function main() {
  const isFixMode = process.argv.includes('--fix');

  console.log('[check-missing-redirects] 削除ページのリダイレクト漏れチェック中...');
  console.log(`  モード: ${isFixMode ? '自動修正 (--fix)' : 'チェックのみ'}`);

  // 1. vercel.jsonの既存リダイレクトを読み込む
  const vercelJson = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf-8'));
  const existingSources = new Set<string>(
    (vercelJson.redirects || []).map((r: { source: string }) => r.source)
  );

  // 2. git履歴から削除されたファイル一覧を取得
  const deletedFiles = getDeletedFiles();
  console.log(`  削除済みファイル検出: ${deletedFiles.length}件`);

  // 3. 削除ファイルから必要なリダイレクトを収集
  const requiredRedirects: Array<{ source: string; destination: string }> = [];

  for (const filePath of deletedFiles) {
    for (const rule of FILE_TO_URL_RULES) {
      const match = filePath.match(rule.pattern);
      if (match) {
        const slug = match[1];
        const urls = rule.getUrls(slug);
        requiredRedirects.push(...urls);
        break;
      }
    }
  }

  // 4. シングルファイル型（git diff内容からslugを抽出）
  const singleFileSlugs = getDeletedSlugsFromSingleFiles();
  requiredRedirects.push(...singleFileSlugs);

  // 5. vercel.jsonに未登録のリダイレクトを特定
  const missing = requiredRedirects.filter(r => !existingSources.has(r.source));

  // 重複除去
  const missingUnique = Array.from(
    new Map(missing.map(r => [r.source, r])).values()
  );

  if (missingUnique.length === 0) {
    console.log('  ✅ リダイレクト漏れなし（全て登録済み）');
    process.exit(0);
  }

  // 6. 結果表示
  console.log(`\n  ❌ リダイレクト漏れ: ${missingUnique.length}件`);
  for (const r of missingUnique) {
    console.log(`    ${r.source} → ${r.destination}`);
  }

  if (!isFixMode) {
    console.log('\n  修正するには:');
    console.log('    npm run fix:redirects');
    process.exit(1);
  }

  // 7. --fix モード: vercel.jsonのredirects配列の先頭に追加
  // 既存の先頭リダイレクト（trailingSlash正規化）の直後に挿入
  const newRedirects = missingUnique.map(r => ({
    source: r.source,
    destination: r.destination,
    permanent: true,
  }));

  // trailingSlash正規化ルール（先頭要素）の後に追加
  const firstRedirect = vercelJson.redirects[0];
  const isTrailingSlashRule =
    firstRedirect &&
    typeof firstRedirect.source === 'string' &&
    firstRedirect.source.includes('(?!api/');

  if (isTrailingSlashRule) {
    vercelJson.redirects = [
      firstRedirect,
      ...newRedirects,
      ...vercelJson.redirects.slice(1),
    ];
  } else {
    vercelJson.redirects = [...newRedirects, ...vercelJson.redirects];
  }

  // 8. vercel.jsonに書き戻し（2スペースインデント）
  fs.writeFileSync(VERCEL_JSON, JSON.stringify(vercelJson, null, 2) + '\n', 'utf-8');

  console.log(`\n  ✅ vercel.jsonを更新しました（${missingUnique.length}件追加）`);
  console.log('  次のステップ:');
  console.log('    git add vercel.json');
  console.log("    git commit -m 'fix: リダイレクト追加'");
  process.exit(0);
}

/**
 * git履歴から削除されたファイルパス一覧を取得
 */
function getDeletedFiles(): string[] {
  try {
    const output = execSync(
      'git log --diff-filter=D --name-only --pretty=""',
      { cwd: ROOT, encoding: 'utf-8' }
    );
    const files = output
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    // 重複除去
    return [...new Set(files)];
  } catch (err) {
    console.error('  git logの実行に失敗しました:', err);
    return [];
  }
}

/**
 * シングルファイル型（seasonal-guides.ts等）のgit diff内容からslugを抽出
 * ファイルが削除されている場合、削除コミット時のdiff内容を解析する
 */
function getDeletedSlugsFromSingleFiles(): Array<{ source: string; destination: string }> {
  const results: Array<{ source: string; destination: string }> = [];

  for (const rule of SINGLE_FILE_SLUG_PATTERNS) {
    try {
      // このファイルが削除されたコミットのdiffを取得
      const commitHash = execSync(
        `git log --diff-filter=D --pretty=format:"%H" -- "${rule.filePath}"`,
        { cwd: ROOT, encoding: 'utf-8' }
      ).trim();

      if (!commitHash) {
        // ファイルが削除されていない（現存する）= シングルファイル内のコンテンツが削除された可能性
        // 全コミット履歴からslugを抽出
        const allDiffs = execSync(
          `git log -p -- "${rule.filePath}"`,
          { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );

        // 削除行（- で始まる行）からslugを抽出
        const deletedLines = allDiffs
          .split('\n')
          .filter(l => l.startsWith('-') && !l.startsWith('---'));

        const fullText = deletedLines.join('\n');
        let match: RegExpExecArray | null;
        rule.slugRegex.lastIndex = 0;
        const seenSlugs = new Set<string>();

        while ((match = rule.slugRegex.exec(fullText)) !== null) {
          const slug = match[1];
          if (seenSlugs.has(slug)) continue;
          seenSlugs.add(slug);

          // 現在のファイルに同じslugが残っているか確認（存在するなら削除されていない）
          const currentContent = fs.existsSync(path.join(ROOT, rule.filePath))
            ? fs.readFileSync(path.join(ROOT, rule.filePath), 'utf-8')
            : '';

          if (!currentContent.includes(`'${slug}'`) && !currentContent.includes(`"${slug}"`)) {
            results.push(...rule.getUrls(slug));
          }
        }
        // slugRegexをリセット（グローバルフラグのため）
        rule.slugRegex.lastIndex = 0;
      } else {
        // ファイル自体が削除されたコミットのdiffからslugを抽出
        const diff = execSync(
          `git show "${commitHash}:${rule.filePath}"`,
          { cwd: ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
        );

        let match: RegExpExecArray | null;
        rule.slugRegex.lastIndex = 0;

        while ((match = rule.slugRegex.exec(diff)) !== null) {
          results.push(...rule.getUrls(match[1]));
        }
        rule.slugRegex.lastIndex = 0;
      }
    } catch {
      // ファイルが存在しないなど、エラーはスキップ
    }
  }

  return results;
}

main();
