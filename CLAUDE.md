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

## 新メーカー追加時のルール

**メーカー追加を指示されたら、Runbookの「新メーカー追加 完全チェックリスト」に従え。**
完了条件7項目をすべて満たすまで「完了」と報告するな:
1. スクレイパーが動く（テスト済み）
2. 全商品がSupabaseに登録されている（未処理0、エラー0）
3. discover-products.ts に追加済み（--dry-run で新規0件）
4. Runbookが更新されている
5. Obsidianが更新されている
6. Gitコミット済み（working tree clean）
7. テスト用スクリプトが _deprecated/ に移動済み
