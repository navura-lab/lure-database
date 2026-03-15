/**
 * 価格帯別ガイドページ用データ定義
 *
 * 5段階の価格帯でルアーをフィルタし、ガイドページを生成する。
 * 「安い ルアー おすすめ」「コスパ ルアー」等の購買意図KW狙い。
 */

export interface PriceRange {
  slug: string;
  name: string;
  description: string;           // meta description
  priceMin: number;              // 最低価格（円）
  priceMax: number;              // 最高価格（円）
  label: string;                 // 表示用ラベル
  characteristics: string;      // 価格帯の特徴説明
  buyerProfile: string;         // 想定ユーザー像
  tips: string[];               // 選び方のコツ
  faq: { question: string; answer: string }[];
  // English fields (optional)
  nameEn?: string;
  descriptionEn?: string;
  labelEn?: string;
  characteristicsEn?: string;
  buyerProfileEn?: string;
  tipsEn?: string[];
  faqEn?: { question: string; answer: string }[];
}

export const priceRanges: PriceRange[] = [
  {
    slug: 'under-1000',
    name: '1,000円以下のルアー',
    description: '1,000円以下で買えるおすすめルアー一覧。コスパ最強のルアーをタイプ別に紹介。初心者にもおすすめの低価格帯ルアーガイド。',
    priceMin: 0,
    priceMax: 1000,
    label: '〜¥1,000',
    characteristics: '初心者やロスト覚悟のストラクチャー攻めに最適な価格帯。メタルジグやワームが中心で、実釣性能も十分。根がかりを恐れず攻められるのが最大のメリット。',
    buyerProfile: '釣り初心者、コスパ重視のアングラー、ロストの多いフィールドで使いたい方',
    tips: [
      'メタルジグはこの価格帯でも十分な飛距離と釣果が出る',
      'ワームはコスパ最強。1パックで複数釣行分カバーできる',
      '根がかりしやすいポイントではこの価格帯を積極的に使う',
      'ダイソーなどの100均ルアーも侮れない。特にジグは実績あり',
    ],
    faq: [
      { question: '1,000円以下のルアーでも釣れる？', answer: 'はい、十分釣れます。特にメタルジグやワームは価格と釣果の相関が低く、安価なものでも高い実釣性能を発揮します。' },
      { question: '初心者が最初に買うべき1,000円以下のルアーは？', answer: 'メタルジグ（20〜40g）とワーム+ジグヘッドのセットがおすすめ。幅広い魚種に対応でき、ロストしても懐が痛みにくいです。' },
    ],
    nameEn: 'Lures Under $7 (¥1,000)',
    descriptionEn: 'Best budget lures under $7 (¥1,000). Metal jigs, soft plastics, and other high-value JDM lures that deliver results without breaking the bank.',
    labelEn: 'Under $7',
    characteristicsEn: 'The sweet spot for beginners and anglers who fish heavy cover where snags are inevitable. Metal jigs and soft plastics dominate this range, and they catch fish just as well as pricier options. Being able to cast fearlessly into structure is the biggest advantage of fishing this price tier.',
    buyerProfileEn: 'Beginners, budget-conscious anglers, anyone fishing snag-heavy spots where losing lures is part of the game',
    tipsEn: [
      'Metal jigs in this range deliver excellent casting distance and catch rates — no need to spend more',
      'Soft plastics are the ultimate value pick; a single pack covers multiple fishing trips',
      'Use these confidently around heavy cover and structure where snags are likely',
      'Japanese 100-yen-shop lures (like Daiso) punch above their weight — especially jigs with proven track records',
    ],
    faqEn: [
      { question: 'Can lures under $7 actually catch fish?', answer: 'Absolutely. Metal jigs and soft plastics in particular show very little correlation between price and catch rate. Budget JDM lures deliver serious performance on the water.' },
      { question: 'What should a beginner buy first under $7?', answer: 'Start with a metal jig (20–40g) and a soft plastic + jighead combo. These cover a wide range of species and are easy on the wallet when you inevitably lose a few.' },
    ],
  },
  {
    slug: '1000-1500',
    name: '1,000〜1,500円のルアー',
    description: '1,000〜1,500円のおすすめルアー一覧。エントリークラスのハードルアーが揃うコスパ良好な価格帯。タイプ別にルアーを紹介。',
    priceMin: 1000,
    priceMax: 1500,
    label: '¥1,000〜¥1,500',
    characteristics: 'エントリークラスのハードルアーが揃う価格帯。国内メーカーのスタンダードモデルや、海外メーカーの主力製品が多い。性能と価格のバランスが良い。',
    buyerProfile: 'コスパを重視するアングラー、ルアーの数を揃えたい方、サブ用ルアーを探している方',
    tips: [
      'この価格帯はバイブレーションやシンキングペンシルの選択肢が豊富',
      'セール時に定番ルアーをまとめ買いするのがお得',
      'カラーバリエーションを揃えるならこの価格帯がベスト',
      'クランクベイトやスピナーベイトもこの価格帯から選べる',
    ],
    faq: [
      { question: 'この価格帯のルアーと高級ルアーの違いは？', answer: '基本的な釣果に大差はありません。高級品は飛距離・アクションの安定性・フック品質などで優れますが、この価格帯でも十分な実釣性能があります。' },
      { question: 'コスパの良いルアーブランドは？', answer: 'ダイワ、メジャークラフト、ジャクソン、ブルーブルーなどがこの価格帯で高品質なルアーを展開しています。' },
    ],
    nameEn: 'Lures $7–$10 (¥1,000–¥1,500)',
    descriptionEn: 'Best lures in the $7–$10 range (¥1,000–¥1,500). Entry-level hard baits from top JDM brands at great value. Browse by lure type.',
    labelEn: '$7–$10',
    characteristicsEn: 'This is where entry-level hard baits start to appear. You will find standard models from major Japanese domestic brands alongside flagship products from international manufacturers. An excellent balance of performance and price.',
    buyerProfileEn: 'Value-oriented anglers, those building out a lure collection, anyone looking for reliable backup lures',
    tipsEn: [
      'Vibrations and sinking pencils have particularly strong selection in this range',
      'Watch for sales to stock up on proven performers at even better prices',
      'This is the best tier for building out your color lineup without overspending',
      'Crankbaits and spinnerbaits from brands like Daiwa and Major Craft are available here',
    ],
    faqEn: [
      { question: 'How do these compare to premium lures?', answer: 'Catch rates are comparable. Premium lures may edge ahead in casting distance, action consistency, and hook quality, but $7–$10 JDM lures deliver solid real-world performance.' },
      { question: 'Which brands offer the best value?', answer: 'Daiwa, Major Craft, Jackson, and Blue Blue all produce high-quality lures in this price range that rival more expensive competitors.' },
    ],
  },
  {
    slug: '1500-2000',
    name: '1,500〜2,000円のルアー',
    description: '1,500〜2,000円のおすすめルアー一覧。国内メーカーのスタンダード〜ミドルクラスが揃うボリュームゾーン。タイプ別に紹介。',
    priceMin: 1500,
    priceMax: 2000,
    label: '¥1,500〜¥2,000',
    characteristics: '最も選択肢が多いボリュームゾーン。シマノ・ダイワの主力モデルからメガバス・エバーグリーンの中堅モデルまで幅広く揃う。ルアーフィッシングのスタンダード価格帯。',
    buyerProfile: '中級者、特定のルアータイプを深掘りしたい方、メインルアーを選びたい方',
    tips: [
      'シマノ・ダイワの人気シリーズの多くがこの価格帯に集中',
      'ミノー・シンキングペンシルはこの価格帯が品質と価格のベストバランス',
      '定番ルアーを一通り揃えるならこの価格帯を中心に',
      'フックの品質も上がり、そのまま実戦投入できるモデルが多い',
    ],
    faq: [
      { question: 'この価格帯でおすすめのミノーは？', answer: 'シマノ サイレントアサシン、ダイワ ショアラインシャイナーZ、ジャクソン アスリートなど、実績の高い定番モデルが揃っています。' },
      { question: '1,500〜2,000円は高い？安い？', answer: 'ハードルアーの相場としては標準的な価格帯です。最も選択肢が多く、性能と価格のバランスが良いゾーンです。' },
    ],
    nameEn: 'Lures $10–$13 (¥1,500–¥2,000)',
    descriptionEn: 'Best lures in the $10–$13 range (¥1,500–¥2,000). The volume zone for JDM lures — standard models from Shimano, Daiwa, Megabass, and more. Browse by type.',
    labelEn: '$10–$13',
    characteristicsEn: 'The volume zone with the widest selection of any price tier. This is where Shimano and Daiwa park their flagship series, and where Megabass and Evergreen offer mid-range models. Consider this the standard price point for Japanese lure fishing.',
    buyerProfileEn: 'Intermediate anglers, those exploring specific lure types in depth, anyone choosing a main-rotation lure',
    tipsEn: [
      'Many of Shimano and Daiwa\'s most popular series fall squarely in this range',
      'For minnows and sinking pencils, this tier offers the best quality-to-price ratio',
      'Build your core lineup around this price point for the widest variety of proven models',
      'Hook quality improves significantly here — most models are ready to fish straight out of the box',
    ],
    faqEn: [
      { question: 'What are the best minnows in this range?', answer: 'The Shimano Silent Assassin, Daiwa Shoreline Shiner Z, and Jackson Athlete are all proven JDM performers with serious track records in this price tier.' },
      { question: 'Is $10–$13 expensive or cheap for a lure?', answer: 'It is the standard price point for hard baits in Japan. This tier has the most options and offers the best balance between performance and cost.' },
    ],
  },
  {
    slug: '2000-3000',
    name: '2,000〜3,000円のルアー',
    description: '2,000〜3,000円のおすすめルアー一覧。ハイスペックモデルが揃う価格帯。こだわりのアクション・飛距離を求めるアングラー向け。',
    priceMin: 2000,
    priceMax: 3000,
    label: '¥2,000〜¥3,000',
    characteristics: '各メーカーのフラッグシップモデルが集まるハイスペック帯。飛距離・アクション・耐久性のいずれも高水準。ビッグベイトやジョイントベイトの入門価格帯でもある。',
    buyerProfile: '上級者、特定の性能にこだわるアングラー、ビッグベイト入門者',
    tips: [
      'この価格帯のルアーは飛距離・アクション精度が格段に向上する',
      'ビッグベイトやジョイントベイトを始めるならこの価格帯から',
      'フックやスプリットリングも高品質なものが標準装備',
      '限定カラーやコラボモデルもこの価格帯に多い',
    ],
    faq: [
      { question: '2,000円以上のルアーは必要？', answer: '必須ではありませんが、飛距離・アクションの安定性・フック品質など、トータルの完成度が高くなります。特定の状況で差が出る場面があります。' },
      { question: 'この価格帯のビッグベイト入門モデルは？', answer: 'ジャッカルやメガバスのエントリーモデルがこの価格帯で購入可能。まずは2,000〜3,000円台のモデルで感覚を掴みましょう。' },
    ],
    nameEn: 'Lures $13–$20 (¥2,000–¥3,000)',
    descriptionEn: 'Best lures in the $13–$20 range (¥2,000–¥3,000). High-spec flagship models from top JDM brands. For anglers who demand peak performance.',
    labelEn: '$13–$20',
    characteristicsEn: 'The high-spec tier where each manufacturer\'s flagship models reside. Casting distance, action precision, and durability are all top-notch. This is also the entry point for big baits and jointed swimbaits in the Japanese market.',
    buyerProfileEn: 'Advanced anglers, those who demand specific performance characteristics, big bait beginners',
    tipsEn: [
      'Lures in this range show a noticeable jump in casting distance and action precision',
      'If you are getting into big baits or jointed swimbaits, this is the starting price tier',
      'Hooks and split rings are premium quality as standard — no upgrades needed',
      'Limited-edition colorways and brand collaborations are common at this price point',
    ],
    faqEn: [
      { question: 'Are lures over $13 worth it?', answer: 'Not strictly necessary, but the overall completeness improves — casting distance, action stability, and hook quality all step up. The difference shows in specific situations where precision matters.' },
      { question: 'What big baits can I get in this range?', answer: 'Entry-level models from Jackall and Megabass are available here. Start with a $13–$20 big bait to learn the feel before investing in higher-end options.' },
    ],
  },
  {
    slug: 'over-3000',
    name: '3,000円以上のルアー',
    description: '3,000円以上のプレミアムルアー一覧。ビッグベイト・ジョイントベイト・限定モデルが揃う高級価格帯。タイプ別に紹介。',
    priceMin: 3000,
    priceMax: 999999,
    label: '¥3,000〜',
    characteristics: 'ビッグベイト・ジョイントベイトが主力の高級価格帯。ハンドメイドルアーや限定生産モデルも。コレクション要素もあり、ルアーフィッシングの醍醐味を味わえる。',
    buyerProfile: 'ビッグベイト愛好家、コレクター、記録狙いのアングラー',
    tips: [
      'ビッグベイトは3,000〜5,000円台がボリュームゾーン',
      'ハンドメイドルアーは10,000円超も。投資としてのルアーも',
      'ロストリスクを考慮してフィールドを選ぶのも大事',
      '限定カラーはリセールバリューが高いことも',
    ],
    faq: [
      { question: '3,000円以上のルアーで釣果は変わる？', answer: '一般的なハードルアーでは劇的な差は出にくいですが、ビッグベイトなど大型ルアーはこの価格帯が標準です。飛距離やアクションの質で差が出る場面もあります。' },
      { question: '高級ルアーのロスト対策は？', answer: '根がかり回収機を携帯する、ストラクチャーの少ないオープンエリアで使用する、太めのリーダーを使用するなどの対策が有効です。' },
    ],
    nameEn: 'Premium Lures $20+ (¥3,000+)',
    descriptionEn: 'Premium JDM lures over $20 (¥3,000+). Big baits, jointed swimbaits, handmade lures, and limited-edition collector items. Browse by type.',
    labelEn: '$20+',
    characteristicsEn: 'The premium tier dominated by big baits and jointed swimbaits. Handmade lures and limited-production runs live here too. Beyond pure fishing performance, there is a collectibility factor — this is where the art and craft of Japanese lure making truly shines.',
    buyerProfileEn: 'Big bait enthusiasts, lure collectors, trophy hunters chasing personal records',
    tipsEn: [
      'Big baits from Jackall, Megabass, and Gan Craft cluster in the $20–$35 range',
      'Handmade Japanese lures can exceed $70 — some anglers treat them as investments',
      'Factor snag risk into your spot selection; losing a $30 lure stings',
      'Limited-edition colorways often hold or increase in resale value among collectors',
    ],
    faqEn: [
      { question: 'Do $20+ lures catch more fish?', answer: 'For standard hard baits, the difference is marginal. However, big baits and jointed swimbaits are priced here by default. Where premium lures excel is in casting distance, action refinement, and build quality.' },
      { question: 'How do I avoid losing expensive lures?', answer: 'Carry a lure retriever, fish open areas with less structure, and use heavier leader material. These simple precautions dramatically reduce the pain of fishing premium tackle.' },
    ],
  },
];
