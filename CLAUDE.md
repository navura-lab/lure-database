# Lure Database - Claude Code 指示書

## プロジェクト概要
Astro + Supabase + Tailwind CSS のルアー（釣り用品）データベースサイト。
Vercelにデプロイ。SSG（Static Site Generation）。

## 技術スタック
- Astro (SSG)
- Supabase (PostgreSQL)
- Tailwind CSS v4 (@tailwindcss/vite)
- TypeScript

## Supabase接続情報
`.env` に `PUBLIC_SUPABASE_URL` と `PUBLIC_SUPABASE_ANON_KEY` あり。
Supabase JS Client は `src/lib/supabase.ts`。

## 現在の構造
- DB: `lures` テーブル。1行 = 1ルアー × 1カラー × 1ウェイト
- URL: `/lure/[slug]` （slugはクライアントサイドでslugify(name)で生成）
- グルーピング: `src/lib/group-lures.ts` で name ごとに集約

## コマンド
- `npm run dev` — 開発サーバー (localhost:4321)
- `npm run build` — ビルド
- `npx tsx scripts/pipeline.ts --limit 1` — パイプライン（1件処理）
- `npx tsx scripts/pipeline.ts --limit 0` — パイプライン（全件処理）
- `npx tsx scripts/discover-products.ts --dry-run` — 新商品検知（テスト）
- `npx tsx scripts/discover-products.ts --maker {slug} --dry-run` — 特定メーカーのみ

## 必読ドキュメント

**作業前に必ず読め:**
- **Runbook**: `/Users/user/clawd/references/lure-db-runbook.md`
  - プロジェクト全体の手順、ルール、トラブルシュート
  - **新メーカー追加チェックリスト**（Phase 1〜6 + 完了条件7項目）
- **Obsidian設計書**: `ルアーDB 自動更新システム設計.md`
  - アーキテクチャ、スキーマ、改善履歴、作業ログ

## 説明文リライト手順（SEO対策）

**「リライトして」「説明文を書き直して」等の指示を受けたら以下を実行する。**

パイプラインはメーカー公式の説明文をそのままDBに保存する。
リライトはClaude Codeセッション内でSonnetサブエージェントを使い、無料で実行する。

### 手順

1. **リライト対象を取得**: Supabaseから未リライト or 指定メーカーの説明文を取得
   ```bash
   # 例: DAIWAの未リライト商品（description が長文=元テキストの可能性大）
   npx tsx -e "
     import 'dotenv/config';
     import { createClient } from '@supabase/supabase-js';
     const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
     const {data} = await sb.from('lures').select('slug,name,description').eq('manufacturer_slug','daiwa').gt('description','').limit(10);
     // slug単位で重複排除
     const unique = [...new Map(data!.map(r=>[r.slug,[r.slug,r.name,r.description]])).values()];
     console.log(JSON.stringify(unique));
   "
   ```

2. **バッチ分割**: 10件ずつのJSONファイルに分割して `/tmp/` に保存

3. **Sonnetサブエージェントで並列リライト**: Task tool で `model: "sonnet"` を指定
   - リライトルール:
     - 釣り人目線、臨場感のある常体（だ・である調）
     - 150〜250文字
     - メーカー説明の核心的な情報を維持
     - SEOキーワード（ルアー種別、対象魚、釣り方）を自然に含める
     - 「このルアーは〜」等の説明調は禁止
     - 絵文字は使わない

4. **Supabaseに書き戻し**: slug + manufacturer_slug でマッチして description を更新

5. **バックアップ**: リライト結果を `scripts/_xxx-rewritten-all.json` に保存

### 過去の実績

- DAIWA全367商品: 2026-02-20にSonnet×7並列で完了（平均145文字、エラー0件）

## 新メーカー追加時のルール

**メーカー追加を指示されたら、Runbookの「新メーカー追加 完全チェックリスト」に従え。**
完了条件9項目をすべて満たすまで「完了」と報告するな:
1. スクレイパーが動く（テスト済み）
2. 全商品がSupabaseに登録されている（未処理0、エラー0）
3. discover-products.ts に追加済み（--dry-run で新規0件）
4. Runbookが更新されている
5. Obsidianが更新されている
6. Gitコミット済み（working tree clean）
7. テスト用スクリプトが _deprecated/ に移動済み
8. **`git push origin main` 済み（⚠️ pushしないとサイトに反映されない）**
9. **サイトに新メーカーの商品が表示されている（デプロイ反映確認）**
