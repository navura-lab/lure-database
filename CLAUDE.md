# CAST/LOG - Claude Code 指示書

## プロジェクト概要
**CAST/LOG** — Astro + Supabase + Tailwind CSS のルアーデータベースサイト。
Vercelにデプロイ。SSG（Static Site Generation）。
- 表示名: CAST/LOG（スラッシュは常にAccent Green）
- テキスト/URL: castlog（小文字、スラッシュなし）
- ドメイン: lure-db.com
- タグライン JP: 一投を、資産にする。
- タグライン EN: Cast it. Log it. Prove it.

## デザインシステム (CAST/LOG)

### カラー（CSS変数必須、ハードコード禁止）
- accent: #00C78A（使用面積≤5%: ロゴスラッシュ、CTA、セクションラベル、ホバーボーダー）
- bg: #FFFFFF / surface: #F7F7F7 / border: #E0E0E0
- text: #1A1A1A / text-mid: #555555 / text-dim: #999999 / text-faint: #CCCCCC
- 詳細: Obsidian `10_プロジェクト/CASTLOG/color-system.md`

### フォント
- **Mono** (JetBrains Mono): 数値、日付、セクションラベル、ブランド名、ボタン、メタデータ、ナビリンク
- **Sans** (Noto Sans JP): 本文、説明文、見出し（日本語）

### スペーシング
- 8pxグリッド必須（許容値: 4/8/12/16/24/32/48/64/80px）
- 詳細: Obsidian `10_プロジェクト/CASTLOG/spacing-and-layout.md`

### コンポーネント規定
- border-radius: カード8px、ボタン4px、アバターのみ50%
- hover: 全て0.15s ease、scale max 1.01
- shadow: `0 4px 24px rgba(0,0,0,0.06)`、ナビはborder-bottomのみ（shadow禁止）

### 禁止事項
- グラデーション、rgba新色、font-weight<400、border-radius:50%（アバター以外）
- hover>0.3s、!important（reset除く）、8pxグリッド違反、ハードコードカラー
- 禁止ワード: 爆釣、激アツ、マスト、ヤバい、間違いなし、神ルアー

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
- DAIWA以外全92メーカー1,404商品: 2026-03-03にSonnet×7並列×4ラウンドで完了

## ⚠️ リライト必須ルール（2026-03-03〜）

**パイプライン実行後、リライトなしでのデプロイは禁止。**

### ルール
1. パイプラインで新商品をSupabaseに登録した後、**必ず説明文リライトを実施してからデプロイする**
2. description が250文字を超える商品 = 未リライト。0件でなければデプロイ不可
3. リライトはClaude Codeセッション内でSonnetサブエージェントを使い実行する
4. リライト結果は `scripts/_rewritten-all-YYYY-MM-DD.json` にバックアップする

### パイプライン実行後の手順
```
1. npx tsx scripts/pipeline.ts --limit N  （スクレイプ＆DB登録）
2. 説明文リライト実行（Sonnetサブエージェント並列）
3. npx tsx scripts/_write-rewritten-to-supabase.ts  （DB書き戻し）
4. git push origin main  （デプロイ）
```

### 新メーカー追加時
新メーカー追加チェックリストの完了条件に以下を追加:
- **全商品の説明文がリライト済み（description 250文字以下）**

## 新メーカー追加時のルール

**メーカー追加を指示されたら、Runbookの「新メーカー追加 完全チェックリスト」に従え。**
完了条件11項目をすべて満たすまで「完了」と報告するな:
1. スクレイパーが動く（テスト済み）
2. **⚠️ ScraperFunction をexportし、`scripts/scrapers/index.ts` の SCRAPER_REGISTRY に登録済み（スタンドアロン禁止）**
3. 全商品がSupabaseに登録されている（未処理0、エラー0）
4. discover-products.ts に追加済み（--dry-run で新規0件）
5. **`npx tsx scripts/check-pipeline-coverage.ts` でカバレッジ100%（差分0件）**
6. Runbookが更新されている
7. **⚠️ Obsidianが更新されている（過去に何度も忘れている。Phase 5で必ずやれ。Phase 6でも再確認せよ）**
   - 対象: `/Users/user/clawd/obsidian/10_プロジェクト/ルアーDB 自動更新システム設計.md`
   - 方法: `cat > "..." << 'OBSIDIAN_EOF' ... OBSIDIAN_EOF`（execで書き込み）
   - 確認: `head -3 "..."` で最終更新日が今日+今回のメーカー名であること
8. Gitコミット済み（working tree clean）
9. テスト用スクリプトが _deprecated/ に移動済み
10. **`git push origin main` 済み（⚠️ pushしないとサイトに反映されない）**
11. **サイトに新メーカーの商品が表示されている（デプロイ反映確認）**
