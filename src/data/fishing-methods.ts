/**
 * 釣り方別まとめページ用データ定義
 *
 * 各メソッドの対象魚・ルアータイプは category-slugs.ts の
 * FISH_SLUG_MAP / TYPE_SLUG_MAP のキー（日本語名）と一致させること。
 */

export interface FishingMethod {
  slug: string;
  name: string;           // 日本語名
  nameEn: string;         // English name
  description: string;    // 概要文（2-3文）
  descriptionEn: string;  // English description (2-3 sentences)
  targetFish: string[];   // 対象魚（category-slugs の fish 名と一致）
  mainTypes: string[];    // 主要ルアータイプ（category-slugs の type 名と一致）
  fields: string[];       // フィールド（サーフ、磯、港湾 等）
  fieldsEn: string[];     // English field names
  season: string;         // 旬の時期
  seasonEn: string;       // English season
  tips: string[];         // コツ3-5個
  tipsEn: string[];       // English tips (3-5)
}

export const fishingMethods: FishingMethod[] = [
  {
    slug: 'shore-jigging',
    name: 'ショアジギング',
    nameEn: 'Shore Jigging',
    description: '岸からメタルジグを遠投し、青物やヒラマサを狙う釣法。磯やサーフ、堤防など足場を選ばず楽しめる。飛距離とジャークアクションが釣果を左右する。',
    descriptionEn: 'Cast metal jigs from shore to target pelagic fish like yellowtail and amberjack. Works from rocky shores, piers, and beaches. Casting distance and jerk action are key to success.',
    targetFish: ['青物', 'ヒラマサ', 'ブリ'],
    mainTypes: ['メタルジグ', 'ポッパー', 'ダイビングペンシル'],
    fields: ['磯', '堤防', 'サーフ'],
    fieldsEn: ['Rocky Shore', 'Pier', 'Surf'],
    season: '夏〜秋（7月〜11月）',
    seasonEn: 'Summer–Autumn (Jul–Nov)',
    tips: [
      'メタルジグは40〜60gを基準にフィールドの水深と潮流で使い分ける',
      'ワンピッチジャークが基本。速巻き→フォールの緩急で食わせる',
      '朝マズメのナブラ撃ちにはトップウォーター（ポッパー・ダイペン）が有効',
      'ドラグ設定は強めに。根に走られる前に主導権を取る',
      '潮目やブレイクラインを重点的に攻める',
    ],
    tipsEn: [
      'Use 40–60g metal jigs as baseline, adjust for depth and current',
      'One-pitch jerk is fundamental — vary between fast retrieve and fall',
      'Topwater (poppers, diving pencils) are effective for dawn surface feeding',
      'Set drag tight to prevent fish from reaching structure',
      'Focus on tide lines and breakpoints',
    ],
  },
  {
    slug: 'surf-fishing',
    name: 'サーフフィッシング',
    nameEn: 'Surf Fishing',
    description: '砂浜からヒラメやマゴチなどのフラットフィッシュを狙うスタイル。遠投性能が求められ、ミノーやメタルジグで広範囲をサーチする。',
    descriptionEn: 'Target flatfish like flounder and flathead from sandy beaches. Requires long-casting ability, using minnows and metal jigs to search wide areas.',
    targetFish: ['ヒラメ', 'マゴチ', 'シーバス'],
    mainTypes: ['ミノー', 'メタルジグ', 'ワーム'],
    fields: ['サーフ', '河口'],
    fieldsEn: ['Surf', 'River Mouth'],
    season: '秋〜春（10月〜4月）',
    seasonEn: 'Autumn–Spring (Oct–Apr)',
    tips: [
      '離岸流やカケアガリなど地形変化を見極めることが最重要',
      'ミノーは飛距離重視の12〜14cm。ヘビーシンキングが使いやすい',
      'ボトムをゆっくりトレースするのが基本。リフト＆フォールで誘う',
      'メタルジグはただ巻き+ストップが効く。ワームはジグヘッドリグで底付近を',
      'ウェーダーは安全第一。波打ち際の足元にも魚は居る',
    ],
    tipsEn: [
      'Reading rip currents and drop-offs is the most critical skill',
      'Use 12–14cm heavy sinking minnows for distance',
      'Slow bottom trace is fundamental — use lift & fall to trigger strikes',
      'Metal jig steady retrieve + stop works well',
      'Wade safely — fish can be right at your feet',
    ],
  },
  {
    slug: 'eging',
    name: 'エギング',
    nameEn: 'Eging (Squid Jigging)',
    description: 'エギ（餌木）を使ってイカを狙う日本発祥の釣法。シャクリとフォールの組み合わせでイカを抱かせる。手軽さとゲーム性の高さが人気。',
    descriptionEn: 'Japanese-originated method targeting squid with egi (wooden jig). Combine jerking and falling action to trigger squid strikes. Popular for its accessibility and game-like excitement.',
    targetFish: ['イカ'],
    mainTypes: ['エギ'],
    fields: ['堤防', '磯', '漁港'],
    fieldsEn: ['Pier', 'Rocky Shore', 'Harbor'],
    season: '春（3月〜6月）・秋（9月〜11月）',
    seasonEn: 'Spring (Mar–Jun) & Autumn (Sep–Nov)',
    tips: [
      'エギのサイズは秋の新子に2.5号、春の親イカに3.5号が基本',
      '2〜3回シャクリ→テンションフォールでアタリを待つのが王道',
      'カラーはローテーションが大事。ピンク・オレンジ系を軸に状況で変える',
      'アタリは「フォール中に糸が止まる」「テンションが抜ける」など繊細',
      '風が強い日はシャロータイプよりディープタイプで底を取る',
    ],
    tipsEn: [
      'Use 2.5 for autumn young squid, 3.5 for spring spawners',
      '2–3 jerks then tension fall is the classic technique',
      'Color rotation is key — start with pink/orange, adapt to conditions',
      'Bites are subtle — line stops or tension drops during fall',
      'Use deep type in windy conditions to reach bottom',
    ],
  },
  {
    slug: 'ajing',
    name: 'アジング',
    nameEn: 'Ajing (Horse Mackerel)',
    description: 'ジグヘッド+ワームの軽量リグでアジを狙うライトゲーム。繊細なアタリを掛けるテクニカルな釣りで、漁港や堤防で手軽に楽しめる。',
    descriptionEn: 'Ultra-light game targeting horse mackerel with jig head + soft plastic. Technical fishing requiring sensitivity to detect subtle bites. Perfect for harbors and piers.',
    targetFish: ['アジ'],
    mainTypes: ['ジグヘッド', 'ワーム'],
    fields: ['漁港', '堤防'],
    fieldsEn: ['Harbor', 'Pier'],
    season: '通年（特に夏〜秋が好期）',
    seasonEn: 'Year-round (best in summer–autumn)',
    tips: [
      'ジグヘッドは0.5〜1.5gを潮流と水深で使い分ける',
      'ワームは1.5〜2インチのピンテール・ストレート系が万能',
      'レンジキープが釣果の鍵。カウントダウンで層を探る',
      'アタリは「コン」と明確に出ることが多い。即アワセで掛ける',
      '常夜灯周りの明暗部が一級ポイント',
    ],
    tipsEn: [
      'Use 0.5–1.5g jig heads, adjust for current and depth',
      '1.5–2 inch pintail/straight worms are versatile',
      'Maintaining depth is key — count down to find the strike zone',
      'Bites are usually a clear "tap" — set hook immediately',
      'Focus on light/shadow boundaries near harbor lights',
    ],
  },
  {
    slug: 'mebaring',
    name: 'メバリング',
    nameEn: 'Mebaring (Rockfish)',
    description: 'メバルをジグヘッドやプラグで狙うライトゲーム。夜行性のメバルを常夜灯周りで狙うナイトゲームが主流。スローな誘いが基本となる。',
    descriptionEn: 'Light game targeting Japanese rockfish (mebaru) with jig heads and small plugs. Night game around harbor lights is the main approach, with slow retrieval as the fundamental technique.',
    targetFish: ['メバル'],
    mainTypes: ['ジグヘッド', 'ワーム', 'ミノー'],
    fields: ['漁港', '堤防', '磯'],
    fieldsEn: ['Harbor', 'Pier', 'Rocky Shore'],
    season: '冬〜春（12月〜5月）',
    seasonEn: 'Winter–Spring (Dec–May)',
    tips: [
      'メバルは表層付近を意識している。まず表層からレンジを下げていく',
      'ジグヘッドは0.5〜1.5g。ワームはシャッドテール系が安定',
      '巻き速度はデッドスローが基本。早巻きは嫌われやすい',
      'プラグ（小型ミノー）は流れのある場所でドリフトが効く',
      '常夜灯の光と影の境界線を通すのがセオリー',
    ],
    tipsEn: [
      'Mebaru often hold near surface — start shallow and work down',
      'Use 0.5–1.5g jig heads with shad tail worms',
      'Dead slow retrieve is essential — fast retrieval spooks them',
      'Small minnow plugs work well for drift fishing in current',
      'Target the boundary between light and shadow from harbor lights',
    ],
  },
  {
    slug: 'seabass-game',
    name: 'シーバスゲーム',
    nameEn: 'Seabass Game',
    description: 'シーバス（スズキ）をルアーで狙うソルトルアーの王道。河口、港湾、干潟など多彩なフィールドで年中楽しめる。ベイトパターンの読みが釣果を左右する。',
    descriptionEn: 'The classic saltwater lure fishing targeting Japanese seabass (suzuki). Enjoy year-round fishing in estuaries, harbors, and tidal flats. Reading bait patterns is the key to success.',
    targetFish: ['シーバス'],
    mainTypes: ['ミノー', 'バイブレーション', 'シンキングペンシル'],
    fields: ['河口', '港湾', '干潟', '磯'],
    fieldsEn: ['Estuary', 'Harbor', 'Tidal Flat', 'Rocky Shore'],
    season: '通年（春・秋が最盛期）',
    seasonEn: 'Year-round (spring & autumn peak)',
    tips: [
      'ベイトの種類に合わせたルアーセレクトが最重要。バチ・イワシ・コノシロ等',
      'ミノーはただ巻きが基本。レンジに合ったリップ長を選ぶ',
      'バイブレーションはデイゲームやディープ攻略に強い。リフト＆フォールも有効',
      'シンペンはスレたシーバスに効く。ドリフトで流す使い方がキモ',
      '潮の動き始めと止まり際にバイトが集中しやすい',
    ],
    tipsEn: [
      'Matching your lure to bait type is crucial — worm hatch, sardine, gizzard shad',
      'Steady retrieve is the minnow fundamental — choose lip length for target depth',
      'Vibration lures excel in daytime and deep water — lift & fall is also effective',
      'Sinking pencils work on pressured fish — drift technique is key',
      'Bites concentrate at tide change start and end',
    ],
  },
  {
    slug: 'bass-fishing',
    name: 'バスフィッシング',
    nameEn: 'Bass Fishing',
    description: 'ブラックバスをルアーで狙う淡水ルアーフィッシングの代名詞。ワーム・ハードルアー・ビッグベイトなど多彩なルアーを駆使し、戦略性の高いゲームを楽しめる。',
    descriptionEn: 'The quintessential freshwater lure fishing targeting largemouth bass. Master diverse lures from soft plastics to hardbaits to big baits for a highly strategic game.',
    targetFish: ['ブラックバス'],
    mainTypes: ['ワーム', 'クランクベイト', 'スピナーベイト'],
    fields: ['湖', 'ダム', '野池', '河川'],
    fieldsEn: ['Lake', 'Dam', 'Farm Pond', 'River'],
    season: '通年（春のスポーニング期が最盛）',
    seasonEn: 'Year-round (spring spawning season is peak)',
    tips: [
      '季節ごとのバスのポジションを理解する。春はシャロー、夏はディープ、秋はフィーディング',
      'ワームのノーシンカーリグはカバー撃ちの基本。フォールで食わせる',
      'クランクベイトはボトムに当てて使う。リップが底を叩く音とアクションで誘う',
      'スピナーベイトは濁り・風の強い日に強い。ブレードのフラッシングで広範囲をサーチ',
      'プレッシャーが高い場所ではフィネスリグ（ダウンショット・ネコリグ）にダウンサイズ',
    ],
    tipsEn: [
      'Understand seasonal positioning — spring shallow, summer deep, autumn feeding',
      'Weightless rigged soft plastics are the cover-fishing basic — let them fall',
      'Crankbaits work best when bouncing off bottom — the sound and action trigger bites',
      'Spinnerbaits excel in stained water and wind — blade flash searches wide areas',
      'Downsize to finesse rigs (drop shot, neko rig) in high-pressure areas',
    ],
  },
  {
    slug: 'tairaba',
    name: 'タイラバ',
    nameEn: 'Tai Rubber Fishing',
    description: 'タイラバ（鯛ラバ）を使って真鯛を狙うオフショアの釣法。等速巻きが基本で、一定速度のリトリーブを続けることがバイトを引き出す鍵。',
    descriptionEn: 'Target red sea bream with tai rubber lures from boats. Constant-speed retrieve is fundamental — maintaining steady retrieval speed is the key to triggering bites.',
    targetFish: ['マダイ'],
    mainTypes: ['タイラバ'],
    fields: ['オフショア（船）'],
    fieldsEn: ['Offshore (Boat)'],
    season: '通年（春・秋が好期）',
    seasonEn: 'Year-round (spring & autumn peak)',
    tips: [
      '等速巻きが絶対条件。速度を変えない一定リトリーブが最も食う',
      'ヘッドの重さは水深×1.5倍（g）が目安。60m→90g前後',
      'ネクタイのカラーはオレンジ・レッドが定番。渋い時はグリーンやケイムラ',
      'アタリがあっても巻き続ける「乗せ調子」が基本。早アワセは厳禁',
      'ドテラ流しかバーチカルかで使うヘッド重量が変わる',
    ],
    tipsEn: [
      'Constant-speed retrieve is absolute — never change speed',
      'Head weight guideline is depth × 1.5 (grams) — 60m depth → ~90g',
      'Orange and red skirts are standard — try green or UV in tough conditions',
      'Keep reeling when you feel a bite — early hooksets are forbidden',
      'Head weight changes between drift and vertical fishing styles',
    ],
  },
  {
    slug: 'offshore-casting',
    name: 'オフショアキャスティング',
    nameEn: 'Offshore Casting',
    description: '船からダイビングペンシルやポッパーをキャストし、大型青物やヒラマサを狙う豪快な釣り。ナブラやボイルを撃つエキサイティングなゲーム。',
    descriptionEn: 'Cast diving pencils and poppers from boats to target large pelagics and amberjack. An exciting game of shooting surface boils and feeding frenzies.',
    targetFish: ['青物', 'ヒラマサ'],
    mainTypes: ['ダイビングペンシル', 'ポッパー'],
    fields: ['オフショア（船）'],
    fieldsEn: ['Offshore (Boat)'],
    season: '夏〜秋（6月〜11月）',
    seasonEn: 'Summer–Autumn (Jun–Nov)',
    tips: [
      'ダイビングペンシルはジャーク→ダイブ→浮上のリズムで誘う',
      'ポッパーは水面を割るスプラッシュで魚を寄せる。ショートジャークが基本',
      'ルアーサイズは160〜200mm。ベイトのサイズに合わせる',
      'タックルはPE4〜6号＋リーダー80〜130lb。大物に備える',
      'ナブラの進行方向を読んで先にキャストする「ナブラ撃ち」が基本',
    ],
    tipsEn: [
      'Diving pencils work with jerk → dive → float rhythm',
      'Poppers create splashes to attract fish — short jerk is fundamental',
      'Lure size is 160–200mm — match to bait size',
      'Tackle needs PE 4–6 with 80–130lb leader for big fish',
      'Read the direction of feeding schools and cast ahead',
    ],
  },
  {
    slug: 'rockfish-game',
    name: 'ロックフィッシュゲーム',
    nameEn: 'Rockfish Game',
    description: 'カサゴ・ハタ・アイナメなどの根魚をワームやジグヘッドで狙う。ボトム付近を丁寧に探る釣りで、磯やテトラ帯が主なフィールド。',
    descriptionEn: 'Target groupers, scorpionfish, and greenling with worms and jig heads. Carefully probe bottom structures on rocky shores and tetrapod areas.',
    targetFish: ['ロックフィッシュ', 'ハタ'],
    mainTypes: ['ワーム', 'ジグヘッド'],
    fields: ['磯', 'テトラ帯', '堤防'],
    fieldsEn: ['Rocky Shore', 'Tetrapod Area', 'Pier'],
    season: '通年（秋〜冬が好期）',
    seasonEn: 'Year-round (autumn–winter peak)',
    tips: [
      'ボトム付近を離さないのが鉄則。リフト＆フォールかボトムバンプで誘う',
      'テキサスリグは根掛かり回避力が高く、ゴロタ場・テトラで有効',
      'ワームは3〜4インチのホッグ系・クロー系が定番',
      'ヒットしたら根に潜られる前に強引に浮かせる。ドラグはきつめ',
      '甲殻類を意識したオレンジ・レッド系カラーが実績高い',
    ],
    tipsEn: [
      'Stay near bottom at all times — use lift & fall or bottom bump',
      'Texas rig excels at snag avoidance in rocky/tetrapod areas',
      '3–4 inch hog/craw worms are standard',
      'Set hook hard and lift fish before they dive into structure — tight drag',
      'Orange/red colors imitating crustaceans have proven track record',
    ],
  },
];

/** slug で検索 */
export function getMethodBySlug(slug: string): FishingMethod | undefined {
  return fishingMethods.find(m => m.slug === slug);
}
