import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const SITE_URL = process.env.GSC_SITE_URL || 'https://www.lure-db.com/';

async function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
  return auth;
}

async function main() {
  const auth = await getAuth();
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  // URL Inspection API でクロール状態を確認
  // まず analytics で「クロール済み未登録」に近いページを探す

  // 直近28日のページ別データ（クリック=0、インプレ>0の候補）
  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: '2026-03-01',
      endDate: '2026-03-30',
      dimensions: ['page'],
      rowLimit: 500,
      startRow: 0,
    }
  });

  const rows = res.data.rows || [];
  console.log(`総ページ数: ${rows.length}`);
  
  // インプレ>0でクリック=0のページ（検索に表示されているがクリックされていない）
  const zeroClick = rows.filter(r => (r.clicks || 0) === 0 && (r.impressions || 0) > 0);
  console.log(`クリック=0 & インプレ>0: ${zeroClick.length}件`);
  
  // ページタイプ別分析
  const patterns: Record<string, number> = {};
  for (const row of rows) {
    const page = (row.keys?.[0] || '').replace('https://www.lure-db.com', '').replace('https://castlog.xyz', '');
    const parts = page.split('/').filter(Boolean);
    
    let type = 'other';
    if (parts.length === 0) type = 'home';
    else if (parts[0] === 'lures') type = 'lure-detail';
    else if (parts[0] === 'category') type = 'category';
    else if (parts[0] === 'maker') type = 'maker';
    else if (parts[0] === 'article') type = 'article';
    else if (parts.length === 1) type = 'top-level';
    else if (parts.length === 2) type = 'lure-detail'; // {maker}/{slug}
    
    patterns[type] = (patterns[type] || 0) + 1;
  }
  
  console.log('\nページタイプ別:');
  for (const [k, v] of Object.entries(patterns).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  
  // 上位ページの詳細
  console.log('\n上位20ページ（インプレ順）:');
  rows.sort((a,b) => (b.impressions||0) - (a.impressions||0));
  for (const row of rows.slice(0, 20)) {
    const page = (row.keys?.[0] || '').replace('https://www.lure-db.com', '');
    console.log(`  ${page}: クリック=${row.clicks}, インプレ=${row.impressions}, 順位=${row.position?.toFixed(1)}`);
  }
  
  // 結果保存
  fs.writeFileSync('/tmp/crawled-analysis.json', JSON.stringify({
    totalRows: rows.length,
    zeroClickWithImpression: zeroClick.length,
    patterns,
    topPages: rows.slice(0, 50).map(r => ({
      page: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position
    }))
  }, null, 2));
  
  console.log('\n保存: /tmp/crawled-analysis.json');
}

main().catch(console.error);
