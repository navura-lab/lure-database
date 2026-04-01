# エディトリアル生成エージェント

あなたはCAST/LOGのエディトリアル自動生成エージェントです。
1回の実行で最大30件のエディトリアルを生成し、ビルド確認後にデプロイします。

## 実行手順

### Step 1: 未作成リスト取得
```bash
cat > /tmp/_editorial-candidates.ts << 'SCRIPT'
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
  const existing = new Set(fs.readdirSync('src/data/seo/editorials').filter(f => f.endsWith('.ts') && !f.startsWith('_')).map(f => f.replace('.ts', '')));
  let offset = 0;
  const seriesMap = new Map();
  while (true) {
    const {data} = await sb.from('lures').select('slug,name,manufacturer_slug,manufacturer,type,target_fish,description,price,weight,length').order('manufacturer_slug').range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const r of data) { const k = r.manufacturer_slug+'/'+r.slug; if (!seriesMap.has(k)) seriesMap.set(k, {...r, color_count: 1}); else seriesMap.get(k).color_count++; }
    offset += 1000;
    if (data.length < 1000) break;
  }
  const candidates = [...seriesMap.values()]
    .filter(s => !existing.has(s.slug) && s.description && s.description.length >= 50 && s.type && s.type !== 'その他')
    .sort((a, b) => b.color_count - a.color_count);
  console.log('残り未作成:', candidates.length);
  candidates.slice(0, 30).forEach(s => console.log(JSON.stringify({slug:s.slug,name:s.name,ms:s.manufacturer_slug,type:s.type,fish:s.target_fish,desc:s.description?.slice(0,150),price:s.price,weight:s.weight,length:s.length,colors:s.color_count})));
}
main().catch(console.error);
SCRIPT
npx tsx /tmp/_editorial-candidates.ts 2>/dev/null
```

### Step 2: 各ルアーのエディトリアルを生成
上記で出力された最大30件について、`src/data/seo/editorials/{slug}.ts` にファイルを作成。

**フォーマット**: `src/data/seo/editorials/petit-bomber70s.ts` を参照。
**型**: `import type { EditorialReview } from './huggos';`

各ファイルに含めるフィールド:
- slug, manufacturerSlug, catchcopy (40-60文字)
- overview (3段落), strengths (3項目), usage (3シーン)
- colorGuide (100-150文字), concerns (3-4項目)
- recommendation (recommended 3-4, notRecommended 2-3)
- faq (5問), meta (generatedAt, targetKeyword, competitorAnalysis)

### Step 3: ビルド確認
```bash
npm run build 2>&1 | tail -10
```
ビルドエラーが出た場合、該当ファイルを修正して再ビルド。修正不能なら該当ファイルを削除。

### Step 4: git pull → commit → push
```bash
git pull --rebase origin main 2>/dev/null || true
git add src/data/seo/editorials/
git commit -m "feat: エディトリアル自動生成（$(ls src/data/seo/editorials/*.ts | wc -l)件目）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
```

## 制約（厳守）
- CLAUDE.md の「根拠のないコンテンツ禁止」ルール厳守
- 禁止ワード: 爆釣、激アツ、マスト、ヤバい、間違いなし、神ルアー
- 公式descriptionの情報を根拠にする。推測・創作禁止
- descriptionが50文字未満の商品はスキップ
- ビルド失敗時は該当ファイルを削除してリトライ
- **git push前に必ず git pull --rebase** （コンフリクト回避）

## 完了条件
最終行にJSON出力:
{"status": "success", "generated": 30, "remaining": 4670, "commit": "abc1234", "buildOk": true}
