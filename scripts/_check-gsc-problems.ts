import { getSearchAnalytics, daysAgo } from './lib/gsc-client.js';

async function main() {
  const rows = await getSearchAnalytics(daysAgo(30), daysAgo(2), ['page'], 25000);
  const pages = rows.map((r: any) => ({ url: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));
  console.log(`GSCデータのあるページ: ${pages.length}件`);
  
  // サマリー
  pages.sort((a: any, b: any) => b.impressions - a.impressions);
  console.log('\n--- Top 20 ページ（インプレッション順） ---');
  pages.slice(0, 20).forEach((p: any, i: number) => {
    const path = p.url.replace('https://www.lure-db.com', '');
    console.log(`  ${i+1}. ${path} | imp=${p.impressions} click=${p.clicks} pos=${p.position.toFixed(1)}`);
  });
  
  // 404候補: vercel.jsonにリダイレクト済みの旧URLがGSCに残ってないか
  const oldSlugs = pages.filter((p: any) => {
    const path = p.url.replace('https://www.lure-db.com', '');
    return path.includes('%') || path.includes('_') || /[A-Z]/.test(path);
  });
  if (oldSlugs.length > 0) {
    console.log(`\n--- 旧フォーマットURL（404候補） ---`);
    oldSlugs.forEach((p: any) => {
      const path = p.url.replace('https://www.lure-db.com', '');
      console.log(`  ${path} | imp=${p.impressions}`);
    });
  }
}
main().catch(console.error);
