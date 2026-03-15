/**
 * 記事翻訳キャッシュ（英語版）
 *
 * 8バッチファイルから統合。88記事の英語翻訳。
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

/**
 * 翻訳済み記事マップ（slug → TranslatedArticle）
 * 88記事の英語翻訳
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
};
