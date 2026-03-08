/**
 * CAST/LOG 統一slug生成関数
 *
 * 全slugは `lowercase-alphanumeric-dash` 形式。
 * カタカナ・ひらがな → ローマ字変換（wanakana使用）。
 * 漢字は除去。
 *
 * ルール:
 * - [a-z0-9-] のみ許容
 * - アンダースコア禁止（ハイフンに変換）
 * - 大文字禁止（小文字に変換）
 * - 日本語文字禁止（ローマ字に変換）
 * - URLエンコード禁止（デコードして再正規化）
 * - 最大80文字
 */
import { toRomaji, isKana } from 'wanakana';

/**
 * 日本語テキストをローマ字に変換
 * カタカナ・ひらがな → romaji、漢字 → 除去（ハイフン）
 */
function romanize(text: string): string {
  let result = '';
  let kanaBuffer = '';
  let hadKana = false;

  for (const char of text) {
    if (isKana(char)) {
      kanaBuffer += char;
      hadKana = true;
    } else {
      if (kanaBuffer) {
        const romaji = toRomaji(kanaBuffer);
        const isAlphaNum = /[a-zA-Z0-9]/.test(char);
        result += romaji + (isAlphaNum ? '-' : '');
        kanaBuffer = '';
      }
      const code = char.charCodeAt(0);
      if (code >= 0x4E00 && code <= 0x9FFF) {
        result += '-';
      } else {
        result += char;
      }
    }
  }
  if (kanaBuffer) {
    result += toRomaji(kanaBuffer);
  }

  // 長音の簡略化（カナ文字が含まれていた場合のみ適用）
  // 英語テキスト（Tour, Spoon, Voodoo 等）を誤変換しないため
  if (hadKana) {
    result = result
      .replace(/oo/g, 'o')
      .replace(/aa/g, 'a')
      .replace(/uu/g, 'u')
      .replace(/ii/g, 'i')
      .replace(/ee/g, 'e')
      .replace(/ou/g, 'o');
  }

  return result;
}

/**
 * テキストからURL用slugを生成
 *
 * @example
 * slugify("レンジバイブ 45ES") // → "renjibaibu-45es"
 * slugify("S.P.M. 65") // → "s-p-m-65"
 * slugify("Sugar_Deep_70F") // → "sugar-deep-70f"
 */
export function slugify(name: string): string {
  // 全角→半角変換（英数字）
  let s = name.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );

  // Unicode記号の置換
  s = s
    .replace(/[Ⅱ]/g, '2')
    .replace(/[Ⅲ]/g, '3')
    .replace(/[Ⅳ]/g, '4')
    .replace(/[×✕]/g, 'x')
    .replace(/[・•]/g, '-')
    .replace(/[＃#]/g, '')
    .replace(/[！!？?]/g, '')
    .replace(/['＇'']/g, '')
    .replace(/[＆&]/g, 'and')
    .replace(/[＋+]/g, 'plus')
    .replace(/[／/]/g, '-')
    .replace(/[（(）)]/g, '')
    .replace(/[【】\[\]]/g, '')
    .replace(/[　\s]+/g, '-');

  // カタカナ・ひらがな→ローマ字
  s = romanize(s);

  // 小文字化
  s = s.toLowerCase();

  // 残った非ASCII除去
  s = s.replace(/[^\x20-\x7E]/g, '');

  // 英数字とハイフンのみ
  s = s.replace(/[^a-z0-9-]/g, '-');

  // クリーンアップ
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');

  // 最大80文字
  return s.substring(0, 80);
}

/**
 * slugをデコード（後方互換）
 */
export function deslugify(slug: string): string {
  return decodeURIComponent(slug);
}
