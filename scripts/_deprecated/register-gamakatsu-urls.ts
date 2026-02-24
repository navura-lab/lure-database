#!/usr/bin/env npx tsx
// scripts/register-gamakatsu-urls.ts
// One-shot script to register all Gamakatsu (LUXXE) lure product URLs into Airtable.
//
// Uses the WP REST API to fetch products in the "lure" category (p_category=108),
// then filters to only genuine lure bodies (excluding hooks, jigheads, sinkers, etc.).
//
// Usage:
//   cd lure-database
//   npx tsx scripts/register-gamakatsu-urls.ts [--dry-run]

import 'dotenv/config';
import {
  AIRTABLE_PAT,
  AIRTABLE_BASE_ID,
  AIRTABLE_LURE_URL_TABLE_ID,
  AIRTABLE_MAKER_TABLE_ID,
  AIRTABLE_API_BASE,
} from './config.js';

var DRY_RUN = process.argv.includes('--dry-run');
var GAMAKATSU_BASE = 'https://www.gamakatsu.co.jp';

// 37 confirmed lure body product IDs (hooks, jigheads, sinkers, leaders, rigs excluded)
var LURE_PRODUCT_IDS = [
  // AVENGE series (hard baits)
  '80-604', // アベンジクランク 400
  '80-610', // アベンジクランク 100
  '80-600', // アベンジバイブ 58
  '80-601', // アベンジプロップ 80
  '80-713', // アベンジスピン
  '80-611', // アベンジミノー 110F
  '80-608', // アベンジミノー 170
  // Soft baits
  '80-602', // ほぼザリ
  '80-607', // ラフィン 170
  '80-619', // ラフィン 250
  '80-613', // ラフィン 300
  '80-612', // アヴィック 7インチ
  '80-620', // ジュリー 5インチ
  // Speed Metal / Sutte
  '19-325', // スピードメタル タイプDI
  '80-609', // スピードメタル タイプ2
  '19-353', // スピードメタル タイプ3
  '19-398', // スピードメタル タイプ3 チューンドバージョン
  '19290',  // スピードメタルスッテ
  '19285',  // スピードメタルスッテ タイプ2
  // Octorize (octopus)
  '19-417', // オクトライズ ウキウキクロー
  '19-335', // オクトライズ ノリノリクロー
  '19-336', // オクトライズ ノリノリクロー ジャンボ
  '19-418', // オクトライズ グイグイオクトパス
  '19-427', // オクトライズ ブイブイタコベイト
  '80606',  // オクトライズ ゴリゴリジグ
  // Evoridge (egi)
  '19269',  // エヴォリッジ デッドフォールLTD
  '19221',  // エヴォリッジ ベーシックモデル
  '19233',  // エヴォリッジ グロウンアップ
  // 宵姫 worms (light game)
  '19-347', // 宵姫 エクボ 2.2インチ
  '19327',  // 宵姫 ノレソレ 3インチ
  '19241',  // 宵姫 ノレソレ 1.8インチ
  '19306',  // 宵姫 トレモロAJ 2.6インチ
  '19261',  // 宵姫 アーミーシャッド 2.8インチ
  '19240',  // 宵姫 トレモロ 2.2インチ
  // Others
  '19276',  // 桜幻 鯛ラバーQ II
  '19-191', // スパット MR-65
  '68041',  // マダラトレーラー
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[gamakatsu-urls] ${msg}`);
}

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

async function airtableFetch(path: string, options: RequestInit = {}) {
  var url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${path}`;
  var res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    var text = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function findOrCreateMaker(): Promise<string> {
  var data = await airtableFetch(
    `${AIRTABLE_MAKER_TABLE_ID}?filterByFormula=SEARCH("がまかつ",{メーカー名})`,
  );
  if (data.records && data.records.length > 0) {
    log(`Found existing がまかつ maker record: ${data.records[0].id}`);
    return data.records[0].id;
  }

  if (DRY_RUN) {
    log('[DRY-RUN] Would create がまかつ maker record');
    return 'DRY_RUN_MAKER_ID';
  }

  var created = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
    method: 'POST',
    body: JSON.stringify({
      records: [
        {
          fields: {
            'メーカー名': 'がまかつ',
            'URL': 'https://www.gamakatsu.co.jp',
            'Slug': 'gamakatsu',
          },
        },
      ],
    }),
  });
  var makerId = created.records[0].id;
  log(`Created がまかつ maker record: ${makerId}`);
  return makerId;
}

async function getExistingUrls(): Promise<Set<string>> {
  var urls = new Set<string>();
  var offset: string | undefined;

  do {
    var params = new URLSearchParams({
      filterByFormula: 'SEARCH("gamakatsu.co.jp",{URL})',
      'fields[]': 'URL',
      pageSize: '100',
    });
    if (offset) params.set('offset', offset);

    var data = await airtableFetch(`${AIRTABLE_LURE_URL_TABLE_ID}?${params}`);
    for (var rec of data.records || []) {
      if (rec.fields?.URL) urls.add(rec.fields.URL);
    }
    offset = data.offset;
  } while (offset);

  return urls;
}

async function fetchProductName(productId: string): Promise<string> {
  try {
    var res = await fetch(`${GAMAKATSU_BASE}/wp-json/wp/v2/products?slug=${productId}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.ok) {
      var data = await res.json();
      if (data.length > 0 && data[0].title?.rendered) {
        return data[0].title.rendered.replace(/<[^>]+>/g, '').trim();
      }
    }
  } catch (e) {
    // Ignore — will use product ID as fallback name
  }
  return productId;
}

async function createLureRecords(
  records: { name: string; url: string }[],
  makerId: string,
) {
  for (var i = 0; i < records.length; i += 10) {
    var batch = records.slice(i, i + 10);
    var payload = {
      records: batch.map(function (r) {
        return {
          fields: {
            'ルアー名': r.name,
            'URL': r.url,
            'メーカー': [makerId],
            'ステータス': '未処理',
          },
        };
      }),
    };

    if (DRY_RUN) {
      log(`[DRY-RUN] Would create ${batch.length} records (batch ${Math.floor(i / 10) + 1})`);
      for (var j = 0; j < batch.length; j++) {
        log(`  ${batch[j].name}: ${batch[j].url}`);
      }
      continue;
    }

    await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    log(`Created ${batch.length} records (batch ${Math.floor(i / 10) + 1})`);

    // Rate limit: Airtable allows 5 requests/sec
    if (i + 10 < records.length) {
      await new Promise(function (r) { setTimeout(r, 250); });
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');
  log(`Total lure product IDs: ${LURE_PRODUCT_IDS.length}`);

  // 1. Build URL list with names from WP REST API
  log('Fetching product names from WP REST API...');
  var allRecords: { name: string; url: string }[] = [];

  for (var i = 0; i < LURE_PRODUCT_IDS.length; i++) {
    var id = LURE_PRODUCT_IDS[i];
    var url = `${GAMAKATSU_BASE}/products/${id}/`;
    var name = await fetchProductName(id);
    allRecords.push({ name: name, url: url });

    if (i > 0 && i % 10 === 0) {
      log(`  Fetched ${i}/${LURE_PRODUCT_IDS.length} names...`);
      await new Promise(function (r) { setTimeout(r, 200); });
    }
  }
  log(`Built ${allRecords.length} product records`);

  // 2. Check existing Airtable records
  var existingUrls = await getExistingUrls();
  log(`Existing Gamakatsu URLs in Airtable: ${existingUrls.size}`);

  // 3. Filter new URLs
  var newRecords: { name: string; url: string }[] = [];
  for (var j = 0; j < allRecords.length; j++) {
    if (!existingUrls.has(allRecords[j].url)) {
      newRecords.push(allRecords[j]);
    }
  }
  log(`New URLs to register: ${newRecords.length}`);

  if (newRecords.length === 0) {
    log('No new URLs to register. Done.');
    return;
  }

  // 4. Ensure maker record exists
  var makerId = await findOrCreateMaker();

  // 5. Create lure URL records
  await createLureRecords(newRecords, makerId);

  log(`Done! Registered ${newRecords.length} Gamakatsu lure URLs.`);
}

main().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
