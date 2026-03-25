/**
 * 自動エディトリアルレビュー生成
 *
 * 手書きエディトリアル（93件）がないルアーに対し、
 * Supabaseのスペックデータからテンプレートベースでレビューコンテンツを生成する。
 *
 * 手書き > 自動生成 の優先順位で表示。
 */

import type { LureSeries } from './types';
import type { EditorialReview } from '../data/seo/editorials/huggos';
import type { ColorBreakdownEntry } from './color-categories';

// ─── タイプ別テンプレート ───

interface TypeTemplate {
  /** このルアータイプの一般的な特徴 */
  characteristic: string;
  /** 代表的なアクション */
  action: string;
  /** 使われるシチュエーション */
  situations: string[];
  /** 初心者向けの一言 */
  beginnerTip: string;
}

const TYPE_TEMPLATES: Record<string, TypeTemplate> = {
  'ミノー': {
    characteristic: '小魚を模したリップ付きのプラグ。リトリーブやトゥイッチで小魚のような泳ぎを再現する',
    action: 'ただ巻きでのウォブリング＋ロールアクション。トゥイッチやジャークで不規則なダートも可能',
    situations: ['常夜灯周り', '河口', '磯', 'サーフ'],
    beginnerTip: 'まずはただ巻きから。巻き速度を変えるだけでアクションが変化する',
  },
  'クランクベイト': {
    characteristic: '丸みを帯びたボディとリップが特徴のプラグ。巻くだけで一定のレンジを泳ぐ',
    action: 'ファストリトリーブでのタイトウォブル。障害物に当てて跳ね上げるディフレクティングも有効',
    situations: ['リップラップ', 'ウィードエッジ', 'シャローフラット', 'カバー周り'],
    beginnerTip: '巻くだけで釣れるのが最大の魅力。根がかりしにくいのもクランクの利点',
  },
  'バイブレーション': {
    characteristic: 'リップなしで全身が振動するルアー。沈む速度が速くディープレンジを攻略しやすい',
    action: 'ただ巻きで全身を細かく震わせる高速バイブレーション。リフト＆フォールも定番',
    situations: ['広大なフラット', 'ディープレンジ', 'オープンウォーター', '冬のリアクション'],
    beginnerTip: 'ボトムまで沈めて巻き上げるリフト＆フォールが最もベーシック',
  },
  'スプーン': {
    characteristic: '金属製の薄いプレート型ルアー。シンプルな形状ながらフラッシングとウォブルで幅広い魚を魅了する',
    action: 'ただ巻きでのヒラヒラとしたウォブリング。フォールでもアピール可能',
    situations: ['管理釣り場', '渓流', '湖', 'ソルトのライトゲーム'],
    beginnerTip: '一定速のただ巻きが基本。巻き速度を変えることでレンジとアクションを調整',
  },
  'ワーム': {
    characteristic: 'ソフトプラスチック製の柔らかいルアー。リグによって多彩なアクションを演出できる',
    action: 'リグに応じて変化。テキサスリグでのボトムパンプ、ネコリグのシェイク等',
    situations: ['カバー撃ち', 'ボトム攻め', 'ミドスト', 'フィネス全般'],
    beginnerTip: 'ノーシンカーリグから始めるのがおすすめ。フォールだけで釣れる',
  },
  'メタルジグ': {
    characteristic: '金属の塊で構成された高比重ルアー。圧倒的な飛距離とフォールスピードが武器',
    action: 'ワンピッチジャーク、ショートジャーク＋フォール。ただ巻きでも使えるタイプが増加中',
    situations: ['ショアジギング', 'オフショアジギング', 'サーフ', '堤防'],
    beginnerTip: 'まずはワンピッチジャークを覚えよう。しゃくって落とすの繰り返しが基本',
  },
  'ジョイントベイト': {
    characteristic: '複数のパーツが連結されたルアー。ジョイント部分がしなることで生命感のあるS字アクションを生む',
    action: 'ただ巻きでの艶めかしいS字。デッドスローでフラフラと漂わせるのも効果的',
    situations: ['バスのビッグベイトゲーム', 'シーバスのナイトゲーム', 'トップウォーター'],
    beginnerTip: 'ゆっくり巻くだけでOK。ジョイントが勝手にアクションを作ってくれる',
  },
  'シンキングペンシル': {
    characteristic: 'リップなしで沈むスリムなプラグ。ナチュラルなS字アクションでスレた魚にも効く',
    action: 'ただ巻きでのS字スラローム。フォールとリトリーブの組み合わせで多彩',
    situations: ['バチ抜け', '河口のシーバス', 'サーフのヒラメ', '磯のヒラスズキ'],
    beginnerTip: 'スローリトリーブが基本。流れに乗せるドリフトも覚えると引き出しが増える',
  },
  'ペンシルベイト': {
    characteristic: 'トップウォータープラグの代表格。水面で左右に首を振る「ドッグウォーク」で誘う',
    action: 'ロッドワークでドッグウォーク。ポーズを入れることで食わせの間を作る',
    situations: ['朝マヅメ', '夕マヅメ', '夏の高活性時', 'ボイル撃ち'],
    beginnerTip: 'リズミカルにロッドを煽って左右に首を振らせる。焦らずテンポよく',
  },
  'ポッパー': {
    characteristic: 'カップ状の口で水面を「ポコッ」と弾く音と飛沫で魚を誘うトップウォーター',
    action: 'ロッドティップで弾くようにアクション。スプラッシュとポップ音でアピール',
    situations: ['朝マヅメ', '夕マヅメ', 'ナブラ撃ち', '水面に魚が出ている時'],
    beginnerTip: '短くシャープにロッドを煽る。大きくやりすぎるとルアーが飛び出すので注意',
  },
  'エギ': {
    characteristic: 'イカ専用のルアー。布巻きボディとカンナ（傘針）が特徴',
    action: 'シャクリ＋フォールの組み合わせ。ダートでイカを興奮させ、フォールで抱かせる',
    situations: ['堤防', '磯', '漁港', 'サーフ'],
    beginnerTip: '2〜3回シャクって、テンションフォール。ラインの変化でアタリを取る',
  },
  'フロッグ': {
    characteristic: 'カエルを模した中空ボディのトップウォーター。ヘビーカバーの上を攻略できる唯一のルアー',
    action: 'カバーの上をスローに引いてポーズ。首振りアクションで誘うドッグウォーク',
    situations: ['リリーパッド', 'マットカバー', 'アシ際', 'ウィードトップ'],
    beginnerTip: 'バイトがあってもすぐにフッキングしない。飲み込むまでカウント3待つのがコツ',
  },
  'スピナーベイト': {
    characteristic: 'ワイヤーにブレードとスカートが付いた複合ルアー。フラッシングと振動で広範囲をサーチ',
    action: 'ただ巻きでブレードが回転。スローロール（ボトム付近をゆっくり巻く）も有効',
    situations: ['濁り', '風が吹いている時', 'カバー際', 'オープンウォーター'],
    beginnerTip: '巻くだけで釣れるサーチベイトの定番。根がかりしにくいのも魅力',
  },
  'ラバージグ': {
    characteristic: 'ジグヘッドにラバースカートを巻いたルアー。カバー攻略の主力',
    action: 'フリッピング、ピッチングでカバーに撃ち込む。ボトムバンプやスイミングも',
    situations: ['カバー撃ち', 'テトラ', 'リップラップ', 'ボトム攻め'],
    beginnerTip: 'カバーの奥に入れてフォール。着底後にシェイクで誘う',
  },
  'トップウォーター': {
    characteristic: '水面で使うルアーの総称。バイトの瞬間が見える興奮が最大の魅力',
    action: '水面を滑らせる、弾く、漂わせる等タイプにより多様',
    situations: ['朝夕マヅメ', '夏の高活性時', 'ボイル発生時', 'シャローエリア'],
    beginnerTip: '魚が水面を意識している時間帯（朝夕）を狙うのがコツ',
  },
  'タイラバ': {
    characteristic: 'ヘッド（鉛）＋ネクタイ＋フックで構成される船からのマダイ狙い専用ルアー',
    action: '等速巻きが基本。巻き速度を一定に保つことが最重要',
    situations: ['沖のポイント', '水深30-80m', 'マダイの好むボトム付近'],
    beginnerTip: '一定のスピードで巻き続けることが最大のコツ。速度変化は厳禁',
  },
};

// デフォルトテンプレート（上記にないタイプ用）
const DEFAULT_TEMPLATE: TypeTemplate = {
  characteristic: 'ルアーフィッシングで使用するルアー',
  action: 'リトリーブやアクションで魚を誘う',
  situations: ['様々なフィールド'],
  beginnerTip: 'まずはただ巻きから試してみよう',
};

// ─── 魚種別コンテキスト ───

const FISH_CONTEXT: Record<string, string> = {
  'ブラックバス': 'バス釣りの定番',
  'シーバス': 'シーバスゲームの',
  '青物': '青物狙いの',
  'トラウト': 'トラウトフィッシングの',
  'ヒラメ': 'フラットフィッシュ攻略の',
  'マダイ': 'マダイ狙いの',
  'アジ': 'アジングの',
  'メバル': 'メバリングの',
  'ヒラマサ': 'ヒラマサ攻略の',
  'アオリイカ': 'エギングの',
  'ロックフィッシュ': 'ロックフィッシュゲームの',
  'クロダイ': 'チニングの',
  'タチウオ': 'タチウオ狙いの',
  'イカ': 'イカ釣りの',
};

// ─── カラー系統テンプレート ───

function generateColorAdvice(colors: { color_name: string }[], colorCount: number): string {
  if (colorCount === 0) return '';

  // カラー名からパターン検出
  const names = colors.map(c => c.color_name.toLowerCase());
  const hasNatural = names.some(n => /natural|ナチュラル|real|リアル|ayu|iwashi|イワシ|アユ/.test(n));
  const hasChart = names.some(n => /chart|チャート|pink|ピンク|蛍光/.test(n));
  const hasGold = names.some(n => /gold|ゴールド|アカキン/.test(n));
  const hasGlow = names.some(n => /glow|グロー|夜光/.test(n));
  const hasClear = names.some(n => /clear|クリア|ゴースト/.test(n));

  const parts: string[] = [];
  parts.push(`全${colorCount}色展開。`);

  if (hasNatural && hasChart) {
    parts.push('ナチュラル系からアピール系まで幅広いカラーラインナップ。クリアウォーターではナチュラル系、濁りやローライトではチャート・ゴールド系がおすすめ。');
  } else if (hasNatural) {
    parts.push('ナチュラル系カラーが充実。クリアウォーターでの使用に適したカラーバリエーション。');
  } else if (hasChart) {
    parts.push('アピール系カラーが多め。濁りやローライトコンディションでの視認性重視のラインナップ。');
  }

  if (hasGlow) parts.push('グローカラーもラインナップされており、夜間やディープでの使用にも対応。');

  return parts.join('');
}

// ─── 価格コメント生成 ───

function generatePriceComment(priceMin: number, priceMax: number, type: string): string {
  if (priceMax === 0) return '';

  const avg = (priceMin + priceMax) / 2;

  // タイプ別の価格感
  if (type === 'スプーン' || type === 'ジグヘッド') {
    if (avg <= 500) return '手頃な価格で、ロストを恐れずに攻められる。';
    if (avg <= 800) return '標準的な価格帯。コストパフォーマンスは良好。';
    return 'やや高めの設定だが、品質に見合った価格。';
  }
  if (type === 'ワーム') {
    if (avg <= 600) return '消耗品として使いやすい価格設定。';
    if (avg <= 1000) return '標準的なワームの価格帯。';
    return '高品質素材を使用したプレミアムクラス。';
  }
  if (type === 'メタルジグ') {
    if (avg <= 800) return 'コスパ良好。ロストの多いショアジギングでも気軽に使える。';
    if (avg <= 1500) return '標準的なメタルジグの価格帯。';
    return 'ハイエンドクラスの価格設定。';
  }
  // プラグ系
  if (avg <= 1200) return '手頃な価格設定。入門用としてもおすすめ。';
  if (avg <= 1800) return '標準的なプラグの価格帯。コストパフォーマンスは良好。';
  if (avg <= 2500) return 'ミドルクラスの価格帯。品質と価格のバランスが取れている。';
  return 'ハイエンドクラスの価格設定。こだわりの設計と仕上げが光る。';
}

// ─── メイン生成関数 ───

/**
 * ルアーシリーズのスペックデータからテンプレートベースのエディトリアルを自動生成
 *
 * @returns EditorialReview | null（情報不足の場合はnull）
 */
export function generateAutoEditorial(
  series: LureSeries,
  colorBreakdown?: ColorBreakdownEntry[],
): EditorialReview | null {
  // 最低限のデータがないルアーはスキップ
  if (!series.type || !series.description) return null;

  const template = TYPE_TEMPLATES[series.type] || DEFAULT_TEMPLATE;
  const fishCtx = (series.target_fish || []).length > 0
    ? FISH_CONTEXT[(series.target_fish || [])[0]] || `${(series.target_fish || [])[0]}狙いの`
    : '';

  const hasWeight = series.weight_range.min != null || series.weight_range.max != null;
  const hasLength = series.length_range.min != null || series.length_range.max != null;

  // ─── キャッチコピー ───
  const catchcopy = `${series.manufacturer}が送る${fishCtx}${series.type}。${series.description.slice(0, 50).replace(/。.*$/, '')}。`;

  // ─── 概要 ───
  const overviewParts: string[] = [];
  overviewParts.push(`${series.name}は、${series.manufacturer}の${fishCtx}${series.type}だ。${template.characteristic}。`);

  if (series.description) {
    // Supabaseのdescriptionから1-2文を使用
    const desc = series.description.replace(/\n/g, '').slice(0, 200);
    overviewParts.push(desc);
  }

  // スペックサマリー
  const specParts: string[] = [];
  if (series.color_count > 0) specParts.push(`${series.color_count}カラー展開`);
  if (hasWeight) {
    const w = series.weight_range;
    specParts.push(w.min === w.max ? `${w.min}g` : `${w.min}〜${w.max}g`);
  }
  if (hasLength) {
    const l = series.length_range;
    specParts.push(l.min === l.max ? `${l.min}mm` : `${l.min}〜${l.max}mm`);
  }
  if (specParts.length > 0) {
    overviewParts.push(`スペックは${specParts.join('、')}。`);
  }

  const overview = overviewParts.join('\n\n');

  // ─── 強み ───
  const strengths: { title: string; body: string }[] = [];

  // 強み1: タイプ特有のアクション
  strengths.push({
    title: `${series.type}ならではのアクション`,
    body: `${template.action}。${series.name}はこのカテゴリの中でも${series.color_count}カラーという豊富な展開で、状況に応じたカラーセレクションが可能。`,
  });

  // 強み2: ウェイト/サイズバリエーション
  if (hasWeight && series.weight_range.min !== series.weight_range.max) {
    strengths.push({
      title: '幅広いウェイトバリエーション',
      body: `${series.weight_range.min}gから${series.weight_range.max}gまでのウェイト展開で、フィールドや条件に合わせたサイズ選択が可能。軽量モデルはフィネスな攻めに、重量モデルは遠投や深場攻略に対応する。`,
    });
  } else {
    strengths.push({
      title: `${series.manufacturer}の設計力`,
      body: `${series.manufacturer}が手がける${series.type}として、細部まで作り込まれた設計。${series.color_count}色のカラーラインナップは、メーカーの本気度を示している。`,
    });
  }

  // 強み3: 価格
  const priceComment = generatePriceComment(series.price_range.min, series.price_range.max, series.type);
  if (priceComment) {
    strengths.push({
      title: 'コストパフォーマンス',
      body: `価格は${series.price_range.min === series.price_range.max ? `¥${series.price_range.min.toLocaleString()}` : `¥${series.price_range.min.toLocaleString()}〜¥${series.price_range.max.toLocaleString()}`}。${priceComment}`,
    });
  }

  // ─── 使い方 ───
  const usage = template.situations.slice(0, 3).map(sit => ({
    scene: sit,
    body: `${sit}での使用に適している。${template.action}。${template.beginnerTip}`,
  }));

  // ─── カラーガイド ───
  const colorGuide = generateColorAdvice(series.colors || [], series.color_count);

  // ─── 気になるポイント ───
  const concerns: string[] = [];
  if (series.price_range.max > 2000) concerns.push('価格がやや高めのため、根がかりの多いポイントではロストが気になる');
  if (series.color_count <= 3) concerns.push('カラーバリエーションが少なめで、ローテーションの幅が限られる');
  if (series.weight_range.min && series.weight_range.min < 5) concerns.push('軽量のため、風が強い日は飛距離が出にくい');
  if (concerns.length === 0) concerns.push('特筆すべき弱点は少ないが、用途に合ったサイズ・カラー選びが重要');

  // ─── おすすめ ───
  const recommendation = {
    recommended: [
      `${(series.target_fish || []).length > 0 ? (series.target_fish || [])[0] + '狙いの' : ''}アングラーに`,
      `${series.manufacturer}のルアーが好きな方に`,
      `${series.type}の引き出しを増やしたい中級者に`,
    ],
    notRecommended: [
      `${series.type}を初めて使う完全初心者（まずは定番モデルから）`,
    ],
  };

  // ─── FAQ ───
  const faq: { q: string; a: string }[] = [
    {
      q: `${series.name}とは？`,
      a: `${series.name}は${series.manufacturer}の${fishCtx}${series.type}です。${series.description?.slice(0, 100) || template.characteristic}`,
    },
    {
      q: `${series.name}のカラーは何色？`,
      a: `全${series.color_count}色展開です。${colorGuide.slice(0, 100)}`,
    },
  ];

  if (hasWeight) {
    faq.push({
      q: `${series.name}の重さは？`,
      a: series.weight_range.min === series.weight_range.max
        ? `${series.weight_range.min}gです。`
        : `${series.weight_range.min}gから${series.weight_range.max}gまでのバリエーションがあります。`,
    });
  }

  if (series.price_range.max > 0) {
    faq.push({
      q: `${series.name}の価格は？`,
      a: series.price_range.min === series.price_range.max
        ? `¥${series.price_range.min.toLocaleString()}です。`
        : `¥${series.price_range.min.toLocaleString()}〜¥${series.price_range.max.toLocaleString()}です。`,
    });
  }

  faq.push({
    q: `${series.name}の使い方は？`,
    a: `${template.action}。${template.beginnerTip}`,
  });

  return {
    slug: series.slug,
    manufacturerSlug: series.manufacturer_slug,
    catchcopy,
    overview,
    strengths,
    usage,
    colorGuide,
    concerns,
    recommendation,
    faq,
    meta: {
      generatedAt: 'auto',
      targetKeyword: series.name,
      competitorAnalysis: 'テンプレートベース自動生成',
    },
  };
}
