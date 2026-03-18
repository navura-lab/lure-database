#!/usr/bin/env npx tsx
/**
 * エディトリアル効果測定スクリプト
 *
 * デプロイ台帳（_tracker.ts）の各エディトリアルについて
 * GSCから現在の順位を取得し、デプロイ前との比較を出力する。
 *
 * Usage:
 *   npx tsx scripts/seo/measure-editorials.ts
 *
 * launchd で週次実行推奨（毎週月曜 8:00）
 */

import 'dotenv/config';
import { editorialDeployLog } from '../../src/data/seo/editorials/_tracker.js';
import { getSearchAnalytics, getLegacySearchAnalytics, daysAgo } from '../lib/gsc-client.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== エディトリアル効果測定 (${today}) ===\n`);

  const results: {
    slug: string;
    keyword: string;
    deployedAt: string;
    daysSinceDeploy: number;
    baselinePos: number | null;
    currentPos: number | null;
    posChange: string;
    baselineImp: number | null;
    currentImp: number | null;
    status: string;
  }[] = [];

  for (const record of editorialDeployLog) {
    const deployDate = new Date(record.deployedAt);
    const daysSince = Math.floor((Date.now() - deployDate.getTime()) / (1000 * 60 * 60 * 24));

    // GSCからキーワードの現在順位を取得（旧ドメイン）
    let currentPos: number | null = null;
    let currentImp: number | null = null;

    try {
      const data = await getLegacySearchAnalytics(
        daysAgo(7), daysAgo(1), ['query'], 100,
        [{ dimension: 'query', operator: 'contains', expression: record.targetKeyword }],
      );

      if (data.length > 0) {
        // 最もインプレッションが多いクエリを採用
        const best = data.sort((a, b) => b.impressions - a.impressions)[0];
        currentPos = best.position;
        currentImp = best.impressions;
      }
    } catch (e) {
      // GSCエラー時はスキップ
    }

    // 新ドメインでも試す
    if (currentPos === null) {
      try {
        const data = await getSearchAnalytics(
          daysAgo(7), daysAgo(1), ['query'], 100,
          [{ dimension: 'query', operator: 'contains', expression: record.targetKeyword }],
        );
        if (data.length > 0) {
          const best = data.sort((a, b) => b.impressions - a.impressions)[0];
          currentPos = best.position;
          currentImp = best.impressions;
        }
      } catch (e) {}
    }

    const posChange = (record.baselinePosition !== null && currentPos !== null)
      ? (record.baselinePosition - currentPos > 0
        ? `↑${(record.baselinePosition - currentPos).toFixed(1)}`
        : currentPos === record.baselinePosition ? '→'
        : `↓${(currentPos - record.baselinePosition).toFixed(1)}`)
      : 'N/A';

    let status = 'deployed';
    if (currentPos !== null && record.baselinePosition !== null) {
      if (currentPos <= 3) status = 'improved';
      else if (currentPos < record.baselinePosition - 1) status = 'improved';
      else if (currentPos > record.baselinePosition + 1) status = 'declined';
      else status = 'unchanged';
    }

    results.push({
      slug: record.slug,
      keyword: record.targetKeyword,
      deployedAt: record.deployedAt,
      daysSinceDeploy: daysSince,
      baselinePos: record.baselinePosition,
      currentPos,
      posChange,
      baselineImp: record.baselineImpressions,
      currentImp,
      status,
    });

    console.log(`${record.targetKeyword} (${record.slug})`);
    console.log(`  デプロイ: ${record.deployedAt} (${daysSince}日前)`);
    console.log(`  順位: ${record.baselinePosition ?? '?'} → ${currentPos?.toFixed(1) ?? '?'} (${posChange})`);
    console.log(`  imp: ${record.baselineImpressions ?? '?'} → ${currentImp ?? '?'}`);
    console.log(`  判定: ${status}`);
    console.log();
  }

  // レポートをファイルに保存
  const reportDir = path.join(import.meta.dirname, '../../logs/seo-pipeline');
  fs.mkdirSync(reportDir, { recursive: true });

  const reportPath = path.join(reportDir, `editorial-report-${today}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    date: today,
    totalEditorials: results.length,
    improved: results.filter(r => r.status === 'improved').length,
    unchanged: results.filter(r => r.status === 'unchanged').length,
    declined: results.filter(r => r.status === 'declined').length,
    results,
  }, null, 2));

  console.log(`レポート保存: ${reportPath}`);

  // サマリー
  console.log('\n─── サマリー ───');
  console.log(`合計: ${results.length}件`);
  console.log(`改善: ${results.filter(r => r.status === 'improved').length}件`);
  console.log(`維持: ${results.filter(r => r.status === 'unchanged').length}件`);
  console.log(`低下: ${results.filter(r => r.status === 'declined').length}件`);
  console.log(`未測定: ${results.filter(r => r.status === 'deployed').length}件`);
}

main().catch(console.error);
