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
    changefreq: 'weekly',
    priority: 0.7,
    lastmod: new Date(),
    filter: (page) => !page.includes('/search/') && !page.includes('/trap/'),
  })],
  vite: {
    plugins: [tailwindcss()]
  }
});
