#!/usr/bin/env npx tsx
import 'dotenv/config';
import { getSearchAnalytics } from './lib/gsc-client.js';

async function main() {
  const endDate = '2026-03-11';
  const startDate = '2026-02-09';

  // ページ別 全データ
  const rows = await getSearchAnalytics(startDate, endDate, ['page'], 1000);
  if (!rows) { console.log('データなし'); return; }

  // imp順でTOP30
  const sorted = rows.sort((a: any, b: any) => b.impressions - a.impressions).slice(0, 50);

  console.log('=== 全ページ imp上位50 ===\n');
  console.log('imp\tclick\tCTR\tpos\tURL');
  for (const r of sorted) {
    const url = (r as any).keys[0].replace('https://castlog.xyz', '');
    console.log(`${r.impressions}\t${r.clicks}\t${(r.ctr * 100).toFixed(1)}%\t${r.position.toFixed(1)}\t${url}`);
  }

  // CTRが高い成功ページ（参考）
  const highCtr = rows
    .filter((r: any) => r.impressions > 10 && r.ctr > 0.05)
    .sort((a: any, b: any) => b.clicks - a.clicks)
    .slice(0, 15);

  console.log('\n=== 高CTR成功ページ（参考） ===\n');
  for (const r of highCtr) {
    const url = (r as any).keys[0].replace('https://castlog.xyz', '');
    console.log(`${r.impressions}\t${r.clicks}\t${(r.ctr * 100).toFixed(1)}%\t${r.position.toFixed(1)}\t${url}`);
  }

  // ページ+クエリ組み合わせでCTR改善余地を見つける
  const pqRows = await getSearchAnalytics(startDate, endDate, ['page', 'query'], 1000);
  if (!pqRows) return;

  // 順位良好(1-10位)だがCTR低い = title/desc改善余地あり
  const lowCtrGoodPos = pqRows
    .filter((r: any) => r.position <= 10 && r.impressions >= 10 && r.ctr < 0.05)
    .sort((a: any, b: any) => b.impressions - a.impressions)
    .slice(0, 20);

  console.log('\n=== 順位1-10位 & CTR<5% （title/desc改善余地）===\n');
  console.log('imp\tclick\tCTR\tpos\tURL\tquery');
  for (const r of lowCtrGoodPos) {
    const [url, query] = (r as any).keys;
    console.log(`${r.impressions}\t${r.clicks}\t${(r.ctr * 100).toFixed(1)}%\t${r.position.toFixed(1)}\t${url.replace('https://castlog.xyz', '')}\t${query}`);
  }
}

main();
