import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// type=その他 → 正しい分類にマッピング
const reclassify: Record<string, { type: string; target_fish?: string[] }> = {
  // 6th Sense
  '6th-sense/party-paddle-4-3-saltwater-shroom-show': { type: 'スイムベイト', target_fish: ['レッドフィッシュ', 'スヌーク', 'シートラウト'] },

  // LiveTarget
  'livetarget/rigged-shrimp': { type: 'ワーム', target_fish: ['レッドフィッシュ', 'ヒラメ', 'スヌーク', 'シートラウト'] },

  // Lunkerhunt
  'lunkerhunt/bait-shifter-shrimp-5-pack-baits-only': { type: 'ワーム', target_fish: ['レッドフィッシュ', 'シートラウト'] },

  // SPRO
  'spro/shimmy-semi-long-230g-unrigged': { type: 'メタルジグ', target_fish: ['ブリ', 'カンパチ'] },

  // Z-Man - hooks/jig heads (keep as ジグヘッド)
  'z-man/tt-lures-chinlockz-sws': { type: 'ジグヘッド' },

  // Z-Man - soft plastics
  'z-man/big-ballerz': { type: 'スイムベイト' },
  'z-man/fattyz': { type: 'ワーム' },
  'z-man/doormatadorz': { type: 'ワーム' },
  'z-man/hellraizer': { type: 'トップウォーター' },
  'z-man/kicker-crabz': { type: 'ワーム' },
  'z-man/slingbladez-willow-colorado': { type: 'スピナーベイト' },
  'z-man/baby-ballerz': { type: 'スイムベイト', target_fish: ['クラッピー'] },
  'z-man/mag-fattyz': { type: 'ワーム' },
  'z-man/slingbladez-double-willow': { type: 'スピナーベイト' },
  'z-man/crusteaz': { type: 'ワーム' },
  'z-man/streakz': { type: 'ワーム' },
  'z-man/ez-shrimpz-unrigged': { type: 'ワーム', target_fish: ['レッドフィッシュ', 'シートラウト'] },
  'z-man/stingerz': { type: 'ワーム' },
  'z-man/larvaz': { type: 'ワーム', target_fish: ['クラッピー', 'パンフィッシュ'] },
  'z-man/heroz': { type: 'スイムベイト' },
  'z-man/tiny-ticklerz': { type: 'ワーム', target_fish: ['クラッピー', 'パンフィッシュ'] },
  'z-man/swag-lt': { type: 'スイムベイト' },
  'z-man/mulletron-lt': { type: 'スイムベイト' },
  'z-man/flashback-mini': { type: 'スピナーベイト' },
  'z-man/ez-shrimpz-rigged': { type: 'ワーム', target_fish: ['レッドフィッシュ', 'シートラウト'] },
  'z-man/drop-kickerz': { type: 'ワーム' },
  'z-man/gobius': { type: 'ワーム' },
  'z-man/bang-stickz': { type: 'ワーム' },
  'z-man/streakz-xl': { type: 'ワーム' },
  'z-man/scented-shrimpz': { type: 'ワーム', target_fish: ['レッドフィッシュ', 'シートラウト'] },
  'z-man/pro-bulletz': { type: 'ジグヘッド' },
  'z-man/prawnstarz-lb-loose-body': { type: 'ワーム', target_fish: ['レッドフィッシュ', 'シートラウト'] },
};

async function main() {
  let success = 0;
  let errors = 0;

  for (const [key, update] of Object.entries(reclassify)) {
    const [mfg, slug] = key.split('/');

    const updateData: any = { type: update.type };
    if (update.target_fish) {
      updateData.target_fish = update.target_fish;
    }

    const { data, error } = await sb.from('lures')
      .update(updateData)
      .eq('manufacturer_slug', mfg)
      .eq('slug', slug)
      .select('id');

    if (error) {
      console.error(`❌ ${key}: ${error.message}`);
      errors++;
    } else {
      const count = data?.length ?? 0;
      if (count > 0) {
        console.log(`✅ ${key} → ${update.type} (${count}行)`);
        success++;
      } else {
        console.log(`⏭️ ${key} → DB不在`);
      }
    }
  }

  console.log(`\n成功: ${success}件, エラー: ${errors}件`);
}

main();
