/**
 * エディトリアル生成バッチファイルを作成
 * /tmp/editorial-targets.json から 10バッチ×20件 = 200件分
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const targets = JSON.parse(readFileSync('/tmp/editorial-targets.json', 'utf-8'));
const BATCH_SIZE = 20;
const MAX_BATCHES = 10;

// バッチ分割
const batches: any[][] = [];
for (let i = 0; i < Math.min(targets.length, BATCH_SIZE * MAX_BATCHES); i += BATCH_SIZE) {
  batches.push(targets.slice(i, i + BATCH_SIZE));
}

mkdirSync('/tmp/editorial-batches', { recursive: true });

// 各バッチのデータとプロンプトを生成
for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  
  // データファイル
  writeFileSync(`/tmp/editorial-batches/batch-${i+1}.json`, JSON.stringify(batch, null, 2));
  
  // プロンプトファイル
  const lureList = batch.map(r => {
    const colorCount = '(複数カラーあり)'; // DBクエリ省略
    return `
### ${r.name}（${r.manufacturer_slug}）
- slug: ${r.slug}
- type: ${r.type || '不明'}
- target_fish: ${JSON.stringify(r.target_fish || [])}
- weight: ${r.weight ? r.weight + 'g' : '不明'}
- price: ${r.price ? '¥' + r.price : '不明'}
- description: ${r.description || '(なし)'}
`;
  }).join('');

  const prompt = `# エディトリアル生成タスク

以下の${batch.length}件のルアーについて、それぞれエディトリアルレビューのTypeScriptファイルを生成し、直接ファイルに書き込んでください。

## 出力先
各ルアーごとに \`src/data/seo/editorials/{slug}.ts\` に書き込んでください。
（プロジェクトroot: /Users/user/ウェブサイト/lure-database/）

## ファイルフォーマット
以下のフォーマットに必ず従ってください:

\`\`\`typescript
/**
 * {商品名}（{メーカー名}）エディトリアルレビュー
 * 生成日: 2026-03-29
 */

import type { EditorialReview } from './huggos';

export const {camelCaseVariableName}Editorial: EditorialReview = {
  slug: '{slug}',
  manufacturerSlug: '{manufacturer_slug}',

  catchcopy: '一文のキャッチコピー（40〜60文字）',

  overview: \`概要（2〜3段落、合計150〜300文字）\`,

  strengths: [
    { title: '強み1タイトル', body: '強み1の説明（60〜100文字）' },
    { title: '強み2タイトル', body: '強み2の説明（60〜100文字）' },
    { title: '強み3タイトル', body: '強み3の説明（60〜100文字）' },
  ],

  usage: [
    { scene: '使用シーン1', body: '使い方説明（60〜100文字）' },
    { scene: '使用シーン2', body: '使い方説明（60〜100文字）' },
  ],

  colorGuide: 'カラー選択ガイド（60〜120文字）',

  concerns: [
    '気になるポイント1（30〜60文字）',
    '気になるポイント2（30〜60文字）',
  ],

  recommendation: {
    recommended: ['こんな人におすすめ1', 'こんな人におすすめ2'],
    notRecommended: ['こんな人には不向き1'],
  },

  faq: [
    { q: '質問1', a: '回答1（50〜80文字）' },
    { q: '質問2', a: '回答2（50〜80文字）' },
  ],
};
\`\`\`

## 禁止事項
- 根拠のない「最強」「神ルアー」「間違いなし」「マスト」等の表現
- DBにないスペック情報の捏造
- 「おすすめランキング」形式での評価
- 250文字を超えるoverview段落

## ルアーデータ
${lureList}

## 作業手順
1. 各ルアーのデータを確認
2. EditorialReviewフォーマットでコンテンツを生成
3. Writeツールで \`src/data/seo/editorials/{slug}.ts\` に直接書き込む
4. 全${batch.length}件完了したら完了報告

必ずWriteツールを使って全${batch.length}件のファイルを書き込んでください。
`;

  writeFileSync(`/tmp/editorial-batches/prompt-${i+1}.md`, prompt);
  console.log(`バッチ${i+1}: ${batch.length}件 → /tmp/editorial-batches/batch-${i+1}.json`);
}

console.log(`合計 ${batches.length} バッチ作成完了`);
