/**
 * UI文言辞書 — Header/Footer/コンポーネント/ページテンプレート共通
 */

export const UI = {
  ja: {
    // サイト
    siteName: 'CAST/LOG',
    siteDescription: '釣り人のためのルアーデータベース。6,000以上のシリーズ、165,000色以上のカラーを網羅。',
    tagline: '一投を、資産にする。',

    // ナビゲーション
    nav: {
      maker: 'メーカー',
      type: 'タイプ',
      fish: '対象魚',
      catalog: 'カタログ',
      method: '釣り方',
      season: '季節',
      guide: 'ガイド',
      article: '特集',
      search: '検索',
    },

    // パンくず
    breadcrumb: {
      home: 'トップ',
      catalog: 'カタログ',
      compare: '比較',
      type: 'タイプ',
      fish: '対象魚',
      maker: 'メーカー',
      article: '特集',
      method: '釣り方',
      season: '季節',
      guide: 'ガイド',
    },

    // スペックラベル
    spec: {
      weight: '重量',
      length: '全長',
      depth: 'レンジ',
      action: 'アクション',
      series: 'シリーズ数',
      colors: 'カラー数',
      makers: 'メーカー数',
      priceRange: '価格帯',
      type: 'タイプ',
      targetFish: '対象魚',
      manufacturer: 'メーカー',
    },

    // ルアーカード
    lureCard: {
      colors: 'カラー',
      new: '新着',
      limited: '限定',
    },

    // セクション見出し
    section: {
      specComparison: 'スペック比較',
      colorAnalysis: 'カラー系統の比較',
      priceComparison: '価格帯の比較',
      recommendation: 'どれを選ぶべきか',
      faq: 'よくある質問',
      relatedArticles: '関連する特集記事',
      colorList: 'カラー一覧',
      fieldCompatibility: 'フィールド対応度',
      weightStrategy: 'ウェイト戦略',
      similarSeries: '類似シリーズ比較',
      usageAdvice: '使い方アドバイス',
      aboutRanking: '掲載順について',
      selectionGuide: 'データから見る選び方のポイント',
      registeredLures: '登録ルアー',
      relatedCategory: '関連カテゴリ',
      newArrivals: '新着ルアー',
      topSeries: 'TOP5シリーズ',
      categoryBreakdown: 'カテゴリ分布',
    },

    // フッター
    footer: {
      type: 'タイプ',
      maker: 'メーカー',
      fish: '対象魚',
      siteInfo: 'サイト情報',
      home: 'ホーム',
      search: '検索',
      compare: '比較',
      method: '釣り方',
      season: '季節で選ぶ',
      new: '新着',
      guide: 'ガイド',
      article: '特集記事',
      makerList: 'メーカー一覧',
      seeAll: 'すべて見る →',
    },

    // ランキング・比較ページ
    ranking: {
      title: (fish: string, type: string, count: number, year: number) =>
        `${fish} ${type} おすすめランキング${count}選【${year}年】`,
      description: (count: number, colors: number) =>
        `全${colors}カラー・${count}シリーズを徹底比較。`,
      compareLink: '上位モデルを比較 →',
      guideLink: 'ガイド記事で詳しく読む →',
      allLures: 'のルアー一覧',
    },

    compare: {
      title: (fish: string, type: string, count: number) =>
        `${fish}向け${type} 比較${count}選`,
      summary: (count: number) =>
        `総合評価上位${count}モデルを横並び比較`,
    },

    // 共通
    common: {
      seeAll: 'すべて見る →',
      itemUnit: '件',
      seriesUnit: 'シリーズ',
      other: 'その他',
    },

    // aria-label
    aria: {
      openMenu: 'メニューを開く',
      closeMenu: 'メニューを閉じる',
      languageSwitch: '言語切替',
    },
  },

  en: {
    // サイト
    siteName: 'CAST/LOG',
    siteDescription: 'The ultimate JDM fishing lure database. Over 6,000 series and 165,000 color variants cataloged.',
    tagline: 'Turn every cast into data.',

    // ナビゲーション
    nav: {
      maker: 'Brands',
      type: 'Type',
      fish: 'Target Fish',
      catalog: 'Catalog',
      method: 'Method',
      season: 'Season',
      guide: 'Guide',
      article: 'Features',
      search: 'Search',
    },

    // パンくず
    breadcrumb: {
      home: 'Home',
      catalog: 'Catalog',
      compare: 'Compare',
      type: 'Type',
      fish: 'Target Fish',
      maker: 'Brands',
      article: 'Features',
      method: 'Method',
      season: 'Season',
      guide: 'Guide',
    },

    // スペックラベル
    spec: {
      weight: 'Weight',
      length: 'Length',
      depth: 'Diving Depth',
      action: 'Action',
      series: 'Series',
      colors: 'Colors',
      makers: 'Brands',
      priceRange: 'Price Range',
      type: 'Type',
      targetFish: 'Target Fish',
      manufacturer: 'Brand',
    },

    // ルアーカード
    lureCard: {
      colors: 'colors',
      new: 'New',
      limited: 'Limited',
    },

    // セクション見出し
    section: {
      specComparison: 'Spec Comparison',
      colorAnalysis: 'Color Pattern Analysis',
      priceComparison: 'Price Comparison',
      recommendation: 'Which One Should You Choose?',
      faq: 'FAQ',
      relatedArticles: 'Related Articles',
      colorList: 'Color Variants',
      fieldCompatibility: 'Field Compatibility',
      weightStrategy: 'Weight Strategy',
      similarSeries: 'Similar Series Comparison',
      usageAdvice: 'Usage Tips',
      aboutRanking: 'About Our Rankings',
      selectionGuide: 'Data-Driven Buying Guide',
      registeredLures: 'Listed Lures',
      relatedCategory: 'Related Categories',
      newArrivals: 'New Arrivals',
      topSeries: 'Top 5 Series',
      categoryBreakdown: 'Category Breakdown',
    },

    // フッター
    footer: {
      type: 'Lure Type',
      maker: 'Brands',
      fish: 'Target Fish',
      siteInfo: 'Site Info',
      home: 'Home',
      search: 'Search',
      compare: 'Compare',
      method: 'Methods',
      season: 'Seasonal Guide',
      new: 'New Arrivals',
      guide: 'Guides',
      article: 'Features',
      makerList: 'All Brands',
      seeAll: 'See all →',
    },

    // ランキング・比較ページ
    ranking: {
      title: (fish: string, type: string, count: number, year: number) =>
        `Best ${type} for ${fish}: Top ${count} Picks [${year}]`,
      description: (count: number, colors: number) =>
        `${count} series and ${colors} color options compared side by side.`,
      compareLink: 'Compare top models →',
      guideLink: 'Read the full guide →',
      allLures: 'lure catalog',
    },

    compare: {
      title: (fish: string, type: string, count: number) =>
        `${fish} ${type} Comparison: Top ${count}`,
      summary: (count: number) =>
        `Side-by-side comparison of the top ${count} models`,
    },

    // 共通
    common: {
      seeAll: 'See all →',
      itemUnit: '',
      seriesUnit: 'series',
      other: 'Other',
    },

    // aria-label
    aria: {
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
      languageSwitch: 'Switch language',
    },
  },
};

/** UI辞書の型（jaとenの構造的共通型） */
export interface UIDict {
  siteName: string;
  siteDescription: string;
  tagline: string;
  nav: Record<string, string>;
  breadcrumb: Record<string, string>;
  spec: Record<string, string>;
  lureCard: Record<string, string>;
  section: Record<string, string>;
  footer: Record<string, string>;
  ranking: {
    title: (fish: string, type: string, count: number, year: number) => string;
    description: (count: number, colors: number) => string;
    compareLink: string;
    guideLink: string;
    allLures: string;
  };
  compare: {
    title: (fish: string, type: string, count: number) => string;
    summary: (count: number) => string;
  };
  common: Record<string, string>;
  aria: Record<string, string>;
}
