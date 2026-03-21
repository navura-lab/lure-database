/**
 * 記事翻訳キャッシュ（英語版）
 *
 * 23バッチファイルから統合。173記事の英語翻訳。
 * slug → 翻訳済みフィールドのマップ。
 *
 * 未翻訳の記事は英語版ページが生成されない。
 */

export interface TranslatedArticle {
  slug: string;
  title: string;
  h1: string;
  description: string;
  lead: string;
  sections: {
    heading: string;
    body: string;
    comparisonTable?: {
      headers: string[];
      rows: string[][];
      criteria: string;
    };
  }[];
  faq: { question: string; answer: string }[];
}

import { batch1 } from './_batch-1';
import { batch2 } from './_batch-2';
import { batch3 } from './_batch-3';
import { batch4 } from './_batch-4';
import { batch5 } from './_batch-5';
import { batch6 } from './_batch-6';
import { batch7 } from './_batch-7';
import { batch8 } from './_batch-8';
import { batch9a } from './_batch-9a';
import { batch9b } from './_batch-9b';
import { batch9c } from './_batch-9c';
import { batch9d } from './_batch-9d';
import { batch10a } from './_batch-10a';
import { batch10b } from './_batch-10b';
import { batch10c } from './_batch-10c';
import { batch10d } from './_batch-10d';
import { batch10e } from './_batch-10e';
import { batch10f } from './_batch-10f';
import { batch10g } from './_batch-10g';
import { batch10h } from './_batch-10h';
import { batch10i } from './_batch-10i';
import { batch10j } from './_batch-10j';
import { batch11 } from './_batch-11';
import { batch12 } from './_batch-12';

/**
 * 翻訳済み記事マップ（slug → TranslatedArticle）
 * 178記事の英語翻訳
 */
export const articleTranslationsEn: Record<string, TranslatedArticle> = {
  ...batch1,
  ...batch2,
  ...batch3,
  ...batch4,
  ...batch5,
  ...batch6,
  ...batch7,
  ...batch8,
  ...batch9a,
  ...batch9b,
  ...batch9c,
  ...batch9d,
  ...batch10a,
  ...batch10b,
  ...batch10c,
  ...batch10d,
  ...batch10e,
  ...batch10f,
  ...batch10g,
  ...batch10h,
  ...batch10i,
  ...batch10j,
  ...batch11,
  ...batch12,
};
