import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 分類マッピング
const reclassifications: Record<string, string> = {
  'scented-paddlerz': 'スイムベイト',       // パドルテールスイムベイト
  'banded-skirtz': 'その他',               // スカート部品 → その他のまま
  'tt-lures-headlockz-hd': 'ジグヘッド',    // ヘビーデューティジグヘッド
  'gremlin': 'ワーム',                      // クリーチャーベイト
  'mag-swimz': 'スイムベイト',              // 8インチスイムベイト
  'prawnstarz': 'ワーム',                   // シュリンプ型ワーム
  'hula-stickz': 'ワーム',                  // ネッドリグワーム
  'tt-lures-chinlockz-sws': 'その他',      // ウィードレスフック部品 → その他のまま
  'ez-eggz': 'ワーム',                      // エッグストリング
  'streakz-3-75': 'ワーム',                 // スプリットテールミノーワーム
  'fuzzy-nuggetz': 'ワーム',                // マイクロワーム
  'fattyz-thick-stickz-6': 'ワーム',        // スティックベイト
  'mulletron-loose-body': 'スイムベイト',    // マレット型スイムベイト
};

let changed = 0;
for (const [slug, newType] of Object.entries(reclassifications)) {
  if (newType === 'その他') continue; // 変更不要
  
  const { error, count } = await sb
    .from('lures')
    .update({ type: newType })
    .eq('manufacturer_slug', 'z-man')
    .eq('slug', slug);
  
  if (error) {
    console.error(`❌ ${slug}: ${error.message}`);
  } else {
    console.log(`✅ ${slug}: その他 → ${newType}`);
    changed++;
  }
}

console.log(`\n完了: ${changed}件を再分類`);
