import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { contentArticles } from './src/data/articles/_index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// 記事slugから最新更新日へのマップ（sitemap lastmod用）
const articleDateMap = new Map(
  contentArticles.map(a => [a.slug, a.updatedAt || a.publishedAt])
);

// ルアーページのlastmod用: キャッシュからslug単位の最新updated_atマップを構築
// キー: "{manufacturer_slug}/{slug}" → 値: Date
const lureLastmodMap = new Map();
const CACHE_FILE = join(process.cwd(), '.cache', 'lures.json');
if (existsSync(CACHE_FILE)) {
  try {
    const lures = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    for (const lure of lures) {
      const key = `${lure.manufacturer_slug}/${lure.slug}`;
      const updatedAt = lure.updated_at;
      if (!updatedAt) continue;
      const existing = lureLastmodMap.get(key);
      if (!existing || updatedAt > existing) {
        lureLastmodMap.set(key, updatedAt);
      }
    }
    console.log(`[sitemap] Loaded lastmod for ${lureLastmodMap.size} lure series from cache`);
  } catch (e) {
    console.warn('[sitemap] Cache read failed, using build date for all pages:', e);
  }
}

// メーカー単位の最新updated_atマップ（メーカーページ用）
const makerLastmodMap = new Map();
for (const [key, dateStr] of lureLastmodMap) {
  const makerSlug = key.split('/')[0];
  const existing = makerLastmodMap.get(makerSlug);
  if (!existing || dateStr > existing) {
    makerLastmodMap.set(makerSlug, dateStr);
  }
}

const buildDate = new Date();

// https://astro.build/config
export default defineConfig({
  site: 'https://www.castlog.xyz',
  output: 'static',
  trailingSlash: 'always',
  adapter: vercel(),
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja', 'en'],
    routing: {
      prefixDefaultLocale: false, // ja は /ranking/xxx/（変更なし）、en は /en/ranking/xxx/
    },
  },
  integrations: [sitemap({
    i18n: {
      defaultLocale: 'ja',
      locales: { ja: 'ja-JP', en: 'en-US' },
    },
    lastmod: buildDate,
    entryLimit: 5000, // 11,000+URLを3分割 → Googlebot回遊効率化
    filter: (page) => !page.includes('/search/') && !page.includes('/trap/') && !page.includes('/en/'),
    serialize: (item) => {
      const url = item.url;
      // ホームページ: 最高優先度・毎日更新
      if (url === 'https://www.castlog.xyz/' || url === 'https://www.castlog.xyz') {
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
      // カテゴリ詳細（タイプ/対象魚/ランキング/比較）: 週次、lastmodはビルド日時
      if (url.match(/\/(type|fish|ranking|compare)\/[a-z0-9-]+\//)) {
        return { ...item, lastmod: buildDate, changefreq: 'weekly', priority: 0.6 };
      }
      // ルアー詳細ページ: DBのupdated_atを使用
      // URL形式: https://www.castlog.xyz/{manufacturer_slug}/{slug}/
      const lureMatch = url.match(/castlog\.xyz\/([a-z0-9-]+)\/([a-z0-9-]+)\/$/);
      if (lureMatch) {
        const [, makerSlug, lureSlug] = lureMatch;
        // 既知のカテゴリパスは除外（上でマッチ済みのはず）
        if (!['type', 'fish', 'ranking', 'guide', 'new', 'maker', 'compare', 'method', 'article', 'season'].includes(makerSlug)) {
          const key = `${makerSlug}/${lureSlug}`;
          const dbDate = lureLastmodMap.get(key);
          const lastmod = dbDate ? new Date(dbDate) : item.lastmod;
          return { ...item, lastmod, changefreq: 'monthly', priority: 0.5 };
        }
      }
      // メーカー詳細ページ: 配下ルアーの最新updated_atを使用
      const makerMatch = url.match(/castlog\.xyz\/([a-z0-9-]+)\/$/);
      if (makerMatch) {
        const makerSlug = makerMatch[1];
        if (!['type', 'fish', 'ranking', 'guide', 'new', 'maker', 'compare', 'method', 'article', 'season', 'search', 'about', 'privacy', 'disclaimer'].includes(makerSlug)) {
          const dbDate = makerLastmodMap.get(makerSlug);
          const lastmod = dbDate ? new Date(dbDate) : item.lastmod;
          return { ...item, lastmod, changefreq: 'weekly', priority: 0.7 };
        }
      }
      // その他: ビルド日時
      return { ...item, changefreq: 'monthly', priority: 0.5 };
    },
  })],
  vite: {
    plugins: [tailwindcss()]
  }
});
