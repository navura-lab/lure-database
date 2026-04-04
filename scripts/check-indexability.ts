#!/usr/bin/env npx tsx
/**
 * インデックス可能性チェック
 *
 * 全商品ページがGoogleにインデックスされる品質を持っているかチェック。
 * 「クロール済み-インデックス未登録」を防止する永久対策。
 *
 * チェック項目:
 *   1. description 50文字以上（短すぎると薄いコンテンツ判定）
 *   2. description 重複なし（同じ文が2回以上出現しない）
 *   3. エディトリアルあり or description 100文字以上
 *   4. カラー数 2色以上
 *   5. 画像あり
 *
 * Usage:
 *   npx tsx scripts/check-indexability.ts             # チェック
 *   npx tsx scripts/check-indexability.ts --verbose    # 詳細
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
const VERBOSE = process.argv.includes('--verbose');
const EDITORIALS_DIR = path.join(import.meta.dirname, '..', 'src', 'data', 'seo', 'editorials');

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function main() {
  log('=== インデックス可能性チェック ===');

  const editorials = new Set(
    fs.readdirSync(EDITORIALS_DIR)
      .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
      .map(f => f.replace('.ts', ''))
  );

  // 全商品を取得（ページネーション）
  let offset = 0;
  const seriesMap = new Map<string, any>();
  while (true) {
    const { data } = await sb.from('lures')
      .select('slug,manufacturer_slug,name,description,images,type')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const k = `${r.manufacturer_slug}/${r.slug}`;
      if (!seriesMap.has(k)) {
        seriesMap.set(k, { ...r, color_count: 1, has_image: !!(r.images && r.images.length > 0) });
      } else {
        seriesMap.get(k)!.color_count++;
        if (r.images && r.images.length > 0) seriesMap.get(k)!.has_image = true;
      }
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  log(`全商品: ${seriesMap.size}件`);

  const issues: { slug: string; ms: string; name: string; reasons: string[] }[] = [];

  for (const [, s] of seriesMap) {
    const reasons: string[] = [];
    const hasEditorial = editorials.has(s.slug);
    const descLen = s.description?.length || 0;

    // 1. description短すぎ
    if (descLen < 50 && !hasEditorial) {
      reasons.push(`desc=${descLen}文字（最低50、エディトリアルなし）`);
    }

    // 2. description重複チェック
    if (s.description) {
      const lines = s.description.split('\n').map((l: string) => l.trim()).filter(Boolean);
      const unique = new Set(lines);
      if (unique.size < lines.length * 0.7) {
        reasons.push(`desc重複あり（${lines.length}行中${lines.length - unique.size}行重複）`);
      }
    }

    // 3. エディトリアルなし + description不足
    if (!hasEditorial && descLen < 100) {
      reasons.push(`エディトリアルなし+desc${descLen}文字（薄いコンテンツリスク）`);
    }

    // 4. カラー数
    if (s.color_count <= 1) {
      reasons.push(`カラー${s.color_count}色（コンテンツ量不足）`);
    }

    // 5. 画像なし
    if (!s.has_image) {
      reasons.push('画像なし');
    }

    if (reasons.length > 0) {
      issues.push({ slug: s.slug, ms: s.manufacturer_slug, name: s.name, reasons });
    }
  }

  // サマリー
  const noEditorialShortDesc = issues.filter(i => i.reasons.some(r => r.includes('エディトリアルなし')));
  const duplicateDesc = issues.filter(i => i.reasons.some(r => r.includes('重複')));
  const noImage = issues.filter(i => i.reasons.some(r => r.includes('画像なし')));
  const lowColor = issues.filter(i => i.reasons.some(r => r.includes('カラー') && r.includes('1色')));

  log(`\n=== 結果 ===`);
  log(`問題あり: ${issues.length}件 / 全${seriesMap.size}件`);
  log(`  エディトリアルなし+desc不足: ${noEditorialShortDesc.length}件`);
  log(`  description重複: ${duplicateDesc.length}件`);
  log(`  画像なし: ${noImage.length}件`);
  log(`  カラー1色以下: ${lowColor.length}件`);

  if (VERBOSE) {
    log('\n--- エディトリアルなし+desc不足（上位20）---');
    noEditorialShortDesc.slice(0, 20).forEach(i => {
      log(`  ${i.ms}/${i.slug}: ${i.name} → ${i.reasons.join(', ')}`);
    });
  }

  // 結果保存
  const outDir = path.join(import.meta.dirname, '..', 'logs', 'indexability');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `check-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    date: new Date().toISOString().split('T')[0],
    total: seriesMap.size,
    issues: issues.length,
    noEditorialShortDesc: noEditorialShortDesc.length,
    duplicateDesc: duplicateDesc.length,
    noImage: noImage.length,
    lowColor: lowColor.length,
  }, null, 2));
  log(`保存: ${outFile}`);
}

main().catch(console.error);
