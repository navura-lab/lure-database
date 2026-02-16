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
