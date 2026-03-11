#!/usr/bin/env npx tsx
/**
 * slug違反チェッカー — DB内の全slugを検査
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await sb.from('lures').select('manufacturer_slug, slug, name').order('manufacturer_slug');
  if (error) { console.error(error); process.exit(1); }

  // slug単位でユニーク化
  const seen = new Map<string, { manufacturer_slug: string; slug: string; name: string }>();
  for (const r of data!) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }

  console.log('=== slug違反一覧 ===');
  console.log('ユニークslug総数:', seen.size);

  const violations: { path: string; slug: string; name: string; issues: string }[] = [];
  for (const [key, r] of seen) {
    const slug = r.slug;
    const issues: string[] = [];

    if (/%[0-9A-Fa-f]{2}/.test(slug)) issues.push('URLエンコード');
    if (/[A-Z]/.test(slug)) issues.push('大文字');
    if (/_/.test(slug)) issues.push('アンダースコア');
    if (/[^\x00-\x7F]/.test(slug)) issues.push('日本語文字');
    if (/[^a-z0-9\-_]/.test(slug) && !/%[0-9A-Fa-f]{2}/.test(slug)) issues.push('許容外文字');
    if (/^\d+$/.test(slug)) issues.push('純粋数値');
    if (slug.length > 80) issues.push('80文字超');

    if (issues.length > 0) {
      violations.push({ path: key, slug, name: r.name, issues: issues.join(', ') });
    }
  }

  console.log('違反数:', violations.length);
  console.log('');

  // カテゴリ別集計
  const byIssue = new Map<string, number>();
  for (const v of violations) {
    for (const i of v.issues.split(', ')) {
      byIssue.set(i, (byIssue.get(i) || 0) + 1);
    }
  }
  console.log('--- カテゴリ別 ---');
  for (const [issue, count] of [...byIssue.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${issue}: ${count}件`);
  }
  console.log('');

  // 全違反表示
  for (const v of violations) {
    console.log(`  ${v.path}  [${v.issues}]  name=${v.name}`);
  }

  // manufacturer_slug側の違反チェック
  const mfrSlugs = new Set([...seen.values()].map(r => r.manufacturer_slug));
  const mfrViolations: string[] = [];
  for (const ms of mfrSlugs) {
    if (/[^a-z0-9-]/.test(ms)) mfrViolations.push(ms);
  }
  if (mfrViolations.length > 0) {
    console.log('\n--- manufacturer_slug違反 ---');
    for (const m of mfrViolations) console.log(`  ${m}`);
  }
}

main();
