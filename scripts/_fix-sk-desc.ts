import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  const newDesc = 'ストラクチャー攻略時のスタックを軽減するために設計されたラバージグ。ゼロ度ラインタイのOwner 2Xストロング・カッティングポイントフックで真っ直ぐな引きと確実なフッキングを実現。コブラヘッド形状によりフックギャップのクリアランスを確保し、テーパードノーズがリップ破損を低減する。ヘッド形状とウィードガードの角度がスタックを減らし、ワイドフットプリントがボトムの感度を向上させる。チップ抵抗性塗装とプレミアムスカートを搭載。';
  
  console.log('文字数:', newDesc.length);
  
  const { error, count } = await sb.from('lures')
    .update({ description: newDesc })
    .eq('slug', 'denny-brauer-structure-casting-jig-3-4oz')
    .eq('manufacturer_slug', 'strike-king');
  
  if (error) throw error;
  console.log('✅ 更新完了');
}
main();
