import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { supabase } from '../lib/supabase';
import { contentArticles } from '../data/articles/_index';

const SITE_URL = 'https://www.castlog.xyz';

export async function GET(context: APIContext) {
  // 最新商品20件を取得（slug単位でdistinct、created_at降順）
  const { data: products } = await supabase
    .from('lures')
    .select('name, slug, manufacturer_slug, description, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  // slugごとにグルーピングして最新20件
  const seen = new Set<string>();
  const uniqueProducts: typeof products = [];
  for (const p of products ?? []) {
    const key = `${p.manufacturer_slug}/${p.slug}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProducts.push(p);
      if (uniqueProducts.length >= 20) break;
    }
  }

  // 記事を publishedAt 降順で最新10件
  const sortedArticles = [...contentArticles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 10);

  const productItems = uniqueProducts.map((p) => ({
    title: p.name,
    link: `${SITE_URL}/${p.manufacturer_slug}/${p.slug}/`,
    description: p.description || `${p.name}の詳細ページ`,
    pubDate: new Date(p.created_at),
  }));

  const articleItems = sortedArticles.map((a) => ({
    title: a.title,
    link: `${SITE_URL}/article/${a.slug}/`,
    description: a.description,
    pubDate: new Date(a.publishedAt),
  }));

  // 商品と記事を合わせて日付降順でソート
  const allItems = [...productItems, ...articleItems].sort(
    (a, b) => b.pubDate.getTime() - a.pubDate.getTime()
  );

  return rss({
    title: 'CAST/LOG - ルアーデータベース',
    description: '釣り人のためのルアーデータベース。国内主要メーカーのルアーを網羅的に掲載。',
    site: SITE_URL,
    items: allItems,
    customData: `<language>ja</language>
<atom:link href="${SITE_URL}/rss.xml" rel="hub" xmlns:atom="http://www.w3.org/2005/Atom" />
<atom:link href="https://pubsubhubbub.appspot.com/" rel="hub" xmlns:atom="http://www.w3.org/2005/Atom" />`,
  });
}
