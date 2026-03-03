/**
 * type-migration.ts — ルアータイプの一括正規化・再分類スクリプト
 *
 * Usage:
 *   npx tsx scripts/type-migration.ts --dry-run       # 変更プレビュー
 *   npx tsx scripts/type-migration.ts --apply          # 実行
 *   npx tsx scripts/type-migration.ts --dump-unknown   # AI分類用の未分類リストをJSON出力
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');
const DUMP_UNKNOWN = process.argv.includes('--dump-unknown');

// ──────────────────────────────────────────────
// カノニカルタイプ（最終的にDBに存在すべきタイプ一覧）
// ──────────────────────────────────────────────
const CANONICAL_TYPES = [
  'ミノー',
  'クランクベイト',
  'シャッド',
  'バイブレーション',
  'メタルバイブ',
  'ペンシルベイト',
  'シンキングペンシル',
  'ダイビングペンシル',
  'ポッパー',
  'トップウォーター',
  'プロップベイト',
  'クローラーベイト',
  'i字系',
  'スイムベイト',
  'ビッグベイト',
  'ジョイントベイト',
  'フロッグ',
  'スピナーベイト',
  'チャターベイト',
  'バズベイト',
  'スピンテール',
  'ブレードベイト',
  'メタルジグ',
  'スプーン',
  'スピナー',
  'ワーム',
  'ラバージグ',
  'ジグヘッド',
  'エギ',
  'スッテ',
  'タイラバ',
  'テンヤ',
  'その他',
] as const;

type CanonicalType = typeof CANONICAL_TYPES[number];

// ──────────────────────────────────────────────
// Phase 1: 単純マージ（旧タイプ → カノニカルタイプ）
// ──────────────────────────────────────────────
const SIMPLE_MERGES: Record<string, CanonicalType> = {
  // 同義語・表記ゆれ
  'メタルバイブレーション': 'メタルバイブ',
  'ペンシル': 'ペンシルベイト',
  'スピンテールジグ': 'スピンテール',
  'チャタベイト': 'チャターベイト',
  '鯛ラバ': 'タイラバ',
  'ひとつテンヤ': 'テンヤ',

  // エリア系 → 親カテゴリ
  'フローティングミノー': 'ミノー',
  'シンキングミノー': 'ミノー',
  'エリアミノー': 'ミノー',
  'エリアクランク': 'クランクベイト',
  'エリアスプーン': 'スプーン',
  'エリアトップウォーター': 'トップウォーター',

  // サブタイプ → 親カテゴリ
  'メタルスッテ': 'スッテ',
  'タコエギ': 'エギ',
  'バイブレーションジグヘッド': 'ジグヘッド',
  'アイアンジグヘッド': 'ジグヘッド',
  'ローリングジグヘッド': 'ジグヘッド',
  'フェザージグ': 'スプーン',
  'スイムジグ': 'ラバージグ',
  'スピンジグ': 'ラバージグ',
  'ジグミノー': 'ミノー',

  // 非ルアー → その他
  'フック': 'その他',
  'シンカー': 'その他',
  'ルアーパーツ': 'その他',
  'フロート': 'その他',
  'ドジャー': 'その他',

  // 残留タイプの統合
  'タコベイト': 'エギ',
  'ウェイクベイト': 'トップウォーター',
  'ネイティブミノー': 'ミノー',
  'ケイムラ': 'その他',
  'スキップベイト': 'トップウォーター',
};

// ──────────────────────────────────────────────
// Phase 2: カテゴリごと一括移行（全商品が同じタイプに該当）
// ──────────────────────────────────────────────
const CATEGORY_MOVES: Record<string, CanonicalType> = {
  'ロックフィッシュ': 'ワーム',         // 全5シリーズがワーム
  'タチウオルアー': 'メタルジグ',        // 全3シリーズがメタルジグ
  '鮎ルアー': 'ミノー',                // 全3シリーズがミノー系
  'ブレードジグ': 'メタルジグ',          // 全7シリーズがメタルジグ
};

// ──────────────────────────────────────────────
// Phase 3: 名前ベースの正規表現分類器
// 混合カテゴリ（ルアー, プラグ, etc.）の商品名から推定
// ──────────────────────────────────────────────
type ClassifyRule = { pattern: RegExp; type: CanonicalType };

const CLASSIFY_RULES: ClassifyRule[] = [
  // --- 非常に具体的なパターン（優先度高）---

  // スッテ
  { pattern: /スッテ/i, type: 'スッテ' },

  // エギ（号数付きイカ系）
  { pattern: /エギ/i, type: 'エギ' },

  // ジグヘッド（ジグより先）
  { pattern: /ジグヘッド|jighead|ヘッド.*\d+号/i, type: 'ジグヘッド' },
  { pattern: /ソウルヘッド|チヌヘッド|センシージグヘッド/i, type: 'ジグヘッド' },

  // タイラバ
  { pattern: /タイラバ|鯛ラバ|tai.*rub/i, type: 'タイラバ' },
  { pattern: /紅牙.*替えユニット|紅牙.*ネクタイ|ビンビン/i, type: 'タイラバ' },

  // テンヤ
  { pattern: /テンヤ|tenya/i, type: 'テンヤ' },

  // --- ソフトベイト ---
  { pattern: /ワーム|worm/i, type: 'ワーム' },
  { pattern: /フリックシェイク|フリック.*\d/i, type: 'ワーム' },
  { pattern: /カーリー|curly/i, type: 'ワーム' },
  { pattern: /グラブ|grub/i, type: 'ワーム' },
  { pattern: /シュリンプ|shrimp/i, type: 'ワーム' },
  { pattern: /ホッグ|hog/i, type: 'ワーム' },
  { pattern: /クロー|craw(?!l)/i, type: 'ワーム' },  // crawlerは除外
  { pattern: /エラストマー/i, type: 'ワーム' },
  { pattern: /ツイスター|twister/i, type: 'ワーム' },
  { pattern: /バニー|bunny/i, type: 'ワーム' },
  { pattern: /ドリフトフライ|ドリフトクラブ/i, type: 'ワーム' },
  { pattern: /スパイキックス|ヤミィ|ワムワム|チャンクロー|カバークロー/i, type: 'ワーム' },
  { pattern: /しらす[A-Z]|しらすJ/i, type: 'ワーム' },
  { pattern: /ビームスティック|ビーム.*極み/i, type: 'ワーム' },
  { pattern: /蟲|蟹|パドル|リング.*\d.*"|アミアミ|ペケリング|キビ.*ゴ/i, type: 'ワーム' },
  { pattern: /シャッドテール|shadtail/i, type: 'ワーム' },
  { pattern: /サーディーン|サーディン|sardine/i, type: 'ワーム' },
  { pattern: /ウェーバーシュリンプ|ジャグホッグ|ジャグポッド|シザーコーム|ベビードラゴン/i, type: 'ワーム' },
  { pattern: /センシーカーリー|センシーシャッド|センシーテール|スイングリーパー/i, type: 'ワーム' },
  { pattern: /タイドカーリー|タイドペッパー|ティートバグ|リビング/i, type: 'ワーム' },
  { pattern: /チャンク.*チヌ|カニクライマー|ブリーカースリット/i, type: 'ワーム' },
  { pattern: /エリーゼ|ELISE/i, type: 'ワーム' },
  { pattern: /シボフラット|ホールフリック/i, type: 'ワーム' },
  { pattern: /マイクロフリック|MICRO\s*FLICK/i, type: 'ワーム' },

  // --- ハードベイト: 具体的なタイプ ---

  // ポッパー
  { pattern: /ポッパー|popper/i, type: 'ポッパー' },
  { pattern: /POP\s*X|POPX|ソルティポップ|ポップ.*R/i, type: 'ポッパー' },
  { pattern: /BAZOO(?!.*slim)/i, type: 'ポッパー' },  // CB-ONE BAZOO はポッパー

  // フロッグ
  { pattern: /フロッグ|frog/i, type: 'フロッグ' },

  // クローラーベイト
  { pattern: /クローラー|crawler/i, type: 'クローラーベイト' },
  { pattern: /デッドスローラー/i, type: 'クローラーベイト' },
  { pattern: /ナジークローラー/i, type: 'クローラーベイト' },

  // バズベイト
  { pattern: /バズベイト|buzzbait|BUZZ.*JET|バズジェット/i, type: 'バズベイト' },

  // チャターベイト
  { pattern: /チャター|chatter/i, type: 'チャターベイト' },

  // スピナーベイト
  { pattern: /スピナーベイト|spinnerbait/i, type: 'スピナーベイト' },
  { pattern: /ドーン|DOOON|イラプション|eruption/i, type: 'スピナーベイト' },
  { pattern: /GHOST\s*WIRE|MUSCLE\s*WIRE|ゴーストワイヤー|マッスルワイヤー/i, type: 'スピナーベイト' },
  { pattern: /ガーグル|GARGLE/i, type: 'スピナーベイト' },

  // プロップベイト
  { pattern: /プロップ|prop/i, type: 'プロップベイト' },
  { pattern: /スウィッシャー|swisher|swisher/i, type: 'プロップベイト' },

  // i字系
  { pattern: /i字|ライザーベイト|RISERBAIT/i, type: 'i字系' },

  // クランクベイト
  { pattern: /クランク|crank/i, type: 'クランクベイト' },
  { pattern: /パニクラ|PANICRA/i, type: 'クランクベイト' },

  // シャッド
  { pattern: /シャッド(?!テール)|(?<!\w)shad(?!tail)/i, type: 'シャッド' },

  // メタルバイブ
  { pattern: /メタルバイブ|METAL\s*VIB/i, type: 'メタルバイブ' },
  { pattern: /アイアンマービー|鉄板バイブ/i, type: 'メタルバイブ' },
  { pattern: /シアン\s*メタルバイブ/i, type: 'メタルバイブ' },

  // バイブレーション
  { pattern: /バイブレーション|vibration/i, type: 'バイブレーション' },
  { pattern: /バイブ|vib/i, type: 'バイブレーション' },
  { pattern: /オルガリップレス|TN.*トリゴン|ジナリ/i, type: 'バイブレーション' },

  // シンキングペンシル
  { pattern: /シンキングペンシル|sinking\s*pencil/i, type: 'シンキングペンシル' },
  { pattern: /スネコン|SNECON/i, type: 'シンキングペンシル' },
  { pattern: /ゼッパー|ZEPPER/i, type: 'シンキングペンシル' },

  // ダイビングペンシル
  { pattern: /ダイビングペンシル|diving\s*pencil/i, type: 'ダイビングペンシル' },
  { pattern: /DIXON|RODEO|RYAN|RUDOLF|BAZOO\s*SLIM/i, type: 'ダイビングペンシル' },

  // ペンシルベイト（汎用ペンシル）
  { pattern: /ペンシル|pencil/i, type: 'ペンシルベイト' },
  { pattern: /バーストアッパー|ウォブリング|WOBBLING/i, type: 'ペンシルベイト' },

  // トップウォーター
  { pattern: /トップウォーター|topwater/i, type: 'トップウォーター' },
  { pattern: /ヒゲダンサー|ナジーバグ/i, type: 'トップウォーター' },

  // スイムベイト
  { pattern: /スイムベイト|swimbait/i, type: 'スイムベイト' },
  { pattern: /ダウズスイマー|DOWZ\s*SWIMMER/i, type: 'スイムベイト' },

  // ビッグベイト
  { pattern: /ビッグベイト|bigbait/i, type: 'ビッグベイト' },

  // ジョイントベイト
  { pattern: /ジョイント|jointed/i, type: 'ジョイントベイト' },
  { pattern: /GORHAM/i, type: 'ジョイントベイト' },

  // ブレードベイト
  { pattern: /ブレードベイト|blade\s*bait/i, type: 'ブレードベイト' },
  { pattern: /E-ブレード|ラッシュブレード|ラスターブレード|LUSTER\s*BLADE/i, type: 'ブレードベイト' },

  // スピンテール
  { pattern: /スピンテール|spintail/i, type: 'スピンテール' },
  { pattern: /デラスピン|DERASPIN/i, type: 'スピンテール' },

  // --- メタル系 ---
  // メタルジグ
  { pattern: /メタルジグ|metal\s*jig/i, type: 'メタルジグ' },
  { pattern: /TGベイト|アンチョビメタル|サムライ.*メタル|トレイシー/i, type: 'メタルジグ' },
  { pattern: /カットバッカー|ビッグバッカージグ|フィットジグ|フォールトリック/i, type: 'メタルジグ' },
  { pattern: /アンチョビミサイル|アンチョビハイブリッド|陸式アンチョビ/i, type: 'メタルジグ' },
  { pattern: /クルセイダー|crusader/i, type: 'メタルジグ' },
  { pattern: /ジグパラ|JIGPARA/i, type: 'メタルジグ' },
  { pattern: /マキジグ|MAKIJIG/i, type: 'メタルジグ' },
  { pattern: /EBIRAN/i, type: 'メタルジグ' },
  { pattern: /サブルスイムメタル/i, type: 'メタルジグ' },

  // スプーン
  { pattern: /スプーン|spoon/i, type: 'スプーン' },

  // スピナー
  { pattern: /スピナー(?!ベイト)|spinner(?!bait)/i, type: 'スピナー' },

  // --- ラバージグ ---
  { pattern: /ラバージグ|rubber\s*jig/i, type: 'ラバージグ' },
  { pattern: /フットボールジグ|football\s*jig/i, type: 'ラバージグ' },
  { pattern: /C-4ジグ|サトウジグ|IRジグ|チャムジグ|CoreHead|キャスティングジグ.*ラバー/i, type: 'ラバージグ' },

  // --- ミノー（最も汎用的、後ろに配置）---
  { pattern: /ミノー|minnow/i, type: 'ミノー' },
  { pattern: /ONETEN|KAGELOU|KARASHI/i, type: 'ミノー' },
  { pattern: /ショアラインシャイナー|バンクフラッター/i, type: 'ミノー' },
  { pattern: /アスリート|ATHLETE/i, type: 'ミノー' },
  { pattern: /アイザー|AISER/i, type: 'ミノー' },
  { pattern: /カプリス|CAPRICE/i, type: 'ミノー' },
  { pattern: /メバルハンター/i, type: 'ミノー' },
  { pattern: /ヒソカ|HISOKA/i, type: 'ミノー' },
  { pattern: /Dilemma/i, type: 'ミノー' },
  { pattern: /ORBIT|オービット/i, type: 'ミノー' },
  { pattern: /RYUKI|リュウキ/i, type: 'ミノー' },
  { pattern: /シュガーディープ|SUGAR\s*DEEP/i, type: 'ミノー' },
  { pattern: /はぜむし/i, type: 'ミノー' },
  { pattern: /もののふ/i, type: 'ミノー' },
  { pattern: /フラペン|FLAPEN/i, type: 'ミノー' },
  { pattern: /ヒエイ|ツクモ|ハグレ|ライコ/i, type: 'ミノー' },
  { pattern: /オトリミノー/i, type: 'ミノー' },
  { pattern: /トリコロール(?!.*スプーン|.*バイブ)|TRICOROLL(?!.*spoon|.*vib)/i, type: 'ミノー' },
  { pattern: /ブリブリミノー/i, type: 'ミノー' },
  { pattern: /流芯|RYUSHIN/i, type: 'ミノー' },
  { pattern: /シャロ[ー－]ル/i, type: 'ミノー' },
  { pattern: /ビッグバッカーフィットミノー|ジェットローバディ/i, type: 'ミノー' },
  { pattern: /サブルオーバーヘッド/i, type: 'ミノー' },
  { pattern: /S\.P\.M\./i, type: 'ミノー' },
  { pattern: /FORMA|GORGON|Mulletino|BILHOUETTE/i, type: 'ミノー' },

  // --- ジグ汎用（最後の砦）---
  { pattern: /ジグ(?!ヘッド)|(?<![a-z])jig(?!head)/i, type: 'メタルジグ' },

  // メタル（最後の砦）
  { pattern: /メタル|metal/i, type: 'メタルジグ' },
];

// ──────────────────────────────────────────────
// AI分類結果ファイル（Sonnetで生成後にここから読む）
// ──────────────────────────────────────────────
const AI_RESULTS_PATH = '/tmp/type-ai-classifications.json';

function classifyByName(name: string): CanonicalType | null {
  for (const rule of CLASSIFY_RULES) {
    if (rule.pattern.test(name)) {
      return rule.type;
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────────
async function main() {
  console.log('=== Type Migration Script ===\n');

  // ── Phase 1: 単純マージ ──
  console.log('── Phase 1: 単純マージ ──');
  let phase1Count = 0;
  for (const [oldType, newType] of Object.entries(SIMPLE_MERGES)) {
    const { count } = await sb.from('lures').select('*', { count: 'exact', head: true }).eq('type', oldType);
    if (count && count > 0) {
      console.log(`  ${oldType} → ${newType} (${count} rows)`);
      phase1Count += count;
      if (APPLY) {
        const { error } = await sb.from('lures').update({ type: newType }).eq('type', oldType);
        if (error) console.error(`  ❌ Error: ${error.message}`);
        else console.log(`  ✅ Updated`);
      }
    }
  }
  console.log(`  Phase 1 合計: ${phase1Count} rows\n`);

  // ── Phase 2: カテゴリごと一括移行 ──
  console.log('── Phase 2: カテゴリごと一括移行 ──');
  let phase2Count = 0;
  for (const [oldType, newType] of Object.entries(CATEGORY_MOVES)) {
    const { count } = await sb.from('lures').select('*', { count: 'exact', head: true }).eq('type', oldType);
    if (count && count > 0) {
      console.log(`  ${oldType} → ${newType} (${count} rows)`);
      phase2Count += count;
      if (APPLY) {
        const { error } = await sb.from('lures').update({ type: newType }).eq('type', oldType);
        if (error) console.error(`  ❌ Error: ${error.message}`);
        else console.log(`  ✅ Updated`);
      }
    }
  }
  console.log(`  Phase 2 合計: ${phase2Count} rows\n`);

  // ── Phase 3: 混合カテゴリの名前ベース分類 ──
  console.log('── Phase 3: 名前ベース分類 ──');
  const AMBIGUOUS_TYPES = [
    'ルアー', 'プラグ', 'ショアジギング', 'アジング', 'メバリング',
    'トラウトルアー', 'シーバスルアー', 'サーフルアー', 'チニング',
    'ワイヤーベイト', 'エリアトラウトルアー', 'その他', 'ジグ',
    'キャスティングプラグ', 'ナマズルアー',
  ];

  // AI分類結果があれば読み込む
  let aiResults: Record<string, string> = {};
  if (existsSync(AI_RESULTS_PATH)) {
    aiResults = JSON.parse(readFileSync(AI_RESULTS_PATH, 'utf8'));
    console.log(`  AI分類結果を読み込み: ${Object.keys(aiResults).length} 件\n`);
  }

  // 全シリーズ取得
  const allSeries: { manufacturer_slug: string; slug: string; name: string; type: string }[] = [];
  for (const type of AMBIGUOUS_TYPES) {
    const PAGE = 1000;
    let from = 0;
    const seen = new Set<string>();
    while (true) {
      const { data } = await sb.from('lures')
        .select('manufacturer_slug,slug,name,type')
        .eq('type', type)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const key = `${r.manufacturer_slug}/${r.slug}`;
        if (!seen.has(key)) {
          seen.add(key);
          allSeries.push(r);
        }
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  console.log(`  対象シリーズ: ${allSeries.length} 件\n`);

  // 分類実行
  const classified: { ms: string; slug: string; name: string; oldType: string; newType: string }[] = [];
  const unclassified: typeof allSeries = [];
  const typeStats = new Map<string, number>();

  for (const s of allSeries) {
    const key = `${s.manufacturer_slug}/${s.slug}`;

    // 1. AI結果があればそれを使う
    if (aiResults[key]) {
      const newType = aiResults[key] as CanonicalType;
      classified.push({ ms: s.manufacturer_slug, slug: s.slug, name: s.name, oldType: s.type, newType });
      typeStats.set(newType, (typeStats.get(newType) || 0) + 1);
      continue;
    }

    // 2. 名前ベース分類
    const detected = classifyByName(s.name);
    if (detected) {
      classified.push({ ms: s.manufacturer_slug, slug: s.slug, name: s.name, oldType: s.type, newType: detected });
      typeStats.set(detected, (typeStats.get(detected) || 0) + 1);
    } else {
      unclassified.push(s);
    }
  }

  console.log(`  分類済み: ${classified.length} / ${allSeries.length}`);
  console.log(`  未分類: ${unclassified.length} / ${allSeries.length}`);
  console.log(`  分類率: ${((classified.length / allSeries.length) * 100).toFixed(1)}%\n`);

  // 分類結果のタイプ別内訳
  console.log('  ── 分類結果内訳 ──');
  const sortedStats = [...typeStats.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedStats) {
    console.log(`    ${type.padEnd(20)} ${count}`);
  }

  // DUMP_UNKNOWN モード: 未分類リストをJSON出力
  if (DUMP_UNKNOWN) {
    const dumpPath = '/tmp/type-unclassified.json';
    const dumpData = unclassified.map(s => ({
      key: `${s.manufacturer_slug}/${s.slug}`,
      name: s.name,
      current_type: s.type,
    }));
    writeFileSync(dumpPath, JSON.stringify(dumpData, null, 2));
    console.log(`\n  未分類リストを ${dumpPath} に出力 (${dumpData.length} 件)`);

    // 未分類サンプル表示
    console.log('\n  ── 未分類サンプル（先頭30件）──');
    for (const s of unclassified.slice(0, 30)) {
      console.log(`    [${s.type}] ${s.manufacturer_slug}/${s.slug} → ${s.name}`);
    }
  }

  // DRY_RUN モード: 変更プレビュー
  if (DRY_RUN) {
    console.log('\n  ── 分類結果サンプル（先頭40件）──');
    for (const c of classified.slice(0, 40)) {
      console.log(`    ${c.oldType} → ${c.newType}: ${c.ms}/${c.slug} (${c.name})`);
    }
    console.log(`\n  ⚠️ --dry-run モード: DBは更新されません`);
  }

  // APPLY モード: DB更新
  if (APPLY) {
    console.log('\n  ── DB更新実行 ──');

    // シリーズ単位でバッチ更新
    let updated = 0;
    let errors = 0;
    for (const c of classified) {
      const { error, count } = await sb.from('lures')
        .update({ type: c.newType })
        .eq('manufacturer_slug', c.ms)
        .eq('slug', c.slug)
        .eq('type', c.oldType);  // 安全: 旧タイプとの一致も確認

      if (error) {
        console.error(`  ❌ ${c.ms}/${c.slug}: ${error.message}`);
        errors++;
      } else {
        updated++;
      }

      // 進捗表示（100件ごと）
      if (updated % 100 === 0 && updated > 0) {
        console.log(`    ... ${updated} / ${classified.length} updated`);
      }
    }
    console.log(`\n  ✅ Phase 3 完了: ${updated} series updated, ${errors} errors`);
  }

  // ── サマリー ──
  console.log('\n── サマリー ──');
  console.log(`  Phase 1 (単純マージ): ${phase1Count} rows`);
  console.log(`  Phase 2 (カテゴリ移行): ${phase2Count} rows`);
  console.log(`  Phase 3 (名前分類): ${classified.length} series classified, ${unclassified.length} unclassified`);

  if (!APPLY && !DRY_RUN && !DUMP_UNKNOWN) {
    console.log('\n  使い方:');
    console.log('    npx tsx scripts/type-migration.ts --dry-run        # プレビュー');
    console.log('    npx tsx scripts/type-migration.ts --dump-unknown    # 未分類リスト出力');
    console.log('    npx tsx scripts/type-migration.ts --apply           # 実行');
  }
}

main().catch(console.error);
