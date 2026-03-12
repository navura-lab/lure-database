// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.lure-db.com',
  output: 'static',
  trailingSlash: 'always',
  adapter: vercel(),
  integrations: [sitemap({
    lastmod: new Date(),
    filter: (page) => !page.includes('/search/') && !page.includes('/trap/'),
    serialize: (item) => {
      const url = item.url;
      // ホームページ: 最高優先度・毎日更新
      if (url === 'https://www.lure-db.com/' || url === 'https://www.lure-db.com') {
        return { ...item, changefreq: 'daily', priority: 1.0 };
      }
      // 新着ページ: 毎日更新
      if (url.includes('/new/')) {
        return { ...item, changefreq: 'daily', priority: 0.9 };
      }
      // 一覧ページ（メーカー/タイプ/対象魚/カタログ/ガイド）: 週次更新
      if (url.match(/\/(maker|type|fish|ranking|guide)\/$/)) {
        return { ...item, changefreq: 'weekly', priority: 0.8 };
      }
      // メーカー詳細: 週次更新（新商品追加あり）
      if (url.match(/\/[a-z0-9-]+\/$/) && !url.includes('/type/') && !url.includes('/fish/') && !url.includes('/ranking/') && !url.includes('/guide/') && !url.includes('/new/') && !url.includes('/maker/')) {
        return { ...item, changefreq: 'weekly', priority: 0.7 };
      }
      // カテゴリ詳細（タイプ/対象魚/ランキング/比較）: 週次
      if (url.match(/\/(type|fish|ranking|compare)\/[a-z0-9-]+\//)) {
        return { ...item, changefreq: 'weekly', priority: 0.6 };
      }
      // ガイド記事: 月次
      if (url.includes('/guide/')) {
        return { ...item, changefreq: 'monthly', priority: 0.6 };
      }
      // ルアー詳細ページ: 月次
      return { ...item, changefreq: 'monthly', priority: 0.5 };
    },
  })],
  vite: {
    plugins: [tailwindcss()]
  }
});
