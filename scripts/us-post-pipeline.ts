// scripts/us-post-pipeline.ts
// USパイプライン後の状態確認スクリプト
// Claude Codeセッションの初手で実行して、次のアクションを判定する
//
// 使い方:
//   npx tsx scripts/us-post-pipeline.ts

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { US_MAKERS } from './lib/regions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 英語テキスト判定（ASCII比率70%以上）
function isEnglish(text: string): boolean {
  if (!text || text.length < 20) return false;
  let ascii = 0;
  for (const c of text) {
    if (c.charCodeAt(0) < 128) ascii++;
  }
  return ascii / text.length > 0.7;
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  US Post-Pipeline 状態チェック           ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // 1. 直近のパイプライン実行結果
  const usRunPath = resolve(__dirname, '../logs/pipeline-us-last-run.json');
  const allRunPath = resolve(__dirname, '../logs/pipeline-last-run.json');
  const runPath = existsSync(usRunPath) ? usRunPath : existsSync(allRunPath) ? allRunPath : null;

  if (runPath) {
    const run = JSON.parse(readFileSync(runPath, 'utf-8'));
    const ago = Math.round((Date.now() - new Date(run.completedAt).getTime()) / 3600000);
    console.log(`📊 直近パイプライン実行 (${ago}時間前)`);
    console.log(`   ファイル: ${runPath}`);
    console.log(`   完了: ${run.completedAt}`);
    console.log(`   成功: ${run.successful}件, エラー: ${run.errors}件, 挿入: ${run.rowsInserted}行`);
    if (run.errors > 0 && run.errorDetails?.length > 0) {
      console.log(`   エラー詳細:`);
      for (const e of run.errorDetails.slice(0, 5)) {
        console.log(`     - ${e.name}: ${e.message.substring(0, 80)}`);
      }
    }
  } else {
    console.log('📊 パイプライン実行記録なし');
  }

  // 2. USメーカー商品のステータスチェック
  console.log('\n--- USメーカー商品分析 ---\n');

  let totalEng = 0;
  let totalSonota = 0;
  let totalLong = 0;
  let totalProducts = 0;

  for (const maker of US_MAKERS) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, name, description, type')
      .eq('manufacturer_slug', maker);

    if (error) {
      console.error(`❌ ${maker}: ${error.message}`);
      continue;
    }

    // slug単位で重複排除
    const unique = new Map<string, (typeof data)[0]>();
    for (const r of data || []) {
      if (!unique.has(r.slug)) unique.set(r.slug, r);
    }

    const products = [...unique.values()];
    const engItems = products.filter(r => isEnglish(r.description || ''));
    const longItems = products.filter(r => (r.description || '').length > 250);
    const sonotaItems = products.filter(r => r.type === 'その他');

    totalProducts += products.length;
    totalEng += engItems.length;
    totalSonota += sonotaItems.length;
    totalLong += longItems.length;

    const status = engItems.length === 0 && sonotaItems.length === 0 ? '✅' : '⚠️';
    console.log(`${status} ${maker}: ${products.length}商品`);
    if (engItems.length > 0) {
      console.log(`   英語のまま: ${engItems.length}件`);
      for (const e of engItems.slice(0, 3)) {
        console.log(`     - ${e.slug}: ${(e.description || '').substring(0, 40)}...`);
      }
    }
    if (longItems.length > 0) {
      console.log(`   250文字超(未リライト疑い): ${longItems.length}件`);
    }
    if (sonotaItems.length > 0) {
      console.log(`   type=その他: ${sonotaItems.length}件`);
      for (const s of sonotaItems.slice(0, 3)) {
        console.log(`     - ${s.slug}: ${s.name}`);
      }
    }
  }

  // 3. 判定
  console.log('\n═══════════════════════════════════════════');
  console.log('判定結果:');
  console.log('═══════════════════════════════════════════');

  const actions: string[] = [];

  if (totalEng > 0) {
    actions.push(`要リライト: 英語説明文 ${totalEng}件`);
    console.log(`❌ 要リライト: ${totalEng}件の英語説明文が残存`);
    console.log(`   → npx tsx scripts/rewrite-descriptions.ts`);
  }

  if (totalLong > 0 && totalEng === 0) {
    actions.push(`要確認: 250文字超 ${totalLong}件（未リライト？）`);
    console.log(`⚠️  要確認: ${totalLong}件が250文字超`);
    console.log(`   → npx tsx scripts/rewrite-descriptions.ts --check`);
  }

  if (totalSonota > 0) {
    actions.push(`要再分類: type=その他 ${totalSonota}件`);
    console.log(`⚠️  要再分類: ${totalSonota}件が「その他」`);
  }

  if (actions.length === 0) {
    console.log(`✅ デプロイ可: US ${totalProducts}商品、全てリライト・分類済み`);
    console.log(`   → git push origin main`);
  }

  console.log('═══════════════════════════════════════════');
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
