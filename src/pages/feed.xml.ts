/**
 * RSS フィード — 新着ルアー
 * /feed.xml で配信
 */
import type { APIRoute } from 'astro';
import { fetchAllLures } from '../lib/fetch-all-lures';
import { groupLuresBySeries } from '../lib/group-lures';

const SITE_URL = 'https://www.castlog.xyz';

export const GET: APIRoute = async () => {
  const lures = await fetchAllLures();
  const series = groupLuresBySeries(lures);

  // 最新100件（created_at降順）
  const sorted = series
    .filter(s => s.created_at)
    .sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime())
    .slice(0, 100);

  const items = sorted.map(s => {
    const url = `${SITE_URL}/${s.manufacturer_slug}/${s.slug}/`;
    const date = new Date(s.created_at!).toUTCString();
    const desc = s.description?.slice(0, 200) || `${s.name}（${s.manufacturer}）の${s.type}。全${s.color_count}カラー。`;
    return `
    <item>
      <title><![CDATA[${s.name} - ${s.manufacturer}]]></title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${date}</pubDate>
      <description><![CDATA[${desc}]]></description>
      <category>${s.type}</category>
    </item>`;
  }).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CAST/LOG - 新着ルアー</title>
    <link>${SITE_URL}</link>
    <description>日本最大級のルアーデータベース CAST/LOG の新着ルアー情報</description>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
