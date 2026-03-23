/**
 * メーカー公式サイトのカテゴリ情報を使って target_fish / type の精度を検証するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/_verify-maker-categories.ts [--fix]
 *
 * --fix: 不一致を自動修正（confidence=highのみ）
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const FIX_MODE = process.argv.includes('--fix');

// ========================================================================
// メーカー公式カテゴリマッピング
// source: 各メーカー公式サイトの商品カテゴリページから取得
// ========================================================================

type OfficialCategory = 'SALTWATER' | 'FRESHWATER' | 'BASS' | 'TROUT' | 'SALT_SHORE' | 'SALT_OFFSHORE' | 'AYU';

interface MakerCategoryConfig {
  /** メーカー名 */
  maker: string;
  /** カテゴリURL構造の説明 */
  structure: string;
  /** 公式カテゴリごとの商品名パターン（部分一致用） */
  categories: {
    category: OfficialCategory;
    /** 対応する妥当なtarget_fish */
    validFish: string[];
    /** 絶対に含んではいけないtarget_fish */
    invalidFish: string[];
    /** 商品名パターン（小文字化して部分一致） */
    products: string[];
  }[];
}

// カテゴリ→魚種の基本マッピング
const SALTWATER_FISH = ['シーバス', 'ヒラメ', 'マゴチ', '青物', 'マダイ', 'タチウオ', 'クロダイ', 'メバル', 'アジ', 'ロックフィッシュ', 'イカ', 'カマス', 'サワラ', 'カツオ', 'マグロ'];
const FRESHWATER_FISH = ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'];
const BASS_FISH = ['ブラックバス'];
const TROUT_FISH = ['トラウト'];

const MAKER_CONFIGS: MakerCategoryConfig[] = [
  {
    maker: 'palms',
    structure: 'palmsjapan.com/lures/#saltwater と #freshwater',
    categories: [
      {
        category: 'SALTWATER',
        validFish: SALTWATER_FISH,
        invalidFish: ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'],
        products: [
          'slow blatt', 'the smelt', 'the dax', 'dax swim', 'jigaro', 'giopick',
          'hexer', 'grand bites', 'bitarts', 'bit-arts', 'gig', 'arkrover',
          'arkvib', 'jabami', 'splasher', 'curref', 'ark vibe',
          // 日本語名
          'スローブラット', 'ザ・スメルト', 'ザ・ダックス', 'ダックススイム', 'ジガロ',
          'ジオピック', 'ヘキサー', 'グランバイツ', 'ビットアーツ', 'ギグ',
          'アークローバー', 'アークバイブ', 'ジャバミ', 'スプラッシャー', 'カレフ',
        ]
      },
      {
        category: 'FRESHWATER',
        validFish: FRESHWATER_FISH.concat(TROUT_FISH),
        invalidFish: ['シーバス', '青物', 'マダイ', 'タチウオ', 'ヒラメ', 'クロダイ', 'アジ', 'メバル'],
        products: [
          'alexandra', 's-crawl', 'c-crawl', 'beatrice', 'flesh back', 'napdeep',
          'thumbshad', 'silent i', 'vibrossi', 'subream', 'spin walk',
          'little diner', 'harpe vib', 'escade',
          // 日本語名
          'アレキサンドラ', 'ビアトリス', 'フレッシュバック', 'ナップディープ',
          'サムシャッド', 'サイレントアイ', 'ヴィブロッシ', 'サブリーム',
          'スピンウォーク', 'リトルダイナー', 'ハープバイブ', 'エスケード',
        ]
      }
    ]
  },
  {
    maker: 'osp',
    structure: 'o-s-p.net/products-list/fresh/ と /salt/',
    categories: [
      {
        category: 'SALTWATER',
        validFish: SALTWATER_FISH,
        invalidFish: ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'],
        products: [
          // SW版は名前に "SW" が付く
          'hp shadtail sw', 'doliveshrimp sw', 'dolivestick sw', 'doliveshad sw',
          'dolivecraw sw', 'dolivess-gill sw', 'dolivehog sw', 'dolivebeaver sw',
          'flutter tube', 'tsukiyomi', 'bonneville', 'delgado', 'moses',
          'karen 180 sw', 'karen180 sw', 'bentminnow 181 sw', 'bent minnow 181 sw',
          'fakie', 'alici', 'windy', 'glidy',
          'rudra 130 s', 'varuna 110 s', 'rudra 130 sp sw', 'varuna 110 sp sw',
          'i-waver 74 sw', 'bent minnow 106 f-sw', 'bentminnow 130 f-sw',
          'louder50 saltcolor',
          // 日本語名
          'ツキヨミ', 'ボンネビル', 'デルガド', 'モーゼス', 'カレン',
          'フェイキー', 'アリチ', 'ウインディ', 'グライディ',
        ]
      },
      {
        category: 'FRESHWATER',
        validFish: FRESHWATER_FISH.concat(TROUT_FISH).concat(['アユ']),
        invalidFish: ['シーバス', '青物', 'マダイ', 'タチウオ', 'ヒラメ'],
        products: [
          // FW専用（SW版がないもの）は基本BASS
          'durga area', 'melo dr', 'chestar',
        ]
      }
    ]
  },
  {
    maker: 'jackson',
    structure: 'jackson.jp/?pt=products&cat=salt と cat=trout',
    categories: [
      {
        category: 'SALTWATER',
        validFish: SALTWATER_FISH,
        invalidFish: ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'],
        products: [
          'tobisugi daniel', 'metal effect', 'finesse head', 'teppan vib',
          'teppan blade', 'teppan long', 'teppan strong', 'pintail',
          'g-control', 'ryusen', 'deception', 'athlete', 'shallow swimmer',
          'jester minnow', 'nyoro nyoro', 'muscle shot', 'unyounyo',
          'kaedango', 'puriebi', 'sunadango', 'freak worm', 'bone bait',
          'quick set', 'quick shad', 'quick head', 'freak set',
          'gallop', 'tachijig', 'athlete dart',
          // 日本語名
          'とびすぎダニエル', 'メタルエフェクト', 'フィネスヘッド', '鉄板バイブ',
          'ピンテール', 'リューセン', 'デセプション', 'アスリート',
          'シャロースイマー', 'ジェスターミノー', 'ニョロニョロ',
          'マッスルショット', 'うにょうにょ', 'ガロップ', '太刀ジグ',
        ]
      },
      {
        category: 'TROUT',
        validFish: TROUT_FISH,
        invalidFish: ['シーバス', '青物', 'マダイ', 'タチウオ', 'ヒラメ', 'ブラックバス'],
        products: [
          'sakeshogun', 'sakedanshaku', 'masu danshaku', 'eddy', 'buggy spinner',
          'cyarl blade', 'meteora', 'resist', 'trout tune', 'honoka',
          'zurubiki goby', 'dart magic', 'kanade', 'kurokawamushi',
          'batabata magic', 'tube magic', 'zig zag magic', 'heko heko magic',
          'bubble magic', 'bottom magic', 'agesage magic',
          // 日本語名
          'サケショーグン', 'サケダンシャク', 'マスダンシャク', 'エディ',
          'バギースピナー', 'メテオーラ', 'レジスト', 'トラウトチューン',
          'ホノカ', 'ズルビキゴビー', 'ダートマジック', 'カナデ',
          'クロカワムシ', 'バタバタマジック', 'チューブマジック',
        ]
      }
    ]
  },
  {
    maker: 'megabass',
    structure: 'megabass.co.jp FRESHWATER(バスルアー+トラウトルアー) / SALTWATER(ソルトルアー)',
    categories: [
      // megabassのSW/FW判定: source_urlで判定するか、商品名で判定
      // SWルアーは「SW」がつくことが多い
      {
        category: 'SALTWATER',
        validFish: SALTWATER_FISH,
        invalidFish: ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'],
        products: [
          // megabassのSWルアー名にはSWがつくことが多い
          'konosirus', 'genma', 'okashira', 'makippa', 'slash beat',
          'metal-x', 'metal x', 'beach walker', 'x-80 sw',
          'kagelou', 'kanata sw', 'zonk', 'x-nanahan', 'cutter',
          'giant dog-x sw', 'dog-x sw',
        ]
      }
    ]
  },
  {
    maker: 'evergreen',
    structure: 'evergreen-fishing.com /freshwater/ (バス) / /trout/ / /saltwater/ (ジギング/エギング/シーバス/ライトゲーム)',
    categories: [
      {
        category: 'SALTWATER',
        validFish: SALTWATER_FISH,
        invalidFish: ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'],
        products: [
          // evergreenのSWルアー
          'caprice', 'iron marlin', 'poseidon', 'metal master',
          'shore magic', 'ocean flash',
        ]
      },
      {
        category: 'TROUT',
        validFish: TROUT_FISH,
        invalidFish: ['シーバス', '青物', 'ブラックバス', 'ヒラメ'],
        products: [
          // evergreenのトラウトルアー
        ]
      }
    ]
  },
  {
    maker: 'ima',
    structure: 'ima-ams.co.jp - シーバス専門（一部マダイ・トラウト）',
    categories: [
      {
        category: 'SALTWATER',
        validFish: SALTWATER_FISH,
        invalidFish: ['ブラックバス', 'ナマズ', 'ライギョ'],
        products: [
          'komomo', 'sasuke', 'kosuke', 'honey trap', 'bombers',
          'ibro', 'yoichi', 'issen', 'nubble', 'salt skimmer',
          'gyodo', 'calm', 'kagenaguri', 'nabarone', 'pugachev',
          'rocket bait', 'schneider', 'geneal', 'laters', 'sumari',
          'banett', 'koume', 'ice mock', 'c-salt', 'haku', 'pukuii',
        ]
      }
    ]
  },
];

// ========================================================================
// メイン検証ロジック
// ========================================================================

interface Mismatch {
  maker: string;
  slug: string;
  name: string;
  official_category: string;
  db_target_fish: string[];
  db_type: string;
  issue: string;
  recommended_fish: string[];
  confidence: 'high' | 'medium' | 'low';
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/[　\s]+/g, ' ')
    .replace(/[ー−–—]/g, '-')
    .trim();
}

function matchProduct(productName: string, slug: string, patterns: string[]): boolean {
  const normalName = normalizeForMatch(productName);
  const normalSlug = normalizeForMatch(slug);

  for (const pattern of patterns) {
    const normalPattern = normalizeForMatch(pattern);
    if (normalName.includes(normalPattern) || normalSlug.includes(normalPattern)) {
      return true;
    }
  }
  return false;
}

function hasSaltwaterFish(fish: string[]): boolean {
  return fish.some(f => SALTWATER_FISH.includes(f));
}

function hasFreshwaterFish(fish: string[]): boolean {
  return fish.some(f => FRESHWATER_FISH.includes(f) || TROUT_FISH.includes(f));
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 対象メーカーの商品を取得
  const targetMakers = MAKER_CONFIGS.map(c => c.maker);
  const allProducts: any[] = [];

  for (const maker of targetMakers) {
    let page = 0;
    while (true) {
      const { data, error } = await sb.from('lures')
        .select('id, manufacturer_slug, slug, name, type, target_fish')
        .eq('manufacturer_slug', maker)
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (error) { console.error(maker, error); break; }
      if (!data || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < 1000) break;
      page++;
    }
  }

  // slugで重複排除
  const seen = new Map<string, any>();
  for (const r of allProducts) {
    const key = r.manufacturer_slug + '/' + r.slug;
    if (!seen.has(key)) seen.set(key, r);
  }
  const unique = [...seen.values()];
  console.log(`対象: ${targetMakers.length}メーカー、${unique.length}商品（ユニーク）`);

  const mismatches: Mismatch[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const config of MAKER_CONFIGS) {
    const makerProducts = unique.filter(p => p.manufacturer_slug === config.maker);
    console.log(`\n--- ${config.maker} (${makerProducts.length}商品) ---`);

    for (const product of makerProducts) {
      const fish = product.target_fish || [];
      let matched = false;

      for (const cat of config.categories) {
        if (matchProduct(product.name, product.slug, cat.products)) {
          matched = true;
          matchedCount++;

          // 不正な魚種が含まれているかチェック
          const invalidFound = fish.filter((f: string) => cat.invalidFish.includes(f));
          if (invalidFound.length > 0) {
            // FW商品にSW魚種が入っている or その逆
            const issue = `${cat.category}カテゴリなのに${invalidFound.join(',')}が含まれている`;
            mismatches.push({
              maker: config.maker,
              slug: product.slug,
              name: product.name,
              official_category: cat.category,
              db_target_fish: fish,
              db_type: product.type,
              issue,
              recommended_fish: cat.validFish.slice(0, 3), // 上位3つを推奨
              confidence: 'high',
            });
          }

          // 妥当な魚種が1つも含まれていないかチェック
          const hasValid = fish.some((f: string) => cat.validFish.includes(f));
          if (!hasValid && fish.length > 0) {
            const issue = `${cat.category}カテゴリなのに妥当な魚種(${cat.validFish.slice(0,3).join(',')})が1つもない`;
            // 重複チェック
            const existing = mismatches.find(m => m.maker === config.maker && m.slug === product.slug);
            if (!existing) {
              mismatches.push({
                maker: config.maker,
                slug: product.slug,
                name: product.name,
                official_category: cat.category,
                db_target_fish: fish,
                db_type: product.type,
                issue,
                recommended_fish: cat.validFish.slice(0, 3),
                confidence: 'medium',
              });
            }
          }

          break; // 1商品は1カテゴリのみ
        }
      }

      if (!matched) {
        unmatchedCount++;
      }
    }
  }

  // --- maker-domains.json の type を使った追加チェック ---
  console.log('\n\n=== maker-domains.json specialty チェック ===');
  const makerDomains = JSON.parse(fs.readFileSync('config/maker-domains.json', 'utf-8'));

  // 専門メーカーの不一致チェック
  // type=jp_bass のメーカーでSW魚種が入っている場合
  // type=jp_salt のメーカーでバスが入っている場合
  // type=jp_trout のメーカーでバス/SW魚種が入っている場合

  const allMakers = Object.keys(makerDomains);
  const specialtyMismatches: Mismatch[] = [];

  for (const maker of allMakers) {
    const makerConfig = makerDomains[maker];
    const makerType = makerConfig.type;
    const specialty: string[] = makerConfig.specialty || [];

    // multiタイプはスキップ（複数ジャンル扱うため）
    if (makerType.includes('multi')) continue;

    // 専門メーカーの商品を取得
    let page = 0;
    const products: any[] = [];
    while (true) {
      const { data, error } = await sb.from('lures')
        .select('id, manufacturer_slug, slug, name, type, target_fish')
        .eq('manufacturer_slug', maker)
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      products.push(...data);
      if (data.length < 1000) break;
      page++;
    }

    // slugで重複排除
    const seenSlugs = new Map<string, any>();
    for (const p of products) {
      if (!seenSlugs.has(p.slug)) seenSlugs.set(p.slug, p);
    }
    const uniqueProducts = [...seenSlugs.values()];
    if (uniqueProducts.length === 0) continue;

    let issueCount = 0;

    for (const product of uniqueProducts) {
      const fish = product.target_fish || [];
      if (fish.length === 0) continue;

      if (makerType === 'jp_bass' || makerType === 'us_bass') {
        // バス専門メーカーなのにSW魚種が入っている
        const swFish = fish.filter((f: string) =>
          ['シーバス', '青物', 'マダイ', 'タチウオ', 'ヒラメ', 'クロダイ', 'アジ', 'メバル', 'イカ', 'ロックフィッシュ'].includes(f)
        );
        if (swFish.length > 0 && !fish.includes('ブラックバス')) {
          issueCount++;
          specialtyMismatches.push({
            maker,
            slug: product.slug,
            name: product.name,
            official_category: 'BASS_SPECIALTY',
            db_target_fish: fish,
            db_type: product.type,
            issue: `バス専門メーカーなのにバスが含まれず ${swFish.join(',')} がある`,
            recommended_fish: ['ブラックバス'],
            confidence: 'high',
          });
        }
      }

      if (makerType === 'jp_trout') {
        // トラウト専門メーカーなのにバスやSW魚種が入っている
        const nonTrout = fish.filter((f: string) =>
          !['トラウト'].includes(f)
        );
        if (nonTrout.length > 0 && !fish.includes('トラウト')) {
          issueCount++;
          specialtyMismatches.push({
            maker,
            slug: product.slug,
            name: product.name,
            official_category: 'TROUT_SPECIALTY',
            db_target_fish: fish,
            db_type: product.type,
            issue: `トラウト専門メーカーなのにトラウトが含まれず ${nonTrout.join(',')} がある`,
            recommended_fish: ['トラウト'],
            confidence: 'high',
          });
        }
      }

      if (makerType === 'jp_salt') {
        // ソルト専門メーカーなのにバスやトラウトが入っている
        const fwFish = fish.filter((f: string) =>
          ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'].includes(f)
        );
        if (fwFish.length > 0 && !hasSaltwaterFish(fish)) {
          issueCount++;
          specialtyMismatches.push({
            maker,
            slug: product.slug,
            name: product.name,
            official_category: 'SALT_SPECIALTY',
            db_target_fish: fish,
            db_type: product.type,
            issue: `ソルト専門メーカーなのにSW魚種がなく ${fwFish.join(',')} がある`,
            recommended_fish: specialty,
            confidence: 'high',
          });
        }
      }

      if (makerType === 'jp_light') {
        // ライトゲーム専門（34、TICT等）でバスが入っている
        const fwFish = fish.filter((f: string) =>
          ['ブラックバス', 'トラウト', 'ナマズ', 'ライギョ'].includes(f)
        );
        if (fwFish.length > 0) {
          issueCount++;
          specialtyMismatches.push({
            maker,
            slug: product.slug,
            name: product.name,
            official_category: 'LIGHT_SPECIALTY',
            db_target_fish: fish,
            db_type: product.type,
            issue: `ライトゲーム専門メーカーなのに ${fwFish.join(',')} がある`,
            recommended_fish: specialty,
            confidence: 'medium',
          });
        }
      }
    }

    if (issueCount > 0) {
      console.log(`  ${maker}: ${issueCount}件の不一致（${uniqueProducts.length}商品中）`);
    }
  }

  // 結果集約
  const allMismatches = [...mismatches, ...specialtyMismatches];

  console.log('\n\n========================================');
  console.log(`公式カテゴリマッチ検証結果`);
  console.log(`========================================`);
  console.log(`カテゴリマッチ: ${matchedCount}件`);
  console.log(`未マッチ（パターン外）: ${unmatchedCount}件`);
  console.log(`不一致検出: ${allMismatches.length}件`);
  console.log(`  - high confidence: ${allMismatches.filter(m => m.confidence === 'high').length}件`);
  console.log(`  - medium confidence: ${allMismatches.filter(m => m.confidence === 'medium').length}件`);
  console.log(`  - low confidence: ${allMismatches.filter(m => m.confidence === 'low').length}件`);

  // メーカー別集計
  const byMaker = new Map<string, number>();
  for (const m of allMismatches) {
    byMaker.set(m.maker, (byMaker.get(m.maker) || 0) + 1);
  }
  console.log('\nメーカー別不一致:');
  for (const [maker, count] of [...byMaker.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${maker}: ${count}件`);
  }

  // 不一致詳細表示
  if (allMismatches.length > 0) {
    console.log('\n--- 不一致詳細 ---');
    for (const m of allMismatches) {
      console.log(`[${m.confidence}] ${m.maker}/${m.slug}: ${m.issue}`);
      console.log(`  名前: ${m.name}`);
      console.log(`  DB target_fish: [${m.db_target_fish.join(', ')}]`);
      console.log(`  DB type: ${m.db_type}`);
      console.log(`  推奨: [${m.recommended_fish.join(', ')}]`);
    }
  }

  // ファイル出力
  fs.writeFileSync('/tmp/maker-category-mismatches.json', JSON.stringify(allMismatches, null, 2));
  console.log(`\n結果を /tmp/maker-category-mismatches.json に保存しました（${allMismatches.length}件）`);

  // --fix モード
  if (FIX_MODE && allMismatches.length > 0) {
    const highConfidence = allMismatches.filter(m => m.confidence === 'high');
    console.log(`\n=== 自動修正モード: ${highConfidence.length}件（high confidence のみ）===`);

    // TODO: 修正ロジックは別途実装
    // 現時点ではレポートのみ
    console.log('自動修正は未実装。レポートを確認して手動で判断してください。');
  }
}

main().catch(console.error);
