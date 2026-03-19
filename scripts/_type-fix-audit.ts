/**
 * _type-fix-audit.ts — descriptionとtypeの矛盾を検出・修正するスクリプト
 *
 * 戦略: descriptionの最初の文（最初の句点まで）で商品自体のタイプを
 * 明示的に宣言している場合のみ、typeとの矛盾を検出する。
 * 「ラバージグのトレーラー」「ジグヘッドで使える」等の使い方文脈は除外。
 *
 * Usage:
 *   npx tsx scripts/_type-fix-audit.ts              # dry-run（候補一覧）
 *   npx tsx scripts/_type-fix-audit.ts --apply      # DB更新実行
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

// ──────────────────────────────────────────────
// タイプキーワードと除外パターン
// ──────────────────────────────────────────────
interface TypeRule {
  keyword: string;
  validTypes: string[];
  correctType: string;
  /** キーワードの前後に出ると誤検知になるパターン */
  excludeContexts: RegExp[];
}

const TYPE_RULES: TypeRule[] = [
  {
    keyword: 'ブレードベイト',
    validTypes: ['ブレードベイト', 'メタルバイブ'],
    correctType: 'ブレードベイト',
    excludeContexts: [],
  },
  {
    keyword: 'ジグヘッド',
    validTypes: ['ジグヘッド'],
    correctType: 'ジグヘッド',
    excludeContexts: [
      // 「ジグヘッドで使う」「ジグヘッドリグ」「ジグヘッドに装着」等はワーム側の説明
      /ジグヘッド(?:で|と|に|を|リグ|ワッキー|スイム(?!ベイト)|フック|の刺し|との組み合わせ|との相性|のセット)/,
      /(?:テキサス|ノーシンカー|ダウンショット|フリーリグ|キャロ|ネコリグ).*ジグヘッド/,
      /ジグヘッド.*(?:テキサス|ノーシンカー|ダウンショット|フリーリグ|キャロ)/,
      // 「ジグヘッド+ワーム」セット／ワームリグはジグヘッドのまま
      /ジグヘッド(?:ワーム|＋ワーム|\+ワーム|とワーム|ワームセット|ワームリグ)/,
      // ジグヘッドの取付方法を説明（ワーム側）
      /ジグヘッド(?:取付|取り付け|装着)/,
      /(?:あらゆる|対応|セット可能|リグバランス|最適な).*ジグヘッド/,
      /ジグヘッド(?:や|に最適|に対応|にも)/,
      /ジグヘッドのスライド/,
    ],
  },
  {
    keyword: 'ワーム',
    validTypes: ['ワーム'],
    correctType: 'ワーム',
    excludeContexts: [
      /ワーム(?:キーパー|ホルダー|トレーラー)/,
      /(?:ワーム|ソフトベイト)(?:を|に).*(?:セット|装着|付け|トレーラー)/,
      // 「ワーム一体型」「ワーム素材」はハードルアー/システム
      /ワーム一体型/,
      /ワーム素材/,
      // 「ワームのアクション」「ワームに対応」はジグヘッド側の説明
      /ワーム(?:の|に).*(?:アクション|対応|セット|最適化)/,
      // 「ワームジギング」は釣り方
      /ワームジギング/,
      // 「ワームとの」「ワームのズレ」はジグヘッドの説明
      /ワームとの/,
      /ワームのズレ/,
      // 「ワームとセット」「ワーム＋ジグヘッド」はジグヘッドセット
      /ワーム(?:＋|と|の組み合わせ).*(?:ジグヘッド|セット)/,
      /(?:ジグヘッド|ヘッド).*ワーム(?:セット|の組み合わせ)/,
      // 「どんなワームにも出せない」は比較文脈
      /ワーム.*(?:出せない|できない|にはない)/,
    ],
  },
  {
    keyword: 'ソフトベイト',
    validTypes: ['ワーム'],
    correctType: 'ワーム',
    excludeContexts: [],
  },
  {
    keyword: 'スプーン',
    validTypes: ['スプーン'],
    correctType: 'スプーン',
    excludeContexts: [
      /スプーンベイト/,
    ],
  },
  {
    keyword: 'メタルジグ',
    validTypes: ['メタルジグ'],
    correctType: 'メタルジグ',
    excludeContexts: [
      /メタルジグ(?:に匹敵|に迫る|並み|のような|顔負け|クラス|以上に)/,  // 比較表現
      /(?:匹敵|同等|超える).*メタルジグ/,
      // 「プラグやメタルジグでは反応させられない」は対比文脈
      /メタルジグ(?:では|とは|のように|が届かない|が効かない)/,
    ],
  },
  {
    keyword: 'スピナーベイト',
    validTypes: ['スピナーベイト'],
    correctType: 'スピナーベイト',
    excludeContexts: [
      /スピナーベイト(?:の|に|と).*(?:トレーラー|セット|装着|付け|組み合わせ)/,
      /(?:トレーラー|セット|装着).*スピナーベイト/,
      /スピナーベイトトレーラー/,
    ],
  },
  {
    keyword: 'チャターベイト',
    validTypes: ['チャターベイト'],
    correctType: 'チャターベイト',
    excludeContexts: [],
  },
  {
    keyword: 'ラバージグ',
    validTypes: ['ラバージグ'],
    correctType: 'ラバージグ',
    excludeContexts: [
      // 「ラバージグのトレーラー」「ラバージグに装着」はワーム側の説明
      /ラバージグ(?:の|に|と).*(?:トレーラー|セット|装着|付け|組み合わせ)/,
      /(?:トレーラー|セット|装着).*ラバージグ/,
      /(?:スモール)?ラバージグ(?:の)?トレーラー/,
      /ラバージグトレーラー/,
    ],
  },
  {
    keyword: 'バイブレーション',
    validTypes: ['バイブレーション', 'メタルバイブ'],
    correctType: 'バイブレーション',
    excludeContexts: [
      /メタルバイブレーション/,  // 別ルールで対処
      /バイブレーション(?:的|を発生|を生み出|アクション|波動|に匹敵|に近い|テール|ワーム)/,  // 振動の意味・ワーム種類名
      /(?:強い|微細な|独特の|ハイピッチ|タイト|ライブ系|強振動|ハイインパクト)バイブレーション/,  // アクション記述
      /ブレード(?:の)?バイブレーション/,  // ブレードの振動
      /バイブレーション(?:と|を).*(?:サウンド|生み出|発生)/,  // アクション記述
    ],
  },
  {
    keyword: 'クローラーベイト',
    validTypes: ['クローラーベイト'],
    correctType: 'クローラーベイト',
    excludeContexts: [],
  },
  // ── 英語キーワード ──
  {
    keyword: 'soft plastic',
    validTypes: ['ワーム'],
    correctType: 'ワーム',
    excludeContexts: [],
  },
  {
    keyword: 'soft bait',
    validTypes: ['ワーム'],
    correctType: 'ワーム',
    excludeContexts: [],
  },
  {
    keyword: 'blade bait',
    validTypes: ['ブレードベイト', 'メタルバイブ'],
    correctType: 'ブレードベイト',
    excludeContexts: [],
  },
  {
    keyword: 'jighead',
    validTypes: ['ジグヘッド'],
    correctType: 'ジグヘッド',
    excludeContexts: [
      /jighead(?:s)?(?:\s+(?:and|or|with|for|to|in))/i,
    ],
  },
  {
    keyword: 'jig head',
    validTypes: ['ジグヘッド'],
    correctType: 'ジグヘッド',
    excludeContexts: [
      /jig head(?:s)?(?:\s+(?:and|or|with|for|to|in))/i,
    ],
  },
  {
    keyword: 'spinnerbait',
    validTypes: ['スピナーベイト'],
    correctType: 'スピナーベイト',
    excludeContexts: [
      /spinnerbait\s+trailer/i,
    ],
  },
  {
    keyword: 'chatterbait',
    validTypes: ['チャターベイト'],
    correctType: 'チャターベイト',
    excludeContexts: [
      /chatterbait\s+trailer/i,
    ],
  },
  {
    keyword: 'bladed jig',
    validTypes: ['チャターベイト'],
    correctType: 'チャターベイト',
    excludeContexts: [],
  },
  {
    keyword: 'metal jig',
    validTypes: ['メタルジグ'],
    correctType: 'メタルジグ',
    excludeContexts: [],
  },
  {
    keyword: 'spoon',
    validTypes: ['スプーン'],
    correctType: 'スプーン',
    excludeContexts: [
      /spoon-?fed|spoon\s+feed/i,
    ],
  },
  {
    keyword: 'crankbait',
    validTypes: ['クランクベイト'],
    correctType: 'クランクベイト',
    excludeContexts: [],
  },
  {
    keyword: 'swimbait',
    validTypes: ['スイムベイト'],
    correctType: 'スイムベイト',
    excludeContexts: [],
  },
];

// ──────────────────────────────────────────────
// 最初の文を抽出
// ──────────────────────────────────────────────
function getFirstSentence(desc: string): string {
  // 最初の句点（。or .）まで、なければ最初の改行まで、なければ先頭150文字
  const periodMatch = desc.match(/^[^。.]+[。.]/);
  if (periodMatch) return periodMatch[0];
  const nlMatch = desc.match(/^[^\n]+/);
  if (nlMatch && nlMatch[0].length <= 200) return nlMatch[0];
  return desc.slice(0, 150);
}

/**
 * 最初の文で商品自体がそのタイプであると宣言しているか判定
 * 例: 「〇〇はブレードベイトだ」「ブレードベイト型の〇〇」
 * 除外: 「ラバージグのトレーラーとして」「ジグヘッドで使える」
 */
function isTypeSelfDeclaration(firstSentence: string, keyword: string, excludeContexts: RegExp[]): boolean {
  if (!firstSentence.includes(keyword)) return false;

  // 除外パターンチェック
  for (const ec of excludeContexts) {
    if (ec.test(firstSentence)) return false;
  }

  return true;
}

// ──────────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────────
interface Candidate {
  manufacturer_slug: string;
  slug: string;
  name: string;
  currentType: string;
  correctType: string;
  firstSentence: string;
}

async function fetchAllLures() {
  const PAGE = 1000;
  const all: { manufacturer_slug: string; slug: string; name: string; type: string; description: string }[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb.from('lures')
      .select('manufacturer_slug, slug, name, type, description')
      .not('description', 'is', null)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error(`Fetch error at offset ${from}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  console.log('=== Type Fix Audit: description vs type 矛盾検出 ===\n');

  const lures = await fetchAllLures();
  console.log(`全レコード取得: ${lures.length} 件\n`);

  // slugごとに1レコード
  const seen = new Map<string, typeof lures[0]>();
  for (const l of lures) {
    const key = `${l.manufacturer_slug}/${l.slug}`;
    if (!seen.has(key)) {
      seen.set(key, l);
    }
  }
  console.log(`ユニークシリーズ: ${seen.size} 件\n`);

  const candidates: Candidate[] = [];

  for (const [, lure] of seen) {
    if (!lure.description) continue;

    const firstSent = getFirstSentence(lure.description);

    for (const rule of TYPE_RULES) {
      if (!isTypeSelfDeclaration(firstSent, rule.keyword, rule.excludeContexts)) continue;

      // 現在のtypeが正しいtype群に含まれていたらスキップ
      if (rule.validTypes.includes(lure.type)) continue;

      candidates.push({
        manufacturer_slug: lure.manufacturer_slug,
        slug: lure.slug,
        name: lure.name,
        currentType: lure.type,
        correctType: rule.correctType,
        firstSentence: firstSent.slice(0, 150),
      });

      break; // 1シリーズにつき1ルールだけ
    }
  }

  // タイプ変更別に集計
  const changeGroups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.currentType} → ${c.correctType}`;
    if (!changeGroups.has(key)) changeGroups.set(key, []);
    changeGroups.get(key)!.push(c);
  }

  console.log(`=== 矛盾検出結果: ${candidates.length} 件 ===\n`);

  // グループ別に表示
  const sortedGroups = [...changeGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [change, items] of sortedGroups) {
    console.log(`── ${change} (${items.length}件) ──`);
    for (const c of items) {
      console.log(`  ${c.manufacturer_slug}/${c.slug}`);
      console.log(`    name: ${c.name}`);
      console.log(`    first: ${c.firstSentence}`);
      console.log('');
    }
  }

  // サマリー
  console.log('── サマリー ──');
  for (const [change, items] of sortedGroups) {
    console.log(`  ${change}: ${items.length}件`);
  }
  console.log(`  合計: ${candidates.length}件`);

  // --apply モード
  if (APPLY) {
    console.log('\n── DB更新実行 ──');
    let updated = 0;
    let errors = 0;

    for (const c of candidates) {
      const { error } = await sb.from('lures')
        .update({ type: c.correctType })
        .eq('manufacturer_slug', c.manufacturer_slug)
        .eq('slug', c.slug);

      if (error) {
        console.error(`  ❌ ${c.manufacturer_slug}/${c.slug}: ${error.message}`);
        errors++;
      } else {
        updated++;
      }
    }
    console.log(`\n✅ 完了: ${updated}件更新, ${errors}件エラー`);
  } else {
    console.log('\n⚠️ dry-runモード: DBは更新されません');
    console.log('  実行するには: npx tsx scripts/_type-fix-audit.ts --apply');
  }
}

main().catch(console.error);
