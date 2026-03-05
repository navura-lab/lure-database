/**
 * Infer target_fish for 817 products with empty target_fish
 * Run: npx tsx scripts/_infer-target-fish.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LureRecord {
  slug: string;
  manufacturer_slug: string;
  name: string;
  type: string | null;
  description: string | null;
}

interface InferResult {
  slug: string;
  manufacturer_slug: string;
  name: string;
  type: string | null;
  target_fish: string[];
  method: string; // how it was inferred
}

function inferTargetFish(r: LureRecord): { fish: string[]; method: string } {
  const name = (r.name ?? '').toUpperCase();
  const desc = (r.description ?? '').toUpperCase();
  const type = (r.type ?? '').trim();
  const maker = r.manufacturer_slug;

  const fish = new Set<string>();
  const methods: string[] = [];

  // ─── Step 1: By type ────────────────────────────────────────────────────────
  if (type === 'エギ') {
    fish.add('アオリイカ');
    fish.add('イカ');
    methods.push('type=エギ');
  } else if (type === 'タイラバ') {
    fish.add('マダイ');
    methods.push('type=タイラバ');
  } else if (['スピナーベイト', 'ラバージグ', 'バズベイト'].includes(type)) {
    fish.add('ブラックバス');
    methods.push(`type=${type}`);
  } else if (type === 'スプーン') {
    const isTrout = /トラウト|TROUT|AREA|エリア/.test(name + desc);
    if (isTrout) {
      fish.add('トラウト');
      methods.push('type=スプーン+trout_kw');
    } else {
      fish.add('ブラックバス');
      methods.push('type=スプーン+default_bass');
    }
  }

  // ─── Step 2: Name keywords ────────────────────────────────────────────────
  // シーバス / SEA BASS
  if (/シーバス|SEA BASS|SEABASS/.test(name)) {
    fish.add('シーバス');
    methods.push('name=シーバス');
  }
  // バス / BASS (but not シーバス)
  const nameNoSeabass = name.replace(/シーバス|SEA BASS|SEABASS/g, '');
  if (/バス|[^A-Z]BASS/.test(nameNoSeabass) || /^BASS/.test(nameNoSeabass)) {
    fish.add('ブラックバス');
    methods.push('name=バス/BASS');
  }
  // トラウト / TROUT
  if (/トラウト|TROUT/.test(name)) {
    fish.add('トラウト');
    methods.push('name=トラウト');
  }
  // アジ / AJI
  if (/アジ[^ング]|AJI[^NG]|\bAJI\b/.test(name) || /アジング/.test(name)) {
    fish.add('アジ');
    methods.push('name=アジ');
  }
  // メバル / MEBARU
  if (/メバル|MEBARU|メバリング/.test(name)) {
    fish.add('メバル');
    methods.push('name=メバル');
  }
  // ヒラメ
  if (/ヒラメ/.test(name)) {
    fish.add('ヒラメ');
    methods.push('name=ヒラメ');
  }
  // 青物 / ショア
  if (/青物|ショア|SHORE/.test(name)) {
    fish.add('青物');
    methods.push('name=青物/ショア');
  }
  // タイ / 鯛
  if (/タイ|鯛/.test(name)) {
    fish.add('マダイ');
    methods.push('name=タイ/鯛');
  }
  // チヌ / クロダイ
  if (/チヌ|クロダイ/.test(name)) {
    fish.add('クロダイ');
    methods.push('name=チヌ/クロダイ');
  }
  // イカ / SQUID
  if (/イカ|SQUID|EGI/.test(name)) {
    fish.add('アオリイカ');
    methods.push('name=イカ');
  }
  // マグロ / TUNA
  if (/マグロ|TUNA/.test(name)) {
    fish.add('マグロ');
    methods.push('name=マグロ/TUNA');
  }
  // サーモン
  if (/サーモン|SALMON/.test(name)) {
    fish.add('サーモン');
    methods.push('name=サーモン');
  }
  // ハタ
  if (/ハタ/.test(name)) {
    fish.add('ハタ');
    methods.push('name=ハタ');
  }
  // タチウオ
  if (/タチウオ/.test(name)) {
    fish.add('タチウオ');
    methods.push('name=タチウオ');
  }

  // ─── Step 3: Description keywords ────────────────────────────────────────
  if (desc) {
    if (/シーバス|SEA BASS|SEABASS/.test(desc)) {
      fish.add('シーバス');
      methods.push('desc=シーバス');
    }
    const descNoSeabass = desc.replace(/シーバス|SEA BASS|SEABASS/g, '');
    if (/ブラックバス|BLACK BASS|バス釣り|バスフィッシング/.test(desc)) {
      fish.add('ブラックバス');
      methods.push('desc=ブラックバス');
    }
    if (/トラウト|TROUT/.test(desc)) {
      fish.add('トラウト');
      methods.push('desc=トラウト');
    }
    if (/アジング|アジ[釣を]/.test(desc)) {
      fish.add('アジ');
      methods.push('desc=アジ');
    }
    if (/メバル|メバリング/.test(desc)) {
      fish.add('メバル');
      methods.push('desc=メバル');
    }
    if (/ヒラメ/.test(desc)) {
      fish.add('ヒラメ');
      methods.push('desc=ヒラメ');
    }
    if (/青物|ブリ|カンパチ|ヒラマサ|GT|ショアジギ/.test(desc)) {
      fish.add('青物');
      methods.push('desc=青物');
    }
    if (/タイラバ|マダイ|鯛/.test(desc)) {
      fish.add('マダイ');
      methods.push('desc=マダイ');
    }
    if (/チヌ|クロダイ/.test(desc)) {
      fish.add('クロダイ');
      methods.push('desc=チヌ/クロダイ');
    }
    if (/アオリイカ|エギング|イカ釣り/.test(desc)) {
      fish.add('アオリイカ');
      methods.push('desc=アオリイカ');
    }
    if (/マグロ|TUNA/.test(desc)) {
      fish.add('マグロ');
      methods.push('desc=マグロ');
    }
    if (/サーモン|SALMON/.test(desc)) {
      fish.add('サーモン');
      methods.push('desc=サーモン');
    }
    if (/タチウオ/.test(desc)) {
      fish.add('タチウオ');
      methods.push('desc=タチウオ');
    }
    if (/ハタ|ロックフィッシュ/.test(desc)) {
      fish.add('ハタ');
      methods.push('desc=ハタ/ロックフィッシュ');
    }
    if (/ナマズ/.test(desc)) {
      fish.add('ナマズ');
      methods.push('desc=ナマズ');
    }
  }

  // ─── Step 4: Manufacturer + type defaults (only if still empty) ──────────
  if (fish.size === 0) {
    if (maker === 'daiwa') {
      if (['ミノー', 'シンキングペンシル', 'ペンシルベイト', 'ポッパー', 'バイブレーション'].includes(type)) {
        // Check if bass-specific
        if (/バス|BASS|フレッシュ/.test(desc)) {
          fish.add('ブラックバス');
          methods.push('daiwa+type+desc_bass_fallback');
        } else {
          fish.add('シーバス');
          fish.add('青物');
          methods.push('daiwa+mino/spenpencil_default');
        }
      } else if (type === 'メタルジグ') {
        fish.add('青物');
        fish.add('シーバス');
        methods.push('daiwa+metaljig_default');
      } else if (type === 'クランクベイト') {
        if (/ソルト|SALT|シーバス/.test(desc)) {
          fish.add('シーバス');
          methods.push('daiwa+crank+salt_desc');
        } else {
          fish.add('ブラックバス');
          methods.push('daiwa+crankbait_default');
        }
      } else if (type === 'ワーム') {
        if (/ソルト|SALT|アジ|メバル|シーバス/.test(desc)) {
          if (/アジ/.test(desc)) fish.add('アジ');
          if (/メバル/.test(desc)) fish.add('メバル');
          if (/シーバス/.test(desc)) fish.add('シーバス');
          if (fish.size === 0) {
            fish.add('シーバス');
          }
          methods.push('daiwa+worm+salt_desc');
        } else {
          fish.add('ブラックバス');
          methods.push('daiwa+worm_default_bass');
        }
      } else if (type === 'ジグヘッド') {
        fish.add('アジ');
        fish.add('メバル');
        methods.push('daiwa+jighead_default');
      } else if (type === 'テキサスリグ' || type === 'オフセットフック') {
        fish.add('ブラックバス');
        methods.push('daiwa+texas_default');
      } else {
        // Generic DAIWA salt default for lure-type things
        fish.add('シーバス');
        fish.add('青物');
        methods.push('daiwa+generic_salt_default');
      }
    } else if (maker === 'megabass') {
      // Check description for salt
      if (/ソルト|SALT|シーバス|SEA BASS/.test(desc)) {
        fish.add('シーバス');
        methods.push('megabass+salt_desc');
      } else {
        fish.add('ブラックバス');
        methods.push('megabass+default_bass');
      }
    } else if (maker === 'evergreen') {
      if (/ソルト|SALT|シーバス/.test(desc)) {
        fish.add('シーバス');
        methods.push('evergreen+salt_desc');
      } else {
        fish.add('ブラックバス');
        methods.push('evergreen+default_bass');
      }
    } else if (maker === 'duo') {
      if (/バス|BASS|ブラック/.test(desc) && !/シーバス/.test(desc)) {
        fish.add('ブラックバス');
        methods.push('duo+bass_desc');
      } else if (/REALIS/.test(name)) {
        fish.add('ブラックバス');
        methods.push('duo+REALIS_default_bass');
      } else {
        fish.add('シーバス');
        fish.add('青物');
        methods.push('duo+default_salt');
      }
    } else if (maker === 'littlejack') {
      fish.add('シーバス');
      fish.add('青物');
      methods.push('littlejack+default_salt');
    } else {
      // Unknown maker - try to guess from type
      if (['ミノー', 'メタルジグ', 'シンキングペンシル'].includes(type)) {
        fish.add('シーバス');
        fish.add('青物');
        methods.push('unknown_maker+salt_type');
      } else if (['クランクベイト', 'スピナーベイト', 'ラバージグ'].includes(type)) {
        fish.add('ブラックバス');
        methods.push('unknown_maker+bass_type');
      }
    }
  }

  return {
    fish: Array.from(fish),
    method: methods.join(' | ') || 'no_inference',
  };
}

async function fetchAllEmpty(): Promise<LureRecord[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: LureRecord[] = [];

  while (true) {
    const { data, error } = await sb
      .from('lures')
      .select('slug, manufacturer_slug, name, type, description')
      .is('target_fish', null)
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error('Fetch error:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    all.push(...data);
    console.log(`  Fetched ${all.length} so far...`);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return all;
}

async function main() {
  console.log('=== Inferring target_fish for empty products ===\n');

  console.log('Fetching products with empty target_fish...');
  const records = await fetchAllEmpty();

  // Deduplicate by slug
  const bySlug = new Map<string, LureRecord>();
  for (const r of records) {
    if (!bySlug.has(r.slug)) {
      bySlug.set(r.slug, r);
    }
  }
  console.log(`Total rows: ${records.length}, unique slugs: ${bySlug.size}\n`);

  // Infer for each
  const results: InferResult[] = [];
  const cannotInfer: string[] = [];

  for (const [slug, r] of bySlug) {
    const { fish, method } = inferTargetFish(r);
    if (fish.length === 0) {
      cannotInfer.push(`${r.manufacturer_slug}/${slug} [type=${r.type}]`);
    }
    results.push({
      slug,
      manufacturer_slug: r.manufacturer_slug,
      name: r.name,
      type: r.type,
      target_fish: fish,
      method,
    });
  }

  console.log(`Inferred: ${results.filter(r => r.target_fish.length > 0).length}`);
  console.log(`Cannot infer (empty): ${cannotInfer.length}`);
  if (cannotInfer.length > 0) {
    console.log('\nCannot infer:');
    for (const s of cannotInfer.slice(0, 20)) console.log('  ', s);
    if (cannotInfer.length > 20) console.log(`  ... and ${cannotInfer.length - 20} more`);
  }

  // Breakdown by maker
  const makerCounts: Record<string, number> = {};
  for (const r of results) {
    if (r.target_fish.length > 0) {
      makerCounts[r.manufacturer_slug] = (makerCounts[r.manufacturer_slug] ?? 0) + 1;
    }
  }
  console.log('\nBreakdown by maker:');
  for (const [maker, count] of Object.entries(makerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${maker}: ${count}`);
  }

  // Show method distribution
  const methodCounts: Record<string, number> = {};
  for (const r of results) {
    const m = r.method.split(' | ')[0];
    methodCounts[m] = (methodCounts[m] ?? 0) + 1;
  }
  console.log('\nTop inference methods:');
  for (const [m, c] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${m}: ${c}`);
  }

  // Save backup
  const backupPath = '/Users/user/ウェブサイト/lure-database/scripts/_target-fish-inferred-2026-03-05.json';
  writeFileSync(backupPath, JSON.stringify(results, null, 2));
  console.log(`\nBackup saved: ${backupPath}`);

  // Update Supabase
  console.log('\nUpdating Supabase...');
  const toUpdate = results.filter(r => r.target_fish.length > 0);
  let updated = 0;
  let errors = 0;
  const errorList: string[] = [];

  for (let i = 0; i < toUpdate.length; i++) {
    const r = toUpdate[i];
    const { error } = await sb
      .from('lures')
      .update({ target_fish: r.target_fish })
      .eq('slug', r.slug)
      .eq('manufacturer_slug', r.manufacturer_slug);

    if (error) {
      errors++;
      errorList.push(`${r.slug}: ${error.message}`);
      if (errors <= 5) console.error(`  ERROR: ${r.slug}: ${error.message}`);
    } else {
      updated++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  Progress: ${i + 1}/${toUpdate.length} (updated=${updated}, errors=${errors})`);
    }
  }

  console.log('\n========================================');
  console.log('DONE');
  console.log(`  Updated: ${updated}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Skipped (no inference): ${cannotInfer.length}`);
  console.log('========================================');

  if (errorList.length > 0) {
    console.log('\nErrors:');
    for (const e of errorList) console.log('  ', e);
  }
}

main().catch(console.error);
