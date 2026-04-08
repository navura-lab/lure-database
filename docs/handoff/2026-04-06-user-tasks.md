# 引き継ぎメモ — ユーザータスク一覧

**作成日:** 2026-04-06 夜（最終更新: 2026-04-08 早朝）
**前提:** 本日のセッションで **Phase 1 インフラ修復 + OAuth恒久対策 + ドラフト作成 + 品質ゲートシステム + Gary画像修正 + ism新規メーカー追加** まで完了。

## 🆕 2026-04-08 セッション追加成果

### Gary Yamamoto 画像問題対応
- スクレイパー修正: colorchipの三角アイコンではなく、`.product_mainimg` のメイン製品写真を使うように
- pipeline-jpで全111件再スクレイプ → R2に新画像アップロード
- DB images カラム 321件更新成功 (`scripts/_update-gary-images.mjs`)
- ⚠️ 残り 635件 は古い `gary/products_data/worm8_image.jpg` 等のURLが404→HTMLエラーページを返し、5000バイト未満エラーでスキップ → **別タスク (T17)**

### INFINITE SEEDS MAKERS (ism) 新規追加
- 知人ルートの商談先メーカー
- スクレイパー新規実装: `scripts/scrapers/ism.ts` (BASE プラットフォーム + JSON-LD パース、Playwright不要、超軽量)
- discover-products.ts に追加 (24件検出)
- pipeline-jp で17商品スクレイプ → アパレル/ロッド7商品削除 → ルアー10商品が DB に正しく登録
- type 手動修正 (スピナーベイト、トップウォーター、ワーム、ペンシル、ミノー)
- target_fish 補完 (主にブラックバス系)
- **商談前の準備完了**: ism全ルアー商品が CAST/LOG に正しく掲載されている状態

### 残りタスク

#### T17: Gary Yamamoto 残り 635件の画像問題
- 古い `gary/products_data/{name}_image.jpg` URLが404→HTMLエラー
- 該当商品のスクレイパーが旧URLパターンに依存している
- 対処案:
  - A) スクレイパーで mainImage URL の Content-Type を確認し、text/html なら別ソースを試す
  - B) 個別に旧 wp-content/uploads/ 内を探して URL を特定
  - C) 一旦放置 (pull-70f等の主力商品は新URLで対応済み)
- **優先度: 中** (主力商品は対応済みなので致命的ではない)

#### T18: ism 商談用パッケージ準備（社長と会えたら俺が即対応）
- ism掲載商品: 10商品 (バス系9、ソルト系1)
- メーカーページURL: https://www.castlog.xyz/ism/
- 商談時に必要な数字: 即出せる
- 必要なら商談1枚資料を別途作成


---

## 🔴 最優先（今すぐやるべき）

### T1: GSC「手動による対策」の確認
**所要時間:** 2分
**URL:** https://search.google.com/search-console → プロパティ選択 → 「セキュリティと手動による対策」→「手動による対策」
**期待結果:** 「問題は検出されませんでした」
**もしペナルティ表示があった場合:** 即俺（Claude）に報告。全戦略の見直しが必要。
**ステータス:** ❌ 未確認（本日着手タイミングを逃した）

### T2: インデックス状況の基準値取得
**所要時間:** 3分
**URL:** Search Console → プロパティ → 「インデックス作成」→「ページ」
**記録すべき数字:**
- 「インデックスに登録済み」件数: ____
- 「未登録」件数: ____
- 未登録理由のトップ3:
  1. ____
  2. ____
  3. ____
**目的:** 1週間後・1ヶ月後に効果測定するための基準値
**ステータス:** ❌ 未取得

---

## 🟡 中優先（1週間以内）

### T3: メーカー被リンク獲得（最重要施策）
**方針変更（2026-04-07）:** コールドメール大量送信は **保留**。代わりに **知人ルート（メーカー社長との直接コネ）** で1社進める。
- 成約率: コールドメール1-3% vs 知人経由 50-80%
- 1社でも公式リンク獲得できれば、ドメイン信頼性が桁違いに向上する
- TOP5への一斉送信は、知人ルートの結果が出るまで凍結

**進行中（知人ルート）:**
- [ ] 該当メーカー社長にアポ取り
- [ ] 商談実施
- [ ] CAST/LOGの掲載と公式リンク設置の打診

**商談で使える資料（俺が用意できる）:**
- 数字: 月間~70,000インプ（GSC実績）、~9,500ページ、~133ユーザー/8日（GA4）
- 該当メーカー商品の掲載数（必要なら俺が即出す）
- メーカーページURL（castlog.xyz/{maker_slug}/）
- 想定メリット: ユーザーへの正確な情報提供、SEO相互送客、ブランド認知

**TOP5コールドメール送信の保留理由:**
- 知人ルートで1社決まれば、それを「実績」として他社に話せる → 成約率が更に上がる
- 知人ルートの結果が出る前にコールド送信して断られると逆効果（再アプローチが難しくなる）

**コールドメールテンプレ:** `docs/outreach/maker-email-templates.md`（凍結中、知人ルート完了後に解凍）

**ステータス:** 🟡 進行中（知人ルートでアポ取り中）

### T4: X（Twitter）異議申し立て
**所要時間:** 5分
**テンプレ:** `docs/outreach/x-appeal-template.md`
**URL:** https://help.x.com/ja/forms/account-access/appeals

**送信前の準備:**
- [ ] テンプレの `{運営者名}` `{メールアドレス}` を実値に置換
- [ ] 必要なら「サイト側に認証ページを作成」（テンプレ内に詳細記載）

**却下された場合の代替策:** テンプレ末尾に記載（別アカウント、Threads、Blueskyなど）
**ステータス:** ❌ 未送信

### T5: note記事公開
**所要時間:** 編集30分 + 公開5分
**下書き:** `docs/outreach/note-article-draft-1.md`

**編集時のチェックポイント（下書き末尾にも記載）:**
- [ ] 「半年前」「98メーカー」等の数字を実態に合わせる
- [ ] 気づき2のメーカー名A/Bを実名 or 匿名のまま調整
- [ ] 気づき4の「年率5〜8%」を「体感」表現に調整
- [ ] 気づき5のGSC連携データを追加するか判断
- [ ] 運営者名・連絡先を埋める
- [ ] タイトル確定（3案から選択）
- [ ] アイキャッチ画像を用意（CAST/LOGスクショ or ルアー画像コラージュ）

**公開後:**
- [ ] CAST/LOG内にnote記事へのリンクを設置（トップページ or About）
- [ ] Search Consoleでnote.comからの流入を1週間後に確認

**ステータス:** ❌ 未編集

### T5.5: GA4 で楽天アフィリエイトクリック計測の初期設定
**所要時間:** 10分 + 反映待ち24-48時間
**前提:** 2026-04-06 夜にコード実装済み・デプロイ済み（コミット `ca207b2`）

**背景:**
- 楽天アフィリで初報酬発生 → 「何クリックされているか見たい」という要望
- BaseLayoutに `affiliate_click` カスタムイベントのグローバルリスナーを実装済み
- `data-aff` 属性付きリンクのクリックで GA4 に自動送信される
- パラメータ値は **全て日本語化済み**（`楽天市場` / `上部ボタン` / `下部ボタン` / `上部ボタン（英語版）`）

**やること:**

#### Step 1: リアルタイム確認（まず動いてるかチェック）
1. GA4 → **レポート** → **リアルタイム** を開いたまま
2. 別タブで https://www.castlog.xyz/littlejack/huggos/ 等を開く
3. 「楽天市場で探す」ボタンをクリック（遷移先で戻る）
4. GA4 リアルタイムに `affiliate_click` イベントが出ればOK

#### Step 2: カスタムディメンション登録（これが一番重要）
GA4 → **管理**（左下の歯車）→ **カスタム定義** → **カスタムディメンション** → **カスタムディメンションを作成** を4回。

| # | ディメンション名（日本語で自由に） | スコープ | 説明 | イベントパラメータ |
|---|---|---|---|---|
| 1 | 商品名 | イベント | クリックされた商品 | `product_name` |
| 2 | メーカー | イベント | ルアーメーカー | `manufacturer` |
| 3 | ボタン位置 | イベント | 上部 or 下部 | `button_location` |
| 4 | 提携先 | イベント | 楽天市場など | `affiliate` |

※ディメンション名はGA4レポート画面で表示される日本語ラベル。自由に変更OK
※イベントパラメータ名（英数字）はコード側と一致している必要あり

#### Step 3: コンバージョンとしてマーク（推奨）
1. GA4 → **管理** → **イベント** を開く
2. 一覧に `affiliate_click` が出ている（出てなければ Step 1 をやり直し、1時間ほど待つ）
3. 右端のトグル「**主要なイベントとしてマーク**」を ON
4. これで「鍵のイベント」としてダッシュボードに目立つ位置に表示される

#### Step 4: 探索レポート作成（どの商品がクリックされてるか確認）
1. GA4 → **探索** → 「**空白**」
2. 変数欄に以下をドラッグ:
   - ディメンション: `商品名`, `メーカー`, `ボタン位置`
   - 指標: `イベント数`
3. タブ設定:
   - 行: `商品名`
   - 値: `イベント数`
   - フィルタ: `イベント名` が `affiliate_click` と完全一致
4. → **商品別クリックランキング** が表示される

#### 役立つ探索パターン
- **商品別ランキング**: 行=商品名, 値=イベント数（TOP売れ筋把握）
- **メーカー別**: 行=メーカー, 値=イベント数（どのメーカーが刺さるか）
- **ボタン位置別**: 行=ボタン位置, 値=イベント数（上部 vs 下部の勝ち負け）
- **ページ別CTR**: 行=ページパス, 値=イベント数 ÷ ページビュー

### 1週間後の確認ポイント
- [ ] GA4で `affiliate_click` が日次記録されているか
- [ ] 楽天アフィリ管理画面のクリック数と GA4 の `affiliate_click` 総数が近い値か（完全一致はしない。楽天側はLastClick基準で判定が違う）
- [ ] 最もクリックされている商品 TOP5 → その商品ページの強化候補
- [ ] 上部ボタン vs 下部ボタンのCTR差（明確に差があれば片方に統一）
- [ ] 楽天報酬 ÷ クリック数 = コンバージョン率（業界平均は 0.5〜2%）

**ステータス:** ❌ 未設定

### T5.6: ⚠️ 製品メイン画像が保存されていない問題（要調査・要修正）
**所要時間:** 調査30分 + 修正1〜半日（範囲次第）
**発見日:** 2026-04-06 夜（ユーザー指摘）

**症状:**
- ゲーリーヤマモトの商品ページ（例: https://www.castlog.xyz/gary-yamamoto/yamatanuki25/）に**ワーム本体の全体写真がない**
- 表示されているのはカラーチップ画像（色見本の小さい画像）のみ
- `images` 配列に色画像1枚だけ保存されていて、製品全体写真が抜け落ちている

**根本原因（3層）:**

1. **スクレイパー** (`scripts/scrapers/gary-yamamoto.ts:236`)
   ```ts
   var mainImgEl = document.querySelector('.product_mainimg img');
   ```
   - `.product_mainimg` というクラスが現在のページHTMLに存在しない可能性
   - 結果: `mainImage` が空になる

2. **パイプライン** (`scripts/pipeline.ts:608`)
   ```ts
   images: sanitizeImageUrls(imageUrl ? [imageUrl] : null),
   ```
   - 各DB行（カラー単位）には**そのカラーの色画像1枚しか入れていない**
   - スクレイパーが `mainImage` を取っていてもDBに保存する経路がない

3. **実際のメイン画像の場所**
   - WebFetch調査結果: `<img src="https://www.gary-yamamoto.com/wp-content/uploads/2021/04/ymt005.jpg" alt="2.5″YAMATANUKI">` 形式
   - 別ディレクトリ・別命名規則で配置されている

**対処オプション:**

#### Option A: gary-yamamoto単独修正（最短15分、影響範囲小）
- スクレイパーで `<img alt={商品名}>` の正規表現マッチで全体画像を抽出
- pipeline.ts で `images` 配列に `[mainImage, colorImage]` 形式で保存（スキーマ変更なし）
- gary-yamamoto の全商品を Airtable で「未処理」に戻して再パイプライン
- リスク: 他メーカーも同じ問題なら個別対応が必要

#### Option B: 全メーカー点検（半日）
- 全スクレイパーで `mainImage` が取れているかを一括チェックスクリプト作成
- 取れていないメーカーを特定・修正
- pipeline.ts でメイン画像を `images[0]` として保存するよう変更
- 全該当商品を再スクレイプ

#### Option C: スキーマ追加（半日〜1日）
- `lures.representative_image TEXT` カラムを Supabase migration で追加
- pipeline.ts で representative_image を別カラムに保存
- テンプレートで representative_image があれば優先表示
- リスク: 本番DBスキーマ変更、全レコードのバックアップ必須

**俺の推奨: Option B**
- 個別対応より体系的に解決
- 「他メーカーは大丈夫か?」という不安が消える
- スキーマ変更を避けつつ images 配列を活用できる
- pipeline.ts の変更1箇所で全メーカー網羅できる

**着手前の確認事項（ユーザー判断）:**
- [ ] どのオプションで進めるか
- [ ] 全メーカー再スクレイプは時間がかかる（数日間 pipeline-jp の通常運用と並行）→ いつ実行するか
- [ ] スクレイパー修正の優先順位（gary-yamamoto は商品数も少ないので独立対応も可）

**ステータス:** ❌ 未着手（要ユーザー判断）

---

## 🟢 低優先（1ヶ月以内）

### T6: Indexing API クォータ上限申請
**所要時間:** 10分 + 審査数日
**URL:** GCP Console → APIs & Services → Google Indexing API → Quotas → 「QUOTA INCREASE REQUEST」

**現状:** 200 publish requests/day/project（無料枠上限）
**希望:** 600/day（3倍）
**申請理由（記入例）:**
```
CAST/LOG (castlog.xyz) operates a database of ~9,500 fishing lure products.
We add 10-50 new products daily and need to notify Google of these changes promptly.
At current 200/day limit, full site coverage takes 65 days.
Increasing to 600/day will allow timely indexing of new content and improve
user experience for our ~60,000 monthly searches.
```

**効果:** 全9,500ページの完全送信が65日 → 22日に短縮
**ステータス:** ❌ 未申請

### T7: Supabase SQL実行（既に未実行タスク）
**出典:** MEMORY.md「ユーザータスク」
**所要時間:** 5分
**内容:**
1. ユーザー参加型テーブル作成（`docs/user-platform-spec.md` に詳細、Obsidian参照）
2. 検索爆速化SQL

**未実行だと起きる問題:**
- UIコンポーネント（持ってる/欲しい/報告ボタン）が機能しない
- 検索が遅いまま

**ステータス:** ❌ 未実行（セッションをまたいで忘れられている）

### T8: GA4 BOTフィルタ設定
**所要時間:** 3分
**URL:** GA4 → 管理 → プロパティ → データ設定 → データフィルタ → 「BOTを除外」を有効化
**効果:** GSC 760クリック vs GA4 124ユーザーの乖離を是正
**ステータス:** ❌ 未設定

### T9: Supabase Auth 有効化（Google/X OAuth）
**前提:** T7完了後
**所要時間:** 30分
**出典:** MEMORY.md、Obsidian `user-platform-spec.md`
**ステータス:** ❌ 未設定

### T10: Discord Webhook URL設定
**所要時間:** 5分
**目的:** 自動運転エージェントの通知受信
**現状:** コードはDiscord通知対応済みだが、URL未設定のため通知が飛んでいない
**設定先:** `ops/run-agent.sh` 内の環境変数 or `.env`
**ステータス:** ❌ 未設定

---

## 🛡️ 品質ゲートシステム（2026-04-07夜実装）

**実装完了:**
- `scripts/quality-score.ts` — 9指標で全6,511ルアーをスコアリング、SQLite + JSON出力
- `scripts/quality-improve-queue.ts` — 改善キュー（Haiku呼び出しはTODO、要実装）
- `scripts/run-quality-score.sh` + launchd plist — 毎日3:00 JST自動実行
- `src/pages/[manufacturer_slug]/[slug].astro` — quality-overrides.json読み込み + noindex判定統合
- ops/db/agents.db に `quality_scores` テーブル追加

**初回スコアリング結果（2026-04-07）:**
- ok (≥70): 2,831件 (43.5%)
- improve (50-69): 2,529件 (38.8%)
- noindex (30-49): 1,148件 (17.6%) ← デプロイ後に自動noindex
- delete (<30): **3件のみ** (`spro/aiya-long-uv`, `spro/pesce-40g`, `spro/pesce-150g`)

**ユーザー判断が必要なもの:**

### T11: delete バンド3件の対応方針
**所要時間:** 5分（判断のみ）
- 3件すべて SPRO のメタルジグで `description: NULL, editorial: なし, image: なし`
- 選択肢:
  - **A**: 完全削除（404）→ redirects.json に追加して `/spro/` トップに301
  - **B**: 残してdescription補完（再スクレイプ or 手動執筆）
  - **C**: noindex のまま放置
**ステータス:** ❌ 未判断

### T12: quality-improve-queue.ts のHaiku呼び出し実装
**所要時間:** 1-2時間 + Haikuコスト約$3-5
**現状:** スクリプトのスケルトンと安全策（dry-run、上限50件/日）は実装済み。Claude Haiku API呼び出しと並列処理がTODOコメントになっている
**完成すれば:**
- improve バンド (2,529件) のうち description不備のページを日次50件ずつ自動補完
- 約2ヶ月で全件補完完了
- 補完後に再スコアリングで OK バンドへ昇格

### T13: 1日の自動変更件数上限（暴走防止）
**所要時間:** 30分
**目的:** quality-improve-queue.tsとquality-score.tsで「1日にN件以上自動変更しない」上限を実装
**現状:** quality-improve-queue.tsは50件上限済み。noindex適用には上限なし（オーバーライドは差分のみ反映なので暴走リスク低）

### T14: Phase D（削除候補の承認ゲート）実装
**前提:** Discord Webhook URL設定（既存T10）
**所要時間:** 1-2時間
**内容:**
- delete バンド候補をDiscord通知
- 24時間タイムアウトで自動実行（拒否なし時）
- 削除はファイル削除ではなく301リダイレクト + redirects.json登録
- git履歴で完全復旧可能
- 1日上限20件

### T15: ANTHROPIC_API_KEY を .env に設定（quality-improve-queue稼働の前提）
**所要時間:** 3分
**現状:** `.env` の `ANTHROPIC_API_KEY=` の **値が空**
**必要理由:** quality-improve-queue.ts が Claude Haiku を呼び出すため
**設定方法:**
1. https://console.anthropic.com/settings/keys でAPIキー作成
2. `.env` の `ANTHROPIC_API_KEY=` の右辺に貼り付け
3. テスト: `npx tsx scripts/quality-improve-queue.ts --apply --limit 5`
4. 結果確認: `logs/quality/improve-backup-YYYY-MM-DD.json`
**コスト見積:** Haiku 1リクエスト約$0.001、3,071件全部処理しても約$3-4

**ステータス:** ❌ 未設定

### T16: クロール済み未登録リスト（crawled-not-indexed.json）の更新運用
**所要時間:** 週次5分
**現状:**
- `logs/seo-data/crawled-not-indexed.json` に23件保存済み（2026-04-07時点）
- `daily-indexing.ts` が毎日この23件を最優先で再送信する設定済み
- 効果測定: 1週間後にGSCで「クロール済み-未登録」件数が減るかチェック

**運用ルール:**
- 月1回、GSCの「クロール済み - インデックス未登録」レポートを開いて新しいURLをコピー
- `logs/seo-data/crawled-not-indexed.json` の `urls` 配列に追加
- 既にインデックスされたURLは削除（手動 or `gh api` で確認）
- ファイル更新後、git push で daily-indexing にも反映

**ステータス:** ⚠️ 初回データセット保存済み、今後の運用が必要

---

## 📊 今日のセッションで完了したこと（参考）

### ✅ Phase 1: インフラ修復
1. ハングしていたpipeline-jpプロセス2本（PID 25392, 25393、19日間固着）をkill
2. `scripts/pipeline.ts` から `triggerVercelDeploy` 関数と `VERCEL_DEPLOY_HOOK` 参照を完全削除
3. `scripts/config.ts` からも削除
4. pipeline-jp を手動実行（25件処理、9件成功/81行新規登録）
5. Indexing API OAuth refresh_token を再認証
6. **GCP OAuth consent screen を Production化 → 恒久対策成立**（以後7日失効なし）
7. git commit `9682275` + push + WebSub通知成功

### ✅ 診断で判明したこと
- **インプ減の真因:** 3/18にVercel deploy hookが404/429 → triggerVercelDeployがリトライ地獄 → pipeline-jpがハング → 19日間自動更新が止まった → Googleがクロール頻度を下げた → 3/30からGSCインプが6日連続減
- **カニバリゼーション:** TOP6は全て1ルアー1slug、ほぼ無害（3件のみ）
- **title/description:** 既に超最適化済み。追加改善の余地なし
- **エディトリアル:** 4,260件中 4,129件が新フォーマット完備、131件が旧フォーマット
- **description品質:** 6,611グループ中 657件が短い or 欠落（内訳: NULL 111 / 30字未満 543 / 英語のみ 3）
- **結論:** 打てる内部施策は全部打ってある。**残る唯一のボトルネックは被リンク不足**

### ✅ 作成したドラフト（ユーザー送信・公開待ち）
- `docs/outreach/maker-email-templates.md` — メーカーメール2パターン + TOP10送信先
- `docs/outreach/x-appeal-template.md` — X凍結異議申し立て文
- `docs/outreach/note-article-draft-1.md` — note記事3,000字下書き

---

## 🤖 自動運転で進むもの（ユーザー操作不要）

これらは launchd で自動実行される。1週間後に効果測定。

| ジョブ | 次回実行 | 内容 |
|---|---|---|
| pipeline-jp | 毎時0-7JST | JP新商品登録（今夜24:00 JSTから再稼働） |
| discover-us | 毎日5:00 | US新商品検知 |
| discover-jp | 月曜6:00 | JP新商品検知 |
| pipeline-us | 毎日8:00 | US新商品登録 |
| seo-monitor | 毎日7:00 | GSC日次データ収集 |
| daily-indexing | 毎日8:00 | Indexing API 200件/日送信 |
| weekly-report | 月曜9:00 | 週次PDCAレポート |
| editorial-writer | 1h毎 | エディトリアル30件/回生成 |
| improvement-loop | 毎日9:00 | 自律改善 |

**1週間後の確認ポイント:**
- [ ] GSC インプレッションが底打ち → 回復傾向か
- [ ] pipeline-jp の launchd 実行ログが正常か（`logs/launchd-pipeline-jp.log`）
- [ ] discover-products の新商品検知件数推移
- [ ] Indexing API の累計送信数が1,586 → 2,900以上に進んでいるか

---

## 📝 次セッション開始時のベースライン

以下を俺に伝えると、状況を即把握できる:

1. T1-T2（GSC確認）の結果
2. T3-T5（メーカーメール・X・note）の進捗
3. 自動運転の動作確認結果（上記1週間後チェック項目）
4. その他気になること

**Phase 2 候補タスク（T3-T5 完了後に着手）:**
- 旧フォーマットエディトリアル131件の再生成（自動化可）
- meta欠落657件の自動補完（Haiku並列でコスト約$2程度）
- メーカーページ充実化（仕様書: Obsidian `maker-page-spec.md`）
- ユーザー参加型機能の実装（T7, T9完了後）
