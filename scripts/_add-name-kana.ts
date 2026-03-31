import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// 英単語→カタカナ辞書（釣り用語・ブランド・一般英語）
const WORD_MAP: Record<string, string> = {
  // 釣り用語
  'MINNOW': 'ミノー', 'SHAD': 'シャッド', 'JIG': 'ジグ', 'CRANK': 'クランク',
  'CRANKBAIT': 'クランクベイト', 'POPPER': 'ポッパー', 'PENCIL': 'ペンシル',
  'SWIMBAIT': 'スイムベイト', 'SWIMMER': 'スイマー', 'JERKBAIT': 'ジャークベイト',
  'SPINNERBAIT': 'スピナーベイト', 'BLADE': 'ブレード', 'BUZZBAIT': 'バズベイト',
  'FROG': 'フロッグ', 'WORM': 'ワーム', 'GRUB': 'グラブ', 'TUBE': 'チューブ',
  'FLUKE': 'フルーク', 'STICK': 'スティック', 'CHATTER': 'チャター',
  'VIBRATION': 'バイブレーション', 'VIBE': 'バイブ', 'GLIDE': 'グライド',
  'GLIDER': 'グライダー', 'WALKER': 'ウォーカー', 'WAKE': 'ウェイク',
  'TOPWATER': 'トップウォーター', 'PROP': 'プロップ', 'TAIL': 'テール',
  'BAIT': 'ベイト', 'LURE': 'ルアー', 'PLUG': 'プラグ', 'SPOON': 'スプーン',
  'SPINNER': 'スピナー', 'METAL': 'メタル', 'RUBBER': 'ラバー',
  'SOFT': 'ソフト', 'HARD': 'ハード', 'SINKING': 'シンキング', 'FLOATING': 'フローティング',
  'SUSPENDING': 'サスペンディング', 'SUPER': 'スーパー', 'ULTRA': 'ウルトラ',
  'HEAVY': 'ヘビー', 'LIGHT': 'ライト', 'MEDIUM': 'ミディアム',
  'SLIM': 'スリム', 'FAT': 'ファット', 'FLAT': 'フラット', 'DEEP': 'ディープ',
  'SHALLOW': 'シャロー', 'LONG': 'ロング', 'SHORT': 'ショート',
  'LARGE': 'ラージ', 'SMALL': 'スモール', 'MICRO': 'マイクロ', 'MINI': 'ミニ',
  'TINY': 'タイニー', 'JUNIOR': 'ジュニア', 'JR': 'ジュニア',
  'NEW': 'ニュー', 'ORIGINAL': 'オリジナル', 'SPECIAL': 'スペシャル',
  'LIMITED': 'リミテッド', 'CUSTOM': 'カスタム', 'TOURNAMENT': 'トーナメント',
  'MASTER': 'マスター', 'PRO': 'プロ', 'ELITE': 'エリート', 'KING': 'キング',
  'ATTACK': 'アタック', 'IMPACT': 'インパクト', 'FLASH': 'フラッシュ',
  'GHOST': 'ゴースト', 'SHADOW': 'シャドウ', 'STEALTH': 'ステルス',
  'WILD': 'ワイルド', 'POWER': 'パワー', 'FORCE': 'フォース', 'STRIKE': 'ストライク',
  'MAGIC': 'マジック', 'MYTH': 'ミス', 'LEGEND': 'レジェンド',
  // カバー
  'COVER': 'カバー', 'BRUSH': 'ブラッシュ', 'WEED': 'ウィード',
  // サイズ表記
  'REGULAR': 'レギュラー', 'STANDARD': 'スタンダード', 'STD': 'スタンダード',
  // アクション
  'SWIM': 'スイム', 'DIVE': 'ダイブ', 'ROLL': 'ロール', 'WOBBLE': 'ウォブル',
  'WIGGLE': 'ウィグル', 'DART': 'ダート', 'SLIDE': 'スライド', 'HOP': 'ホップ',
  'CRAWL': 'クロール', 'KICK': 'キック', 'WAVE': 'ウェーブ', 'WAVER': 'ウェーバー',
  'BEAT': 'ビート', 'DANCE': 'ダンス',
  // 魚・動物・自然
  'BASS': 'バス', 'TROUT': 'トラウト', 'SALMON': 'サーモン', 'TUNA': 'ツナ',
  'AMBERJACK': 'アンバージャック', 'FLOUNDER': 'フラウンダー', 'SNOOK': 'スヌーク',
  'REDFISH': 'レッドフィッシュ', 'PIKE': 'パイク', 'PERCH': 'パーチ',
  'SARDINE': 'サーディン', 'ANCHOVY': 'アンチョビ', 'EEL': 'イール',
  'FROG': 'フロッグ', 'MOUSE': 'マウス', 'RAT': 'ラット', 'BIRD': 'バード',
  'BUG': 'バグ', 'MOTH': 'モス', 'FLY': 'フライ', 'SHRIMP': 'シュリンプ',
  'CRAYFISH': 'クレイフィッシュ', 'CRAB': 'クラブ', 'SQUID': 'スクイッド',
  'SNAKE': 'スネーク', 'RABBIT': 'ラビット', 'GECKO': 'ゲッコー',
  'HAWK': 'ホーク', 'EAGLE': 'イーグル', 'SHARK': 'シャーク',
  'OMEGA': 'オメガ', 'GAMMA': 'ガンマ',
  // cb-one固有
  'DIXONS': 'ディクソン', 'DIXON': 'ディクソン', 'ZORRO': 'ゾロ',
  'RYAN': 'ライアン', 'BRUNO': 'ブルーノ', 'BAZOO': 'バズー', 'OZMA': 'オズマ',
  'RODEO': 'ロデオ', 'OCTAGON': 'オクタゴン', 'ZERO': 'ゼロ', 'QUICK': 'クイック',
  // drt固有
  'KLASH': 'クラッシュ', 'JOKER': 'ジョーカー', 'POLICE': 'ポリス', 'FINK': 'フィンク',
  // hots固有
  'BIGFIN': 'ビッグフィン', 'KALCHI': 'カルチ', 'KEITAN': 'ケイタン',
  'DEBUTAN': 'デビュータン', 'KEIKO': 'ケイコ', 'OCEAN': 'オーシャン',
  'TIDE': 'タイド', 'SARDINE': 'サーディン', 'CHIBITAN': 'チビタン',
  'CONKER': 'コンカー', 'DRIFT': 'ドリフト', 'TUNE': 'チューン', 'SKILL': 'スキル',
  'IGOSSO': 'イゴッソ', 'CHUG': 'チャグ', 'SLASH': 'スラッシュ', 'BULL': 'ブル',
  'GATARO': 'ガタロ', 'CHUGAYU': 'チャガユ', 'MINICHAG': 'ミニチャグ',
  'ALUMINUM': 'アルミニウム', 'SIGMA': 'シグマ',
  // forest固有
  'REALIZE': 'リアライズ', 'CLOSER': 'クローザー', 'TROUSION': 'トラウジョン',
  'MARSHAL': 'マーシャル', 'FACTOR': 'ファクター', 'CHASER': 'チェイサー',
  'MATCH': 'マッチ', 'FIX': 'フィックス', 'FRONT': 'フロント', 'LAKE': 'レイク',
  'FISH': 'フィッシュ', 'PAL': 'パル', 'IMPACT': 'インパクト',
  // attic固有
  'POET': 'ポエット', 'ARCRANK': 'アークランク', 'FOOTBEE': 'フットビー',
  'ANNIE': 'アニー', 'GECCO': 'ゲッコ', 'RANGE': 'レンジ',
  'WATER': 'ウォーター', 'EDGE': 'エッジ', 'LEAF': 'リーフ',
  'LIGHTREAL': 'ライトリアル', 'SUPERFI': 'スーパーフィ', 'MID': 'ミッド',
  'MOCO': 'モコ', 'MOCOMOCO': 'モコモコ',
  'TAKASU': 'タカス', 'FUZZY': 'ファジー', 'LIVING': 'リビング',
  'A': 'エー', 'G': 'ジー',
  // carpenter固有
  'MAIHIME': 'マイヒメ', 'HAYABUSA': 'ハヤブサ', 'UTAHIME': 'ウタヒメ',
  'STRIKE': 'ストライク', 'BLUE': 'ブルー', 'GEN': 'ゲン', 'EI': 'エイ',
  'BEACON': 'ビーコン', 'MARINA': 'マリーナ', 'MARINO': 'マリーノ',
  // mukai固有
  'SNAQ': 'スナック', 'KOMAYA': 'コマヤ', 'ZANMU': 'ザンム', 'ZUNMU': 'ズンム',
  'BACKSTROKE': 'バックストローク', 'SMASH': 'スマッシュ', 'REN': 'レン',
  'BBUZZ': 'ビーバズ', 'BBALL': 'ビーボール', 'BCHATTER': 'ビーチャター',
  // mc-works固有
  'GUTTER': 'ガッター', 'BUNCHIN': 'ブンチン', 'GUTUP': 'ガットアップ',
  'GRAVEL': 'グラベル', 'REGULER': 'レギュラー',
  // d-claw固有
  'SWIMMING': 'スイミング', 'DABS': 'ダブス', 'BUBBLES': 'バブルズ',
  'HIRAMASA': 'ヒラマサ', 'MESSAMAGNUM': 'メッサマグナム', 'MAGNUM': 'マグナム',
  'SPEC': 'スペック',
  // north-craft固有
  'AOG': 'エーオージー', 'AIR': 'エアー', 'OGRE': 'オーガ',
  // nature-boys固有
  'ROBBER': 'ロバー', 'RIDER': 'ライダー', 'SPIN': 'スピン', 'SPINRIDER': 'スピンライダー',
  'SPINRIDERDEEP': 'スピンライダーディープ', 'DEEPROBBER': 'ディープロバー',
  'CURRENTRIDER': 'カレントライダー', 'SWANGER': 'スワンガー', 'SLOWRIDER': 'スローライダー',
  'SLOWRIDER': 'スローライダー', 'PELICAN': 'ペリカン', 'SUSRIDER': 'サスライダー',
  'SWANGBIRD': 'スワングバード', 'SWIMBIRD': 'スイムバード',
  // ja-do固有
  'ERDA': 'エルダ', 'GARURU': 'ガルル', 'TEUFEL': 'テウフェル',
  'ENVY': 'エンビー', 'YORE': 'ヨーレ',
  // hmkl固有
  'ALIVE': 'アライブ', 'JORDAN': 'ジョーダン', 'WAKEMINNOW': 'ウェイクミノー',
  'BONE': 'ボーン', 'SALT': 'ソルト', 'SALTWATER': 'ソルトウォーター',
  // baitbreath固有
  'BAITBREATH': 'ベイトブレス', 'PIN': 'ピン', 'INCH': 'インチ', 'FOR': 'フォー',
  // crazy-ocean固有
  'CRAZY': 'クレイジー',
  // 方角・位置
  'NORTH': 'ノース', 'SOUTH': 'サウス', 'EAST': 'イースト', 'WEST': 'ウェスト',
  'HIGH': 'ハイ', 'LOW': 'ロー', 'MID': 'ミッド', 'TOP': 'トップ',
  // 色・素材
  'SILVER': 'シルバー', 'GOLD': 'ゴールド', 'BLACK': 'ブラック', 'WHITE': 'ホワイト',
  'RED': 'レッド', 'BLUE': 'ブルー', 'GREEN': 'グリーン', 'ORANGE': 'オレンジ',
  'CHROME': 'クローム', 'IRON': 'アイアン', 'STEEL': 'スチール',
  // その他共通
  'COMBO': 'コンボ', 'SET': 'セット', 'PACK': 'パック', 'SERIES': 'シリーズ',
  'TYPE': 'タイプ', 'MODEL': 'モデル', 'VERSION': 'バージョン', 'VER': 'バージョン',
  'PIVOT': 'ピボット', 'SCALE': 'スケール', 'BODY': 'ボディ', 'HEAD': 'ヘッド',
  'BACK': 'バック', 'FRONT': 'フロント', 'SIDE': 'サイド',
  'FCE': 'FCE', 'SRC': 'SRC', 'MRC': 'MRC', 'MR': 'MR', 'SR': 'SR',
  'HF': 'HF', 'SS': 'SS', 'SP': 'SP', 'DR': 'DR', 'IDO': 'IDO',
  'SW': 'SW', 'FW': 'FW', 'BJ': 'BJ', 'BGR': 'BGR',
};

// アルファベット1文字→カタカナ（単独で現れた場合）
const ALPHA_MAP: Record<string, string> = {
  'A': 'エー', 'B': 'ビー', 'C': 'シー', 'D': 'ディー', 'E': 'イー',
  'F': 'エフ', 'G': 'ジー', 'H': 'エイチ', 'I': 'アイ', 'J': 'ジェイ',
  'K': 'ケー', 'L': 'エル', 'M': 'エム', 'N': 'エヌ', 'O': 'オー',
  'P': 'ピー', 'Q': 'キュー', 'R': 'アール', 'S': 'エス', 'T': 'ティー',
  'U': 'ユー', 'V': 'ブイ', 'W': 'ダブリュー', 'X': 'エックス',
  'Y': 'ワイ', 'Z': 'ゼット',
};

// ローマ字→カタカナ（英語発音ベース）フォールバック
function romanToKatakana(word: string): string {
  const upper = word.toUpperCase();

  // 既知の単語チェック
  if (WORD_MAP[upper]) return WORD_MAP[upper];

  // 1文字アルファベット
  if (/^[A-Z]$/.test(upper) && ALPHA_MAP[upper]) return ALPHA_MAP[upper];

  // 全部数字/記号ならそのまま
  if (/^[0-9\/\.\-]+$/.test(word)) return word;

  // 英語発音ルールでカタカナ変換（主要パターン）
  let s = upper;

  // 特定パターンを先に処理
  s = s.replace(/TION/g, 'ション');
  s = s.replace(/SION/g, 'ション');
  s = s.replace(/IGHT/g, 'アイト');
  s = s.replace(/OUGH/g, 'オー');
  s = s.replace(/OULD/g, 'ウッド');
  s = s.replace(/OUND/g, 'アウンド');
  s = s.replace(/OUNT/g, 'アウント');
  s = s.replace(/ANCE/g, 'アンス');
  s = s.replace(/ENCE/g, 'エンス');
  s = s.replace(/NESS/g, 'ネス');
  s = s.replace(/LESS/g, 'レス');
  s = s.replace(/MENT/g, 'メント');
  s = s.replace(/IBLE/g, 'イブル');
  s = s.replace(/ABLE/g, 'アブル');
  s = s.replace(/TURE/g, 'チャー');
  s = s.replace(/STER/g, 'スター');
  s = s.replace(/LING/g, 'リング');
  s = s.replace(/RING/g, 'リング');
  s = s.replace(/KING/g, 'キング');
  s = s.replace(/SING/g, 'シング');
  s = s.replace(/TING/g, 'ティング');
  s = s.replace(/WING/g, 'ウィング');
  s = s.replace(/ING/g, 'イング');
  s = s.replace(/OOK/g, 'ック');
  s = s.replace(/OOL/g, 'ール');
  s = s.replace(/OOM/g, 'ーム');
  s = s.replace(/OON/g, 'ーン');
  s = s.replace(/OOT/g, 'ート');
  s = s.replace(/OOP/g, 'ープ');
  s = s.replace(/OOR/g, 'アー');
  s = s.replace(/EAD/g, 'エッド');
  s = s.replace(/EAR/g, 'イアー');
  s = s.replace(/EAT/g, 'イート');
  s = s.replace(/EEL/g, 'イール');
  s = s.replace(/EEN/g, 'ーン');
  s = s.replace(/EEP/g, 'ープ');
  s = s.replace(/EER/g, 'イアー');
  s = s.replace(/ALL/g, 'オール');
  s = s.replace(/ART/g, 'アート');
  s = s.replace(/ARK/g, 'アーク');
  s = s.replace(/ARM/g, 'アーム');
  s = s.replace(/ARN/g, 'アーン');
  s = s.replace(/ARP/g, 'アープ');
  s = s.replace(/ARS/g, 'アーズ');
  s = s.replace(/ARD/g, 'アード');
  s = s.replace(/ASS/g, 'アス');
  s = s.replace(/ACK/g, 'ック');
  s = s.replace(/ICK/g, 'ック');
  s = s.replace(/OCK/g, 'ック');
  s = s.replace(/UCK/g, 'ック');
  s = s.replace(/ISH/g, 'ッシュ');
  s = s.replace(/USH/g, 'ッシュ');
  s = s.replace(/ASH/g, 'ッシュ');
  s = s.replace(/ESH/g, 'ッシュ');
  s = s.replace(/OSH/g, 'ッシュ');

  // 子音+母音パターン
  const cv: Record<string, string> = {
    'BA': 'バ', 'BI': 'ビ', 'BU': 'ブ', 'BE': 'ベ', 'BO': 'ボ',
    'CA': 'カ', 'CI': 'シ', 'CU': 'キュ', 'CE': 'セ', 'CO': 'コ',
    'DA': 'ダ', 'DI': 'ディ', 'DU': 'デュ', 'DE': 'デ', 'DO': 'ド',
    'FA': 'ファ', 'FI': 'フィ', 'FU': 'フ', 'FE': 'フェ', 'FO': 'フォ',
    'GA': 'ガ', 'GI': 'ジ', 'GU': 'グ', 'GE': 'ジェ', 'GO': 'ゴ',
    'HA': 'ハ', 'HI': 'ヒ', 'HU': 'フ', 'HE': 'ヘ', 'HO': 'ホ',
    'JA': 'ジャ', 'JI': 'ジ', 'JU': 'ジュ', 'JE': 'ジェ', 'JO': 'ジョ',
    'KA': 'カ', 'KI': 'キ', 'KU': 'ク', 'KE': 'ケ', 'KO': 'コ',
    'LA': 'ラ', 'LI': 'リ', 'LU': 'ル', 'LE': 'レ', 'LO': 'ロ',
    'MA': 'マ', 'MI': 'ミ', 'MU': 'ム', 'ME': 'メ', 'MO': 'モ',
    'NA': 'ナ', 'NI': 'ニ', 'NU': 'ヌ', 'NE': 'ネ', 'NO': 'ノ',
    'PA': 'パ', 'PI': 'ピ', 'PU': 'プ', 'PE': 'ペ', 'PO': 'ポ',
    'RA': 'ラ', 'RI': 'リ', 'RU': 'ル', 'RE': 'レ', 'RO': 'ロ',
    'SA': 'サ', 'SI': 'シ', 'SU': 'ス', 'SE': 'セ', 'SO': 'ソ',
    'TA': 'タ', 'TI': 'ティ', 'TU': 'テュ', 'TE': 'テ', 'TO': 'ト',
    'VA': 'バ', 'VI': 'ヴィ', 'VU': 'ブ', 'VE': 'ベ', 'VO': 'ボ',
    'WA': 'ワ', 'WI': 'ウィ', 'WU': 'ウ', 'WE': 'ウェ', 'WO': 'ウォ',
    'YA': 'ヤ', 'YI': 'イ', 'YU': 'ユ', 'YE': 'イェ', 'YO': 'ヨ',
    'ZA': 'ザ', 'ZI': 'ジ', 'ZU': 'ズ', 'ZE': 'ゼ', 'ZO': 'ゾ',
  };

  // 母音単独
  const vowels: Record<string, string> = {
    'A': 'ア', 'E': 'エ', 'I': 'イ', 'O': 'オ', 'U': 'ウ',
  };

  let result = '';
  let i = 0;
  while (i < s.length) {
    // 2文字子音+母音
    if (i + 2 <= s.length) {
      const two = s[i] + s[i+1];
      const three = i + 2 < s.length ? s[i] + s[i+1] + s[i+2] : '';
      // SH
      if (two === 'SH' && i+2 < s.length && 'AEIOU'.includes(s[i+2])) {
        const sh = 'SH' + s[i+2];
        const shMap: Record<string,string> = {'SHA':'シャ','SHI':'シ','SHU':'シュ','SHE':'シェ','SHO':'ショ'};
        if (shMap[sh]) { result += shMap[sh]; i += 3; continue; }
      }
      // CH
      if (two === 'CH' && i+2 < s.length && 'AEIOU'.includes(s[i+2])) {
        const ch = 'CH' + s[i+2];
        const chMap: Record<string,string> = {'CHA':'チャ','CHI':'チ','CHU':'チュ','CHE':'チェ','CHO':'チョ'};
        if (chMap[ch]) { result += chMap[ch]; i += 3; continue; }
      }
      // PH → F音
      if (two === 'PH') { result += 'フ'; i += 2; continue; }
      // CK → ック
      if (two === 'CK') { result += 'ック'; i += 2; continue; }
      // 末尾の不読みE（無視）
      if (s[i] === 'E' && i === s.length - 1 && result.length > 0) { i++; continue; }
    }
    // 1文字子音+母音
    if (i + 1 < s.length && 'AEIOU'.includes(s[i+1])) {
      const cv_key = s[i] + s[i+1];
      if (cv[cv_key]) { result += cv[cv_key]; i += 2; continue; }
    }
    // 母音単独
    if (vowels[s[i]]) { result += vowels[s[i]]; i++; continue; }
    // 子音単独（近似）
    const consonantMap: Record<string,string> = {
      'B':'ブ','C':'ク','D':'ド','F':'フ','G':'グ','H':'','J':'ジュ','K':'ク',
      'L':'ル','M':'ム','N':'ン','P':'プ','Q':'ク','R':'ル','S':'ス','T':'ト',
      'V':'ブ','W':'ウ','X':'クス','Y':'ィ','Z':'ズ',
    };
    if (consonantMap[s[i]] !== undefined) { result += consonantMap[s[i]]; i++; continue; }
    // 数字・記号はそのまま
    result += s[i];
    i++;
  }

  return result || word;
}

// メインの変換関数: ルアー名を英語からカタカナに変換
function convertToKatakana(name: string): string {
  // スペース・ハイフン・スラッシュ等で分割してトークンごとに変換
  // 数字と英字が混在するトークン（3XD, KVD等）はそのまま保持

  const tokens = name.split(/[\s\-\/]+/).filter(Boolean);
  const converted = tokens.map(token => {
    // 全部数字ならそのまま
    if (/^\d+$/.test(token)) return token;
    // 数字混じり（KVD1.5, 6XD, F1等）はそのまま
    if (/^[A-Za-z][0-9]/.test(token) || /^[0-9]/.test(token)) return token;
    // ドット数値（3.5など）はそのまま
    if (/^\d+(\.\d+)?(oz|g|lb)?$/i.test(token)) return token;
    // サイズ表記 (26DR, 33DR, 85F等) → そのまま or 前処理
    if (/^[A-Z]?\d+[A-Z]+$/.test(token.toUpperCase())) return token;

    const upper = token.toUpperCase();
    // 辞書に完全一致
    if (WORD_MAP[upper]) return WORD_MAP[upper];

    // 全大文字2文字以下のアルファベット = 略語→そのまま
    if (/^[A-Z]{1,3}$/.test(upper)) return token.toUpperCase();

    return romanToKatakana(token);
  });

  return converted.join('');
}

// 手動マッピング（変換精度向上のため固定値を使う）
const MANUAL_MAP: Record<string, string> = {
  // cb-one
  'C1 SEMILONG': 'C1セミロング',
  'C1 LONGLIDE': 'C1ロングライド',
  'C1': 'C1',
  'XS': 'XS',
  'Z4': 'Z4',
  'QUICK ZERO1': 'クイックゼロワン',
  'ZERO2': 'ゼロ2',
  'ZERO1': 'ゼロ1',
  'ZERO1 SEMILONG': 'ゼロ1セミロング',
  'MB1': 'MB1',
  'MB1 SEMILONG': 'MB1セミロング',
  'G2': 'G2',
  'F1': 'F1',
  'DIXON 200': 'ディクソン200',
  'ZORRO 160': 'ゾロ160',
  'BAZOO 220': 'バズー220',
  'OZMA 180': 'オズマ180',
  'RODEO 220': 'ロデオ220',
  'RYAN 130': 'ライアン130',
  'RYAN 180': 'ライアン180',
  'BRUNO 180': 'ブルーノ180',
  'OCTAGON': 'オクタゴン',
  // drt
  'DTK13': 'DTK13',
  'POLICE': 'ポリス',
  'TiNY KLASH Low': 'タイニークラッシュロー',
  'KLASH GHOST': 'クラッシュゴースト',
  'KLASH9 Hi': 'クラッシュ9ハイ',
  'KLASH9 Low': 'クラッシュ9ロー',
  'KLASH JOKER Silent': 'クラッシュジョーカーサイレント',
  'TiNY JOKER': 'タイニージョーカー',
  'Fink3.7': 'フィンク3.7',
  // mukai
  'SnaQ26DR(GSS)': 'スナック26DR(GSS)',
  'SnaQ26DR(HF)': 'スナック26DR(HF)',
  'SnaQ33DR (F)': 'スナック33DR(F)',
  'KOMAYA31(F)': 'コマヤ31(F)',
  'KOMAYA31(SS)': 'コマヤ31(SS)',
  'ZANMU　LL(F)': 'ザンムLL(F)',
  'ZANMU　LL': 'ザンムLL',
  'ZUNMU　33DR(F) Combo': 'ズンム33DR(F)コンボ',
  'ZANMU28/IDO SS': 'ザンム28/IDO SS',
  'BACKSTROKE 55S': 'バックストローク55S',
  'REN 50 F/SS': 'レン50 F/SS',
  'ZANMU 33 DR(F)': 'ザンム33DR(F)',
  'ZANMU28MR (F)': 'ザンム28MR(F)',
  'Deep Spec DR': 'ディープスペックDR',
  'ZUNMU IDO': 'ズンムIDO',
  'ZUNMU IDO　Combo': 'ズンムIDOコンボ',
  'B-BUZZ': 'ビーバズ',
  'B-CHATTER': 'ビーチャター',
  'B-BALL': 'ビーボール',
  'MUKAI NEW CRANK　KOMAYA26 F/SS': 'コマヤ26 F/SS',
  'Smash EX 26': 'スマッシュEX26',
  // attic
  'FURIFURI': 'フリフリ',
  'ARCRANK MRC': 'アークランクMRC',
  'ARCRANK SRC': 'アークランクSRC',
  'Takasu minnow 150Fuzzy': 'タカスミノー150ファジー',
  'A FLASH': 'エーフラッシュ',
  'WILD RABBIT': 'ワイルドラビット',
  'RANGE MASTER 85SW': 'レンジマスター85SW',
  'RANGE MASTER 60FW': 'レンジマスター60FW',
  'RANGE MASTER 45FW': 'レンジマスター45FW',
  'RANGE MASTER 70FW': 'レンジマスター70FW',
  'RANGE MASTER 45SW': 'レンジマスター45SW',
  'FOOTBEE9532': 'フットビー9532',
  'Poet7B': 'ポエット7B',
  'Living BGR Jr': 'リビングBGRジュニア',
  'FOOTBEE7522': 'フットビー7522',
  'G FLASH': 'ジーフラッシュ',
  'Annie175': 'アニー175',
  'Poet9 & Poet7': 'ポエット9&ポエット7',
  'Poet5/5S': 'ポエット5/5S',
  'WATER EDGE': 'ウォーターエッジ',
  'ARCRANK SLIM': 'アークランクスリム',
  'LIGHTREAL 175J': 'ライトリアル175J',
  'ARCRANK SR': 'アークランクSR',
  'SUPERFI': 'スーパーフィ',
  'ARCRANK SLIM FCE': 'アークランクスリムFCE',
  'MID Waver': 'ミッドウェーバー',
  'ARCRANK MR': 'アークランクMR',
  'MocoMoco': 'モコモコ',
  'Gecco': 'ゲッコ',
  'Water Leaf 45': 'ウォーターリーフ45',
  'Waterleaf 65': 'ウォーターリーフ65',
  // hots
  'Bigfin': 'ビッグフィン',
  'KALCHI SUPER LONG JIG': 'カルチスーパーロングジグ',
  'KEITAN JIG': 'ケイタンジグ',
  'SLASH BLADE': 'スラッシュブレード',
  'DEBUTAN JIG': 'デビュータンジグ',
  'KEITAN JIG Aluminum': 'ケイタンジグアルミニウム',
  'KEITAN JIG STD.': 'ケイタンジグSTD',
  'KS JIG': 'KSジグ',
  'Y2 JIG': 'Y2ジグ',
  'KEIKO OCEAN POPPER Rv.': 'ケイコオーシャンポッパーRv.',
  'KEIKO OCEAN BULL': 'ケイコオーシャンブル',
  'NS JIG': 'NSジグ',
  'Drift tune': 'ドリフトチューン',
  'CHIBITAN': 'チビタン',
  'Skill Gamma': 'スキルガンマ',
  'KEIKO OCEAN GATARO': 'ケイコオーシャンガタロ',
  'KEIKO OCEAN CHUGAYU': 'ケイコオーシャンチャガユ',
  'KEIKO OCEAN': 'ケイコオーシャン',
  'Chug & MiniChag': 'チャグ&ミニチャグ',
  'R2 JIG': 'R2ジグ',
  'Conker': 'コンカー',
  'IGOSSO': 'イゴッソ',
  'Tide Bait.Sardine': 'タイドベイト サーディン',
  // forest
  'FIX Impact': 'フィックスインパクト',
  'FIX Match': 'フィックスマッチ',
  'FRONT LAKE 4g 12g': 'フロントレイク4g 12g',
  'FRONT LAKE 6.8g': 'フロントレイク6.8g',
  'i Fish AT': 'アイフィッシュAT',
  'i Fish FT': 'アイフィッシュFT',
  'CLOSER': 'クローザー',
  'MIU 1.5g 3.5g': 'ミュー1.5g 3.5g',
  'MIU 1.4g': 'ミュー1.4g',
  'MIU 2.8g': 'ミュー2.8g',
  'MARSHAL': 'マーシャル',
  'MARSHAL Tournament': 'マーシャルトーナメント',
  'Realize': 'リアライズ',
  'Factor': 'ファクター',
  'TROUSION': 'トラウジョン',
  'PAL': 'パル',
  'PAL Limited 2025': 'パルリミテッド2025',
  'iFish FT 5S EXcolor': 'アイフィッシュFT 5S EXカラー',
  'i Fish FT 90S': 'アイフィッシュFT 90S',
  'Chaser': 'チェイサー',
  // ja-do
  'ERDA GARURU 132F': 'エルダガルル132F',
  'ERDA TEUFEL 125F': 'エルダテウフェル125F',
  'ERDA86': 'エルダ86',
  'Envy 125': 'エンビー125',
  'Yore Yore': 'ヨーレヨーレ',
  'Envy 95': 'エンビー95',
  'Envy 105': 'エンビー105',
  // mc-works
  'GUTTER JIG SLIM': 'ガッタージグスリム',
  'GUTTER JIG SUPER SLICE (NEW)': 'ガッタージグスーパースライス(NEW)',
  'GUTTER JIG REGULER': 'ガッタージグレギュラー',
  'GUTTER JIG FAT': 'ガッタージグファット',
  'BUNCHIN1.2': 'ブンチン1.2',
  'BUNCHIN1.0': 'ブンチン1.0',
  'GUTUP': 'ガットアップ',
  'GRAVEL': 'グラベル',
  // hmkl
  'ALIVE BAIT S': 'アライブベイトS',
  'K-I MINNOW 50 SS': 'K-Iミノー50SS',
  'K-I MINNOW 85F BONE': 'K-Iミノー85Fボーン',
  'HMKL Jordan 65 S': 'HMKLジョーダン65S',
  'K-0 WAKEMINNOW 115 SALT WATER Ver.': 'K-0ウェイクミノー115ソルトウォーターバージョン',
  // nature-boys
  'NEW ROCKRIDER': 'ニューロックライダー',
  'SPINRIDERDEEP': 'スピンライダーディープ',
  'TINY ROBBER': 'タイニーロバー',
  'DEEPROBBER': 'ディープロバー',
  'SwimBird': 'スイムバード',
  'CURRENTRIDER': 'カレントライダー',
  'SpinRider': 'スピンライダー',
  'NEW SUSRIDER': 'ニューサスライダー',
  'SWANGER': 'スワンガー',
  'SlowRider': 'スローライダー',
  'PELICAN220F': 'ペリカン220F',
  // north-craft
  'AOG(AIR OGRE) AOG70SLM': 'エアオーガ70SLM',
  'AOG(AIR OGRE) AOG85SLM': 'エアオーガ85SLM',
  'AOG(AIR OGRE) AOG120SLM': 'エアオーガ120SLM',
  // baitbreath
  'T.T.SHAD': 'T.T.シャッド',
  'Bait Breath BJ-BUG': 'ベイトブレスBJバグ',
  'Bait Breath U30 FLAT PIN TAIL4.5inch for BASS': 'ベイトブレスU30フラットピンテール4.5インチフォーバス',
  // carpenter
  'Metal Jig 1510': 'メタルジグ1510',
  'Gamma': 'ガンマ',
  'Gamma Super-L': 'ガンマスーパーL',
  'Gamma-L': 'ガンマL',
  'Gamma-H': 'ガンマH',
  'Strike Eagle': 'ストライクイーグル',
  'Blue Fish': 'ブルーフィッシュ',
  'Maihime': 'マイヒメ',
  'Gen-ei': 'ゲンエイ',
  'Carpenter Hayabusa': 'カーペンターハヤブサ',
  'Mini Eel': 'ミニイール',
  'Utahime': 'ウタヒメ',
  // crazy-ocean
  'S-GLIDE': 'Sグライド',
  // d-claw
  'Beacon NEO 200': 'ビーコンNEO200',
  'SWIMMING PENCIL D\'abs230': 'スイミングペンシルダブス230',
  'MARINO250 SLIM': 'マリーノ250スリム',
  'MARINO300 SLIM': 'マリーノ300スリム',
  'MARINO200 SLIM': 'マリーノ200スリム',
  'MARINO280 MESSAMAGNUM': 'マリーノ280メッサマグナム',
  'MARINO230 MAGNUM': 'マリーノ230マグナム',
  'MARINO210': 'マリーノ210',
  'MARINO180': 'マリーノ180',
  'Bubbles215': 'バブルズ215',
  'Bubbles190': 'バブルズ190',
  'Bubbles160': 'バブルズ160',
  'Beacon210': 'ビーコン210',
  'Beacon180': 'ビーコン180',
  'Beacon180 HIRAMASA TUNE': 'ビーコン180ヒラマサチューン',
  'Beacon140': 'ビーコン140',
  'Beacon120': 'ビーコン120',
};

async function main() {
  let all: any[] = [], offset = 0;
  while(true) {
    const { data } = await sb.from('lures').select('slug,manufacturer_slug,name,name_kana').range(offset, offset+999);
    if (!data?.length) break;
    all.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }

  const seen = new Map<string,any>();
  for (const r of all) {
    const k = `${r.manufacturer_slug}/${r.slug}`;
    if (!seen.has(k)) seen.set(k, r);
  }

  // 英語名でname_kana未設定のもの
  const targets = [...seen.values()].filter(r =>
    !r.name_kana && r.name && /^[a-zA-Z0-9\s\-\/\.\(\)\'&]+$/.test(r.name)
  );

  console.log(`対象: ${targets.length}件`);

  // カタカナ変換
  const results: Array<{manufacturer_slug: string, slug: string, name: string, kana: string}> = [];
  for (const r of targets) {
    const kana = MANUAL_MAP[r.name] ?? convertToKatakana(r.name);
    results.push({ manufacturer_slug: r.manufacturer_slug, slug: r.slug, name: r.name, kana });
  }

  // サンプル表示
  console.log('\n変換サンプル（最初の10件）:');
  results.slice(0, 10).forEach(r => {
    console.log(`  "${r.name}" → "${r.kana}" (${r.manufacturer_slug})`);
  });

  // DB更新（50件バッチ）
  const BATCH = 50;
  let updated = 0;
  for (let i = 0; i < results.length; i += BATCH) {
    const batch = results.slice(i, i + BATCH);
    for (const r of batch) {
      const { error } = await sb.from('lures')
        .update({ name_kana: r.kana })
        .eq('manufacturer_slug', r.manufacturer_slug)
        .eq('slug', r.slug);
      if (error) {
        console.error(`ERROR: ${r.manufacturer_slug}/${r.slug}:`, error.message);
      } else {
        updated++;
      }
    }
    console.log(`進捗: ${Math.min(i + BATCH, results.length)}/${results.length}`);
  }

  console.log(`\n完了: ${updated}件更新`);
}
main();
