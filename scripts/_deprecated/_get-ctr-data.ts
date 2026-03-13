#!/usr/bin/env npx tsx
// GSCから低CTR・高impページを取得してCTR改善候補を特定
import 'dotenv/config';
import { getSearchAnalytics } from './lib/gsc-client.js';

async function main() {
  const endDate = '2026-03-11';
  const startDate = '2026-02-09'; // 30日間

  // ページ別データ
  const rows = await getSearchAnalytics(startDate, endDate, ['page'], 500);
  
  if (!rows || rows.length === 0) {
    console.log('GSCデータなし');
    return;
  }

  // imp > 20 & CTR < 5% のページを抽出
  const candidates = rows
    .filter((r: any) => r.impressions > 20 && r.ctr < 0.05)
    .sort((a: any, b: any) => b.impressions - a.impressions)
    .slice(0, 30);

  console.log('=== CTR改善候補（imp>20, CTR<5%）TOP30 ===\n');
  console.log('imp\tclick\tCTR\tpos\tURL');
  for (const r of candidates) {
    const url = (r as any).keys[0].replace('https://castlog.app', '');
    console.log(`${r.impressions}\t${r.clicks}\t${(r.ctr * 100).toFixed(1)}%\t${r.position.toFixed(1)}\t${url}`);
  }

  // クエリ別でも確認（改善可能なクエリ）
  const qRows = await getSearchAnalytics(startDate, endDate, ['query'], 500);
  const qCandidates = (qRows || [])
    .filter((r: any) => r.impressions > 30 && r.ctr < 0.04)
    .sort((a: any, b: any) => b.impressions - a.impressions)
    .slice(0, 20);

  console.log('\n=== 低CTRクエリ（imp>30, CTR<4%）TOP20 ===\n');
  console.log('imp\tclick\tCTR\tpos\tquery');
  for (const r of qCandidates) {
    console.log(`${r.impressions}\t${r.clicks}\t${(r.ctr * 100).toFixed(1)}%\t${r.position.toFixed(1)}\t${(r as any).keys[0]}`);
  }
}

main();
