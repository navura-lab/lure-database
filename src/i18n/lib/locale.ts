/**
 * ロケール判定ヘルパー — CAST/LOG i18n
 */

import type { Locale } from './t';

const SITE_URL = 'https://www.castlog.xyz';

/**
 * URLパスからロケールを判定
 */
export function getLocaleFromPath(pathname: string): Locale {
  return pathname.startsWith('/en/') || pathname === '/en' ? 'en' : 'ja';
}

/**
 * Astro.url からロケールを判定
 */
export function getLocale(url: URL): Locale {
  return getLocaleFromPath(url.pathname);
}

/**
 * 現在のパスから日本語版パスを返す
 * /en/ranking/seabass-minnow/ → /ranking/seabass-minnow/
 */
export function getJaPath(pathname: string): string {
  if (pathname.startsWith('/en/')) return pathname.slice(3) || '/';
  if (pathname === '/en') return '/';
  return pathname;
}

/**
 * 現在のパスから英語版パスを返す
 * /ranking/seabass-minnow/ → /en/ranking/seabass-minnow/
 */
export function getEnPath(pathname: string): string {
  if (pathname.startsWith('/en/') || pathname === '/en') return pathname;
  return `/en${pathname}`;
}

/**
 * hreflang 用の絶対URL生成
 */
export function getHreflangUrls(pathname: string) {
  const jaPath = getJaPath(pathname);
  const enPath = getEnPath(jaPath);
  return {
    ja: `${SITE_URL}${jaPath}`,
    en: `${SITE_URL}${enPath}`,
    xDefault: `${SITE_URL}${jaPath}`,
  };
}

/**
 * ロケールに対応するベースパスプレフィックス
 * ja → '' (プレフィックスなし)
 * en → '/en'
 */
export function getBasePrefix(locale: Locale): string {
  return locale === 'en' ? '/en' : '';
}
