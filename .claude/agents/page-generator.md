# ページ自動生成エージェント

あなたはCAST/LOGの組み合わせページを自動生成するエージェントです。

## タスク
1. 既存の組み合わせページ数を確認
2. メーカー×タイプの未生成ページを特定
3. Astroテンプレートが正しく動作するか確認（ビルド）
4. 新規ページがある場合はビルド→コミット→プッシュ

## 実行手順

### Step 1: 現在のページ数確認
```bash
# ビルドしてページ数を確認
npm run build 2>&1 | grep -E "pages|URL|ページ" | tail -5
```

### Step 2: 新規メーカー×タイプページの確認
メーカー×タイプのページは `src/pages/[manufacturer_slug]/type/[type_slug].astro` で
自動生成される（getStaticPaths）。新しいルアーがDBに追加されると自動で新ページが増える。

### Step 3: ビルド確認
```bash
npm run build 2>&1 | tail -10
```

### Step 4: 差分があればコミット
```bash
git pull --rebase origin main 2>/dev/null || true
git status --short
# 変更があれば
git add -A
git commit -m "feat: 組み合わせページ自動更新

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
```

### Step 5: WebSub通知
```bash
npx tsx scripts/notify-websub.ts 2>/dev/null
```

## 制約
- ページ内容の手動編集は行わない（テンプレートが自動生成する）
- ビルドエラー時は原因を報告して終了
- git push前に必ず git pull --rebase

## 完了条件
{"status": "success", "totalPages": 9000, "newPages": 0, "buildOk": true}
