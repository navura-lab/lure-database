#!/usr/bin/env npx tsx
/**
 * データ品質定期監査スクリプト
 *
 * 全レコードを検査し、問題をカテゴリ別に報告する。
 * launchdで週次実行推奨。
 *
 * Usage:
 *   npx tsx scripts/seo/data-audit.ts           # レポートのみ
 *   npx tsx scripts/seo/data-audit.ts --fix      # error級の問題を自動修正
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { runFullAudit } from '../lib/data-validator';

async function main() {
  const sb = createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
  );

  console.log('=== CAST/LOG データ品質監査 ===\n');

  const { total, issues, summary } = await runFullAudit(sb);

  console.log(`総レコード数: ${total.toLocaleString()}`);
  console.log(`問題検出数: ${issues.length}\n`);

  // カテゴリ別サマリー
  console.log('─── カテゴリ別 ───');
  for (const [key, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }

  // エラー（即修正が必要）
  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length > 0) {
    console.log(`\n─── ERROR（即対応必要）: ${errors.length}件 ───`);
    // メーカー別にグルーピング
    const byMfr = new Map<string, typeof errors>();
    for (const e of errors) {
      const mfr = e.manufacturer || 'unknown';
      const list = byMfr.get(mfr) || [];
      list.push(e);
      byMfr.set(mfr, list);
    }
    for (const [mfr, list] of [...byMfr.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${mfr} (${list.length}件):`);
      for (const e of list.slice(0, 5)) {
        console.log(`    ${e.slug}: ${e.message}`);
        if (e.suggestion) console.log(`      → ${e.suggestion}`);
      }
      if (list.length > 5) console.log(`    ... +${list.length - 5}件`);
    }
  }

  // --fix モード
  if (process.argv.includes('--fix') && errors.length > 0) {
    console.log('\n─── 自動修正実行 ───');
    const serviceSb = createClient(
      process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY!,
    );

    // 非ルアー製品を削除
    const nonLures = errors.filter(e => e.category === 'non-lure');
    if (nonLures.length > 0) {
      const slugsToDelete = [...new Set(nonLures.map(e => e.slug))];
      for (const slug of slugsToDelete) {
        const { data } = await serviceSb.from('lures').delete().eq('slug', slug).select('id');
        console.log(`  削除: ${slug} (${data?.length || 0}件)`);
      }
    }
  }

  // 結果をファイルに保存
  const reportPath = `logs/data-audit-${new Date().toISOString().slice(0, 10)}.json`;
  const fs = await import('fs');
  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ date: new Date().toISOString(), total, summary, errorCount: errors.length, issues: issues.slice(0, 500) }, null, 2));
  console.log(`\nレポート保存: ${reportPath}`);
}

main().catch(console.error);
