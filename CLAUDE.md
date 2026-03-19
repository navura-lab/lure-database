# CAST/LOG - Claude Code 指示書

## プロジェクト概要
**CAST/LOG** — Astro + Supabase + Tailwind CSS のルアーデータベースサイト。
Vercelにデプロイ。SSG（Static Site Generation）。
- 表示名: CAST/LOG（スラッシュは常にAccent Green）
- テキスト/URL: castlog（小文字、スラッシュなし）
- ドメイン: castlog.xyz（旧: lure-db.com、2026/09/13まで301リダイレクト維持）
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

## ⚠️ 根拠のないコンテンツ禁止（2026-03-06〜）

**実データに基づかないランキング・おすすめ・評価コンテンツの生成は絶対禁止。**

### ルール
1. 「おすすめ」「ランキング」「TOP N」「人気」等の順位付けは、実データ（売上、レビュー、専門家評価）がない限り生成しない
2. DBのカラー数・バリエーション数でのスコアリングは「ランキング」として出すな（カタログ一覧としてなら可）
3. 権威的な文体（「〜が最強」「間違いなく〜」）で根拠なしのコンテンツを書くな
4. ユーザーに「これは根拠あるか？」と聞かれて「ある」と答えられないコンテンツは作るな
5. 既存の根拠なしコンテンツを発見したら、ユーザーに報告せよ

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
- URL: `/{manufacturer_slug}/{slug}/`
- グルーピング: `src/lib/group-lures.ts` で slug ごとに集約

## ⚠️ slug正規化ルール（2026-03-06〜）

**全slugは `lowercase-alphanumeric-dash` 形式。違反slugのデプロイは禁止。**

### フォーマット
- 許容文字: `[a-z0-9-]` のみ
- アンダースコア `_` 禁止（ハイフン `-` に変換）
- 大文字禁止（小文字に変換）
- 日本語文字禁止（ローマ字に変換）
- URLエンコード `%XX` 禁止（デコードして再正規化）
- 最大80文字
- 純粋数値slug禁止（商品名ベースにする）

### 正規関数
- `src/lib/slugify.ts` の `slugify()` が正規のslug生成関数
- 新規スクレイパーは必ずこの関数を使え
- wanakana でカタカナ・ひらがな→ローマ字変換

### パイプライン実行後の確認
```bash
# 違反slugの検出
npx tsx -e "
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const {data} = await sb.from('lures').select('manufacturer_slug, slug').order('manufacturer_slug');
const seen = new Map();
for (const r of data!) { const k = r.manufacturer_slug+'/'+r.slug; if (!seen.has(k)) seen.set(k,r); }
const bad = [...seen.values()].filter(r => /[^a-z0-9-]/.test(r.slug) || /^\d+$/.test(r.slug));
console.log('違反slug:', bad.length);
bad.slice(0,10).forEach(r => console.log(' ', r.manufacturer_slug+'/'+r.slug));
"
```
違反が0件でなければ `npx tsx scripts/_normalize-slugs.ts` で修正

## コマンド
- `npm run dev` — 開発サーバー (localhost:4321)
- `npm run build` — ビルド
- `npx tsx scripts/pipeline.ts --region jp --limit 1` — JPパイプライン（1件）
- `npx tsx scripts/pipeline.ts --region us --limit 0` — USパイプライン（全件）
- `npx tsx scripts/pipeline.ts --limit 1` — 全リージョン（後方互換）
- `npx tsx scripts/discover-products.ts --region us --dry-run` — US新商品検知（テスト）
- `npx tsx scripts/discover-products.ts --region jp --dry-run` — JP新商品検知（テスト）
- `npx tsx scripts/discover-products.ts --maker {slug} --dry-run` — 特定メーカーのみ
- `npx tsx scripts/us-post-pipeline.ts` — US後処理状態チェック
- `npx tsx scripts/rewrite-descriptions.ts --check` — 英語説明文チェック
- `npx tsx scripts/rewrite-descriptions.ts --apply` — リライト結果をDB書き込み

## SEO自動化システム（2026-03-07〜）

### 自動実行スケジュール（launchd）

**パイプライン・新商品検知（JP/US分離: 2026-03-08〜）**
| ジョブ | スケジュール | スクリプト | 内容 |
|--------|------------|-----------|------|
| discover-us | 毎日 5:00 JST | `run-discover-us.sh` | US新商品検知（fetch-only, 30秒） |
| discover-jp | 毎週月曜 6:00 JST | `run-discover-jp.sh` | JP新商品検知（Playwright使用） |
| pipeline-jp | 毎時 0:00-7:00 JST | `run-pipeline-jp.sh` | JPスクレイプ&DB登録（毎時1件×8回） |
| pipeline-us | 毎日 8:00 JST | `run-pipeline-us.sh` | USスクレイプ&DB登録（全件一括） |

**SEO自動化**
| ジョブ | スケジュール | スクリプト | 内容 |
|--------|------------|-----------|------|
| SEO日次監視 | 毎日 7:00 JST | `seo-monitor.ts` | GSCデータ収集、週次比較、ページ種別分析、アラート |
| Indexing API送信 | 毎日 8:00 JST | `daily-indexing.ts` | 200件/日ずつ全ページのインデックス登録を自動送信 |
| 週次レポート | 毎週月曜 9:00 JST | `weekly-seo-report.ts` | PDCA分析、クエリ成長/衰退、推奨アクション生成 |
| SEO機会発見 | 毎週月曜 10:00 JST | `seo-opportunity-finder.ts` | GSCデータからSEO改善機会を自動抽出 |
| ランク追跡 | 毎日 7:30 JST | `seo-rank-tracker.ts` | 全ページ×クエリの順位・機会スコア日次追跡 |

### SEO・データ収集スクリプト一覧
| スクリプト | 用途 | 実行方法 |
|-----------|------|---------|
| `scripts/seo-monitor.ts` | 日次SEO監視（v2: ページ種別、週次比較、デバイス別） | `npx tsx scripts/seo-monitor.ts [--inspect] [--verbose]` |
| `scripts/daily-indexing.ts` | Indexing API自動送信（200件/日、進捗追跡） | `npx tsx scripts/daily-indexing.ts [--dry-run]` |
| `scripts/weekly-seo-report.ts` | 週次PDCAレポート（Markdown + JSON + Slack） | `npx tsx scripts/weekly-seo-report.ts [--verbose]` |
| `scripts/request-indexing.ts` | 手動Indexing API（4モード） | `npx tsx scripts/request-indexing.ts [--submit]` |
| `scripts/seo-opportunity-finder.ts` | GSCデータからSEO改善機会を抽出 | `npx tsx scripts/seo-opportunity-finder.ts` |
| `scripts/youtube-collector.ts` | YouTube動画収集（5件/ルアー、SEOスコア順） | `npx tsx scripts/youtube-collector.ts [--limit N] [--verbose]` |
| `scripts/blog-impression-collector.ts` | ブログインプレ記事収集（Serper.dev経由） | `npx tsx scripts/blog-impression-collector.ts [--limit N] [--verbose]` |
| `scripts/seo-rank-tracker.ts` | 日次ページ×クエリランキング追跡 | `npx tsx scripts/seo-rank-tracker.ts [--verbose] [--report]` |
| `scripts/seo-competitor-analyzer.ts` | SERP競合構造分析（Serper.dev経由） | `npx tsx scripts/seo-competitor-analyzer.ts [--page PATH] [--query Q] [--limit N]` |
| `scripts/seo-content-optimizer.ts` | AI駆動title/description最適化 | `npx tsx scripts/seo-content-optimizer.ts [--page PATH] [--apply] [--dry-run]` |

### データ保存先
- 日次データ: `logs/seo-data/YYYY-MM-DD.json`
- 週次レポート: `logs/seo-reports/weekly-YYYY-MM-DD.md` + `.json`
- SEO機会分析: `logs/seo-data/opportunities-YYYY-MM-DD.json` + `.md`
- インデックス進捗: `logs/seo-data/indexing-progress.json`
- YouTube動画: `logs/youtube-data/youtube-YYYY-MM-DD.json`
- インプレ記事: `logs/impression-data/impressions-YYYY-MM-DD.json`
- ランキング追跡: `logs/seo-data/rankings/YYYY-MM-DD.json` + `trends.json` + `report-*.md`
- 競合分析: `logs/seo-data/competitors/YYYY-MM-DD.json` + `.md`
- コンテンツ最適化: `logs/seo-data/optimizations/YYYY-MM-DD.json` + `.md`
- launchdログ: `logs/launchd-*.log`

### API資格情報（.envに全て保存済み）
| API | 環境変数 | クォータ | 状態 |
|-----|---------|---------|------|
| YouTube Data API v3 | `YOUTUBE_API_KEY` | 10,000ユニット/日（~95ルアー） | ✅ 動作確認済み |
| Serper.dev | `SERPER_API_KEY` | 2,500クエリ/月（無料枠） | ✅ 動作確認済み |
| もしもアフィリエイト | `MOSHIMO_AFFILIATE_ID=1182938` | - | ✅ 楽天提携済み、Amazon審査待ち |

### launchd plist
全11ジョブ: `~/Library/LaunchAgents/com.fablus.lure-*.plist`
全パス: `/Users/user/ウェブサイト/lure-database/` に統一済み
旧 `pipeline.plist` / `discover.plist` はunload済み（ファイルは残存、後方互換用）

### JP/US パイプライン分離（2026-03-08〜）

**USメーカーリスト**: `scripts/lib/regions.ts` で一元管理（strike-king, z-man, zoom, 6th-sense, berkley-us, livetarget, lunkerhunt, missile-baits, spro, googan-baits, lunker-city, riot-baits, xzone-lures = 13社）
- `--region jp|us|all` で分岐（all = 後方互換、デフォルト）
- US discover: fetch-only（Playwright不要、30秒完了）
- US pipeline完了後の手動処理: `npx tsx scripts/us-post-pipeline.ts` で状態確認

**US後処理フロー（Claude Codeセッション）:**
```
$ npx tsx scripts/us-post-pipeline.ts    ← 状態確認
→ 「要リライト」なら:
  $ npx tsx scripts/rewrite-descriptions.ts
  → Sonnet並列リライト
  $ npx tsx scripts/rewrite-descriptions.ts --apply
→ 「要再分類」なら: Sonnet再分類
$ git push origin main
```

## 必読ドキュメント

**作業前に必ず読め:**
- **Runbook**: `/Users/user/clawd/references/lure-db-runbook.md`
  - プロジェクト全体の手順、ルール、トラブルシュート
  - **新メーカー追加チェックリスト**（Phase 1〜6 + 完了条件7項目）
- **Obsidian設計書**: `ルアーDB 自動更新システム設計.md`
  - アーキテクチャ、スキーマ、改善履歴、作業ログ

## 説明文リライト手順（SEO対策）

**パイプラインはメーカー公式の説明文をそのままDBに保存する。リライトはパイプライン完了後に一括実行する。**

### ⚠️ 効率化ルール（2026-03-08〜）

1. **パイプライン実行中にリライトを始めるな**。完了後に1回で全量処理する
2. **ポーリング禁止**: `logs/pipeline-last-run.json` の存在で完了を判定する
3. **リライトスクリプトを使え**: 手動でバッチ分割・書き込みスクリプトを作るな

### 手順（一括スクリプト方式）

```bash
# 1. 対象確認（英語説明文の一覧）
npx tsx scripts/rewrite-descriptions.ts --check

# 2. バッチファイル＆プロンプト生成
npx tsx scripts/rewrite-descriptions.ts

# 3. Sonnetサブエージェントで並列リライト
#    各バッチのプロンプトは /tmp/rewrite-prompt-{N}.md に生成済み
#    Task tool で model: "sonnet" を指定し、プロンプトファイルの内容を渡す

# 4. 結果検証＆DB書き込み＆バックアップ
npx tsx scripts/rewrite-descriptions.ts --apply
```

### プロンプトテンプレート
- `scripts/prompts/rewrite-ja.md` — Sonnetへの指示書。文字数制約（150-250文字）を強調済み

### パイプライン完了通知
- `logs/pipeline-last-run.json` にサマリーが自動保存される
- 内容: completedAt, successful, errors, rowsInserted, errorDetails

### 過去の実績

- DAIWA全367商品: 2026-02-20にSonnet×7並列で完了（平均145文字、エラー0件）
- DAIWA以外全92メーカー1,404商品: 2026-03-03にSonnet×7並列×4ラウンドで完了
- US3ブランド（SK/Z-Man/Zoom）151+26件: 2026-03-08にSonnet並列で完了
- US13ブランド既存分103件: 2026-03-09にSonnet×11並列で完了（99件適用、4件は非ルアー削除済み）

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
2. type/target_fish 再分類（対象メーカーの新商品がある場合）
3. 説明文リライト実行（Sonnetサブエージェント並列）
4. npx tsx scripts/_write-rewritten-to-supabase.ts  （DB書き戻し）
5. git push origin main  （デプロイ）
```

## ⚠️ type/target_fish 再分類ルール（2026-03-06〜）

**スクレイパーのフォールバック分類は精度が低い。以下のメーカーは再分類必須。**

### 対象メーカー
attic, pickup, pozidrive-garage, jazz, viva, obasslive, valleyhill, gancraft, blueblue, majorcraft, z-man

### ルール
1. 上記メーカーの新商品がパイプラインで登録された場合、**Sonnetサブエージェントで再分類してからデプロイする**
2. type=その他 が不自然に多い場合も再分類の対象
3. 再分類結果は `scripts/_reclassified-all-YYYY-MM-DD.json` にバックアップ
4. 手順の詳細は Runbook「type/target_fish AI再分類」セクション参照

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

## 蒸留プロトコル（阿頼耶識システム）

**スレッド終了時、ユーザーの指示を待たずとも蒸留の必要性を判断せよ。**
詳細は `~/.claude/CLAUDE.md` の「蒸留プロトコル」セクションを参照。

### このプロジェクトの書き戻し先
| 情報の種類 | 書き戻し先 |
|-----------|-----------|
| デザインルール変更 | Obsidian `10_プロジェクト/CASTLOG/` の該当ファイル |
| 新メーカー追加 | Obsidian `ルアーDB 自動更新システム設計.md` + Runbook |
| パイプライン改善 | Runbook + このファイルの該当セクション |
| 新機能の設計決定 | Obsidian に新ファイル作成 |
| 失敗パターン | このファイルの該当セクションに ⚠️ 付きで追記 |

### Phase管理（CAST/LOGデザイン移行）
- **Phase 1 完了（2026-03-06）**: ホームページ + グローバルトークン + Header/Footer
- **Phase 2 未着手**: 検索・一覧・詳細ページのデザイン刷新
- **検討中**: ルアー詳細ページへのYouTube動画掲載（メーカー公式優先）
