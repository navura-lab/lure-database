import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const updates = [
  {
    slug: 'shumari-110f',
    name: 'シュマリ 110F',
    description: '後方固定重心とショートリップ、楕円形断面ボディを採用した11cmの本流専用フローティングミノー。高い遠投性能と強い水噛みを両立し、米代川・最上川・神通川・九頭竜川といった太く速い本流でもタイトウォブンロールアクションを安定して維持する設計。ボディ形状がアグレッシブな流れを攻略するための専用チューニング。',
  },
  {
    slug: 'suterusupeppa-110ssuroshinkingu',
    name: 'ステルスペッパー110S(スローシンキング)',
    description: '極薄0.3mmステンレスバネ材製の完全オリジナルプロップを搭載した110mmスローシンキングプロップベイト。デッドスロー〜ファストリトリーブまでプロップが確実に回転し、固定式低重心ウェイトによりボディが回転しないナチュラルなベイトフィッシュ演出を実現。オリジナルヒートンでリアフックを後方マウントしトラブルを軽減。ロングキャスト性能とビッグフィッシュへの視覚的アピール力を備える。',
  },
];

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  for (const item of updates) {
    console.log(`\n[${item.name}] slug: ${item.slug}`);
    console.log(`文字数: ${item.description.length}`);

    const { error } = await sb.from('lures')
      .update({ description: item.description })
      .eq('slug', item.slug)
      .eq('manufacturer_slug', 'tiemco');

    if (error) {
      console.error(`❌ エラー: ${error.message}`);
    } else {
      console.log(`✅ 更新完了`);
    }
  }
}

main();
