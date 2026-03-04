/**
 * 全メーカー非ルアー商品一括クリーンアップ
 *
 * スキャン結果を精査し、偽陽性を除外した上で削除する。
 * 対象: フック、シンカー、ライン、ロッド、アパレル、バッグ、小物等
 * 2026-03-04
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// ─── 削除対象リスト ───
// manufacturer_slug → slug[] のマップ
const DELETE_MAP: Record<string, { slugs: string[]; reason: string }> = {
  daiwa: {
    slugs: [
      'tqokxup',   // オモリグシンカーTG
      '9l45bqn',   // 紅牙 フック SS／徳用
      'qg0t9uq',   // 紅牙フックSS 早掛け
      'p1sdgj2',   // 紅牙接続パーツβ ゆるふわダンサーキャップ
    ],
    reason: 'シンカー・フック・パーツ',
  },
  dranckrazy: {
    slugs: [
      'dkcap2025',        // DK CAP 2025ver.
      'fishing-measure',  // フィッシングメジャー
    ],
    reason: 'キャップ・メジャー',
  },
  dreemup: {
    slugs: [
      'tacklebag',       // DREEM TACKLE BAG SP
      'dreemup-sticker', // DreemUP STICKER
    ],
    reason: 'バッグ・ステッカー',
  },
  geecrack: {
    slugs: [
      'dorobou-omo-sinker', // DOROBOU OMO SINKER
      'nose-cone-sinker',   // NOSE CONE SINKER
      'shark-sinker',       // SHARK SINKER
    ],
    reason: 'シンカー',
  },
  grassroots: {
    slugs: [
      'bassrods01', // BASS RODSバスロッド
      'cap',        // CAPキャップ
    ],
    reason: 'ロッド・キャップ',
  },
  hayabusa: {
    slugs: [
      'sr430',  // オモリグ スピーディーフォールシンカー
      'fs463',  // ジャックアイ キックボトム スペアフック
      'se155',  // フリースライド トリプルカーリー ラバー&フックセット
      'se159',  // フリースライド パワフルカーリー ラバー&フックセット
    ],
    reason: 'シンカー・フック・フックセット',
  },
  hideup: {
    slugs: [
      'HU-CaluRuba50hook', // HUカルラバ5/0フック
    ],
    reason: 'スペアフック',
  },
  issei: {
    slugs: [
      '69851', // 楽刺し ネイルシンカー TG
    ],
    reason: 'シンカー',
  },
  itocraft: {
    slugs: [
      'landingnet', // LANDING NET
    ],
    reason: 'ランディングネット',
  },
  longin: {
    slugs: [
      'pouch22', // LONGIN PRODUCTS POUCH
    ],
    reason: 'ポーチ',
  },
  majorcraft: {
    slugs: [
      'eoc-s',       // エギゾー オモキャス シンカー
      'jrt-hook',    // ジグラバースルー 替えフック
      'be-sinker',   // ビッグアイ・オモリグシンカー
      'tmrbset',     // レッドバック カスタムセット（タイラバパーツ）
      'tmn',         // レッドバック カスタムネクタイ（タイラバパーツ）
      'ezt-sinker',  // 餌木蔵 TRシンカー
      'ezp-sinker',  // 餌木蔵 プラスシンカー
    ],
    reason: 'シンカー・フック・タイラバパーツ',
  },
  mukai: {
    slugs: [
      'smashlism-spanghook10-competition', // Smash&LISM SpangHook Competition
    ],
    reason: 'フック',
  },
  pickup: {
    slugs: [
      '1463',  // ロングスリーブＴシャツ
      '1436',  // FOOTBALL Tシャツ
      '1434',  // FOOTBALL Tシャツ
      '1743',  // ゲームベストポーチ
      '1450',  // ミニポーチ
      '1444',  // ラージバッグ
      '1455',  // オリジナルマスク
      '1491',  // グローブ
      '1487',  // グローブ
      '1845',  // ドリンクホルダー
      '1483',  // ネオプレーングローブ
      '1497',  // スケールメジャー
      '1442',  // ピックアップキャップ
      '1440',  // ピックアップキャップ
      '1438',  // ピックアップキャップ
    ],
    reason: 'アパレル・バッグ・小物',
  },
  shimano: {
    slugs: [
      'a155f00000c5cy0qaf',  // カケガミ チューニングフック デイゲーム
      'a155f00000c5cxzqaf',  // カケガミ チューニングフック ナイトゲーム
      'a155f00000drjmmqax',  // メタルショットTG ボートサワラ スペアフック
    ],
    reason: 'フック',
  },
  tict: {
    slugs: [
      'tacklebag',      // MINIMALISM TACKLE BAG
      'holderbucket2',  // ホルダーバケツⅡ
    ],
    reason: 'バッグ・バケツ',
  },
  tiemco: {
    slugs: [
      '2300500', // TGツイストアタッチルアーシンカー
    ],
    reason: 'シンカー',
  },
  valleyhill: {
    slugs: [
      'hook-de-dragon-quatro-assist', // HOOK de DRAGON QUATRO ASSIST
      'hook-de-dragon-quatro',        // HOOK de DRAGON QUATRO
    ],
    reason: 'フック',
  },
  viva: {
    slugs: [
      'spark-tenya-assist-sabasp',  // サバ用カスタマイズフック
      'namazu-hooks',               // ナマズ専用バーブレスWフック
      'datchak-hookunit',           // hook unit
      'spark-assist-hook',          // アシストフック
      'aw-shoulderbag',             // ショルダーバッグ
      'hansude-glove',              // グローブ
      'feather-hooks',              // フェザーフック
      'aw-offset-sinker',           // オフセットシンカー
      'metalmagic-spare-parts',     // ブレードフックセット（スペアパーツ）
    ],
    reason: 'フック・シンカー・バッグ・グローブ',
  },
  xesta: {
    slugs: [
      'xesta-assist-hook-2',  // XESTA ASSIST HOOK 2
      'xesta-assist-hook-3',  // XESTA ASSIST HOOK 3
      'xesta-line',           // XESTA LINE
    ],
    reason: 'フック・ライン',
  },
  yamashita: {
    slugs: [
      '532',  // エギ王TRシンカー
      '697',  // フリーズシンカー
      '615',  // 目玉シンカー
    ],
    reason: 'シンカー',
  },
  zipbaits: {
    slugs: [
      '53', // プラッギング専用 フッ素コートフック
    ],
    reason: 'フック',
  },
};

async function main() {
  console.log('=== 全メーカー非ルアー商品クリーンアップ ===\n');

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('*** DRY RUN ***\n');

  let totalDeletedSeries = 0;
  let totalDeletedRows = 0;

  for (const [mfr, { slugs, reason }] of Object.entries(DELETE_MAP).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`\n--- ${mfr} (${reason}) ---`);

    for (const slug of slugs) {
      const { count, error: countErr } = await sb
        .from('lures')
        .select('*', { count: 'exact', head: true })
        .eq('manufacturer_slug', mfr)
        .eq('slug', slug);

      if (countErr) {
        console.error(`  ❌ ${slug}: count error - ${countErr.message}`);
        continue;
      }

      if (!count || count === 0) {
        console.log(`  ⏭️  ${slug}: 0行（既に削除済み）`);
        continue;
      }

      if (dryRun) {
        console.log(`  🔍 ${slug}: ${count}行 → 削除予定`);
        totalDeletedSeries++;
        totalDeletedRows += count;
        continue;
      }

      const { error: delErr } = await sb
        .from('lures')
        .delete()
        .eq('manufacturer_slug', mfr)
        .eq('slug', slug);

      if (delErr) {
        console.error(`  ❌ ${slug}: delete error - ${delErr.message}`);
      } else {
        console.log(`  ✅ ${slug}: ${count}行削除`);
        totalDeletedSeries++;
        totalDeletedRows += count;
      }
    }
  }

  console.log(`\n=== 合計: ${totalDeletedSeries}シリーズ / ${totalDeletedRows}行 ${dryRun ? '削除予定' : '削除完了'} ===`);
}

main().catch(console.error);
