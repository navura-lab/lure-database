# 引き継ぎメモ — ユーザータスク一覧

**作成日:** 2026-04-06 夜
**前提:** 本日のセッションで **Phase 1 インフラ修復 + OAuth恒久対策 + ドラフト作成** まで完了。ユーザー手動作業が必要なものは全てこのファイルに集約。

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

### T3: メーカーメール送信（最重要被リンク施策）
**所要時間:** 1社あたり10分、TOP5で50分
**テンプレ:** `docs/outreach/maker-email-templates.md`
**送信順序:**
1. JACKALL（374件掲載）
2. DAIWA（331件掲載）
3. SHIMANO（220件掲載）
4. Megabass（205件掲載）
5. ima（154件掲載）

**送信前の準備:**
- [ ] 運営者名（実名 or ハンドル）を決定
- [ ] 返信用メールアドレスを決定
- [ ] 各メーカーの問い合わせフォームURLを再確認（テンプレに記載あり）

**送信後:**
- [ ] `docs/outreach/log.md` を作成して記録（送信日、宛先、返信状況）
- [ ] 1社でも返信があったら俺に教える → 関係構築の戦略を一緒に考える

**ステータス:** ❌ 未送信

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
