// scripts/scrapers/shopify-brands.ts
// Shopify JSON API ベースの US ブランド一括定義
//
// shopify-generic.ts のファクトリー関数を使い、ブランド設定を渡すだけで
// スクレイパー関数を生成する。新 Shopify ブランド追加時はここに追記。

import { createShopifyScraper, type ShopifyBrandConfig } from './shopify-generic.js';

// ---------------------------------------------------------------------------
// ブランド設定
// ---------------------------------------------------------------------------

const BRANDS: ShopifyBrandConfig[] = [
  {
    name: '6th Sense',
    slug: '6th-sense',
    baseUrl: 'https://6thsensefishing.com',
    extraTypeRules: [
      { keywords: /cloud\s*9/i, type: 'クランクベイト' },
      { keywords: /crush/i, type: 'クランクベイト' },
      { keywords: /provoke/i, type: 'ミノー' },
      { keywords: /vega/i, type: 'フロッグ' },
      { keywords: /dogma/i, type: 'トップウォーター' },
      { keywords: /axis/i, type: 'スイムベイト' },
      { keywords: /divine/i, type: 'スピナーベイト' },
      { keywords: /flush/i, type: 'バイブレーション' },
    ],
  },
  {
    name: 'Berkley (US)',
    slug: 'berkley-us',
    baseUrl: 'https://www.berkley-fishing.com',
    // berkley-fishing.com は釣具全般を販売（ライン・ロッド含む）
    // スクレイパーは個別商品URL呼び出しなので問題なし
    // フィルタリングは discover 側で実施
    extraTypeRules: [
      { keywords: /powerbait|gulp|havoc|pit boss|chigger/i, type: 'ワーム' },
      { keywords: /flicker/i, type: 'クランクベイト' },
      { keywords: /choppo/i, type: 'トップウォーター' },
      { keywords: /warpig|war\s*pig/i, type: 'バイブレーション' },
      { keywords: /dredger/i, type: 'クランクベイト' },
      { keywords: /stunna/i, type: 'ミノー' },
    ],
  },
  {
    name: 'LiveTarget',
    slug: 'livetarget',
    baseUrl: 'https://livetargetlures.com',
    extraTypeRules: [
      { keywords: /hollow\s*body/i, type: 'フロッグ' },
      { keywords: /crawfish|crayfish/i, type: 'ワーム' },
      { keywords: /sunfish|bluegill|shad|minnow/i, type: 'スイムベイト' },
    ],
  },
  {
    name: 'Lunkerhunt',
    slug: 'lunkerhunt',
    baseUrl: 'https://lunkerhunt.com',
    extraTypeRules: [
      { keywords: /phantom\s*spider/i, type: 'トップウォーター' },
      { keywords: /prop\s*fish/i, type: 'トップウォーター' },
      { keywords: /combat|lunker/i, type: 'フロッグ' },
      { keywords: /bento|impact/i, type: 'ワーム' },
    ],
  },
  {
    name: 'Missile Baits',
    slug: 'missile-baits',
    baseUrl: 'https://www.missilebaits.store',
    // ソフトプラスチックベイト専門ブランド
    extraTypeRules: [
      { keywords: /d-bomb|dbomb|baby\s*d|quiver|twin\s*turbo|48|ike.s|the\s*48|drop\s*craw|craw\s*father|mini\s*drag|neko/i, type: 'ワーム' },
    ],
    defaultTargetFish: 'ブラックバス',
  },
  {
    name: 'SPRO',
    slug: 'spro',
    baseUrl: 'https://www.spro.com',
    extraTypeRules: [
      { keywords: /bronzeye|bronze\s*eye/i, type: 'フロッグ' },
      { keywords: /aruku/i, type: 'バイブレーション' },
      { keywords: /bucktail/i, type: 'ラバージグ' },
      { keywords: /mcstick/i, type: 'ミノー' },
      { keywords: /mike\s*mcclelland|rk\s*crawler/i, type: 'クランクベイト' },
      // 日本市場向けソルトウォータージグ（SHIMMY/PESCE/AIYA/BANANA等）
      { keywords: /shimmy|pesce|aiya|banana\s*jig|inchiku/i, type: 'メタルジグ' },
      { keywords: /pop\s*cork/i, type: 'トップウォーター' },
      { keywords: /cyclone\s*prop/i, type: 'トップウォーター' },
      { keywords: /slender\s*hunter|swimming\s*squid/i, type: 'メタルジグ' },
      // エビ型ワーム
      { keywords: /sakura.*shrimp|pintail|pocket\s*tail|wave\s*tail|kick\s*back/i, type: 'ワーム' },
    ],
  },
  {
    name: 'Googan Baits',
    slug: 'googan-baits',
    baseUrl: 'https://googansquad.com',
    // バス用ソフトベイト主体
    extraTypeRules: [
      { keywords: /rattlin|bandito|klutch|scout|blooper|revolver/i, type: 'ワーム' },
      { keywords: /squad\s*bug/i, type: 'ワーム' },
    ],
  },
  {
    name: 'Lunker City',
    slug: 'lunker-city',
    baseUrl: 'https://lunkercity.com',
    // ソフトプラスチックベイト専門
    extraTypeRules: [
      { keywords: /slug-go|sluggo|fin-s/i, type: 'ワーム' },
    ],
  },
  {
    name: 'Riot Baits',
    slug: 'riot-baits',
    baseUrl: 'https://riotbaits.com',
    // ソフトプラスチックベイト主体
    extraTypeRules: [
      { keywords: /fuzzbug|minima|riot/i, type: 'ワーム' },
    ],
  },
  {
    name: 'X Zone Lures',
    slug: 'xzone-lures',
    baseUrl: 'https://xzonelures.com',
    // ソフトプラスチックベイト主体
    extraTypeRules: [
      { keywords: /muscle|pro|lures|x\s*zone/i, type: 'ワーム' },
      { keywords: /mega\s*swammer|swammer/i, type: 'スイムベイト' },
    ],
  },
];

// ---------------------------------------------------------------------------
// 各ブランドのスクレイパー関数をエクスポート
// ---------------------------------------------------------------------------

export const scrape6thSensePage = createShopifyScraper(BRANDS[0]);
export const scrapeBerkleyUSPage = createShopifyScraper(BRANDS[1]);
export const scrapeLiveTargetPage = createShopifyScraper(BRANDS[2]);
export const scrapeLunkerhuntPage = createShopifyScraper(BRANDS[3]);
export const scrapeMissileBaitsPage = createShopifyScraper(BRANDS[4]);
export const scrapeSproPage = createShopifyScraper(BRANDS[5]);
export const scrapeGooganBaitsPage = createShopifyScraper(BRANDS[6]);
export const scrapeLunkerCityPage = createShopifyScraper(BRANDS[7]);
export const scrapeRiotBaitsPage = createShopifyScraper(BRANDS[8]);
export const scrapeXZonePage = createShopifyScraper(BRANDS[9]);
