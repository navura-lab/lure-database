// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { contentArticles } from './src/data/articles/_index.js';

// 記事slugから最新更新日へのマップ（sitemap lastmod用）
const articleDateMap = new Map(
  contentArticles.map(a => [a.slug, a.updatedAt || a.publishedAt])
);

// https://astro.build/config
export default defineConfig({
  site: 'https://castlog.xyz',
  output: 'static',
  trailingSlash: 'always',
  adapter: vercel(),
  integrations: [sitemap({
    lastmod: new Date(),
    entryLimit: 5000, // 11,000+URLを3分割 → Googlebot回遊効率化
    filter: (page) => !page.includes('/search/') && !page.includes('/trap/'),
    serialize: (item) => {
      const url = item.url;
      // ホームページ: 最高優先度・毎日更新
      if (url === 'https://castlog.xyz/' || url === 'https://castlog.xyz') {
        return { ...item, changefreq: 'daily', priority: 1.0 };
      }
      // 新着ページ: 毎日更新
      if (url.includes('/new/')) {
        return { ...item, changefreq: 'daily', priority: 0.9 };
      }
      // 一覧ページ（メーカー/タイプ/対象魚/カタログ/ガイド/比較/釣り方/記事/季節）: 週次更新
      if (url.match(/\/(maker|type|fish|ranking|guide|compare|method|article|season)\/$/)) {
        return { ...item, changefreq: 'weekly', priority: 0.8 };
      }
      // 記事詳細: publishedAt/updatedAtをlastmodに使用
      const articleMatch = url.match(/\/article\/([a-z0-9-]+)\/$/);
      if (articleMatch) {
        const articleSlug = articleMatch[1];
        const dateStr = articleDateMap.get(articleSlug);
        const lastmod = dateStr ? new Date(dateStr) : item.lastmod;
        return { ...item, lastmod, changefreq: 'monthly', priority: 0.6 };
      }
      // ガイド・釣り方・季節詳細: 月次（先にマッチさせてメーカー詳細と混同させない）
      if (url.match(/\/(guide|method|season)\/[a-z0-9-]+\//)) {
        return { ...item, changefreq: 'monthly', priority: 0.6 };
      }
      // カテゴリ詳細（タイプ/対象魚/ランキング/比較）: 週次
      if (url.match(/\/(type|fish|ranking|compare)\/[a-z0-9-]+\//)) {
        return { ...item, changefreq: 'weekly', priority: 0.6 };
      }
      // メーカー詳細: 週次更新（新商品追加あり）
      if (url.match(/\/[a-z0-9-]+\/$/) && !url.includes('/type/') && !url.includes('/fish/') && !url.includes('/ranking/') && !url.includes('/guide/') && !url.includes('/new/') && !url.includes('/maker/') && !url.includes('/compare/') && !url.includes('/method/') && !url.includes('/article/') && !url.includes('/season/')) {
        return { ...item, changefreq: 'weekly', priority: 0.7 };
      }
      // ルアー詳細ページ: 月次
      return { ...item, changefreq: 'monthly', priority: 0.5 };
    },
  })],
  vite: {
    plugins: [tailwindcss()]
  }
});
