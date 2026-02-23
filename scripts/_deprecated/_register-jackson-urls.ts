// scripts/_register-jackson-urls.ts
// Register Jackson lure URLs into Airtable.
// Step 1: Create Jackson maker record if it doesn't exist.
// Step 2: Create 120 lure URL records linked to the maker.
//
// Usage: cd lure-database && npx tsx scripts/_register-jackson-urls.ts [--dry-run]

import 'dotenv/config';

var AIRTABLE_PAT = process.env.AIRTABLE_PAT!;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
var AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID!;
var AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID!;
var DRY_RUN = process.argv.includes('--dry-run');

var AIRTABLE_API = 'https://api.airtable.com/v0';

// ---------------------------------------------------------------------------
// Jackson lure URLs (120 products — rods and accessories excluded)
// ---------------------------------------------------------------------------

var JACKSON_URLS = [
  'https://jackson.jp/products/agesage-magic',
  'https://jackson.jp/products/aji-pearl',
  'https://jackson.jp/products/athlete-105-svg-fvg',
  'https://jackson.jp/products/athlete-12-fs-vg-14-fs-vg',
  'https://jackson.jp/products/athlete-12ss-14ss',
  'https://jackson.jp/products/athlete-12ssp-14ssp',
  'https://jackson.jp/products/athlete-12ssv-14ssv',
  'https://jackson.jp/products/athlete-13mds',
  'https://jackson.jp/products/athlete-17ssv-17fsv',
  'https://jackson.jp/products/athlete-45-svg-light-game',
  'https://jackson.jp/products/athlete-45ll-mebaru-tune',
  'https://jackson.jp/products/athlete-50sw',
  'https://jackson.jp/products/athlete-55ll-mebaru-tune',
  'https://jackson.jp/products/athlete-55s-fh',
  'https://jackson.jp/products/athlete-60jt',
  'https://jackson.jp/products/athlete-70ll-ft',
  'https://jackson.jp/products/athlete-70sf',
  'https://jackson.jp/products/athlete-9jm',
  'https://jackson.jp/products/athlete-dart-sp',
  'https://jackson.jp/products/athlete105ssp',
  'https://jackson.jp/products/batabata-magic',
  'https://jackson.jp/products/bone-bait',
  'https://jackson.jp/products/bone-bait-jr',
  'https://jackson.jp/products/bottom-magic',
  'https://jackson.jp/products/bubble-magic-floating',
  'https://jackson.jp/products/bubble-magic-sinking',
  'https://jackson.jp/products/buggy-spinner',
  'https://jackson.jp/products/buri-buri-spare-worm',
  'https://jackson.jp/products/buri-buri-worm',
  'https://jackson.jp/products/chinukoro-craw',
  'https://jackson.jp/products/chinukoro-hog',
  'https://jackson.jp/products/chinukoro-vibe',
  'https://jackson.jp/products/chinukorori',
  'https://jackson.jp/products/clear-s',
  'https://jackson.jp/products/clear-s-popper',
  'https://jackson.jp/products/cyarl-blade',
  'https://jackson.jp/products/daniel-head-rock',
  'https://jackson.jp/products/dart-magic-area-renewal',
  'https://jackson.jp/products/dart-magic-native-color',
  'https://jackson.jp/products/deception110',
  'https://jackson.jp/products/deception135',
  'https://jackson.jp/products/eddy',
  'https://jackson.jp/products/finesse-head',
  'https://jackson.jp/products/finesse-head-power',
  'https://jackson.jp/products/freak-set',
  'https://jackson.jp/products/freak-worm',
  'https://jackson.jp/products/g-control-20',
  'https://jackson.jp/products/g-control-28',
  'https://jackson.jp/products/g-control-28-with-storong-hook',
  'https://jackson.jp/products/g-control-40',
  'https://jackson.jp/products/gallop-assist-fall-edition',
  'https://jackson.jp/products/gallop-baby',
  'https://jackson.jp/products/heko-heko-magic',
  'https://jackson.jp/products/honoka',
  'https://jackson.jp/products/jester-minnow-78s',
  'https://jackson.jp/products/kaedango',
  'https://jackson.jp/products/kanade',
  'https://jackson.jp/products/kraber',
  'https://jackson.jp/products/kurokawamushi',
  'https://jackson.jp/products/maccheroni',
  'https://jackson.jp/products/maccheroni-2',
  'https://jackson.jp/products/masu-danshaku',
  'https://jackson.jp/products/metal-effect-bait-tune',
  'https://jackson.jp/products/metal-effect-blade',
  'https://jackson.jp/products/metal-effect-long-cast',
  'https://jackson.jp/products/metal-effect-sagoshi-tune',
  'https://jackson.jp/products/metal-effect-stay-fall-10g-15g',
  'https://jackson.jp/products/metal-effect-stay-fall-20g-30g-40g-60g',
  'https://jackson.jp/products/metal-effect-stay-fall-80g-100g',
  'https://jackson.jp/products/meteora-45-52',
  'https://jackson.jp/products/meteora-45-52-2',
  'https://jackson.jp/products/meteora-63-70',
  'https://jackson.jp/products/meteora-80',
  'https://jackson.jp/products/mijinko',
  'https://jackson.jp/products/muscle-shot',
  'https://jackson.jp/products/nyoro-nyoro-85-105-125',
  'https://jackson.jp/products/pintail-35',
  'https://jackson.jp/products/pintail-ez-28',
  'https://jackson.jp/products/pintail-sagoshi-tune',
  'https://jackson.jp/products/pintail-sagoshi-tune-28g-with-storong-hook',
  'https://jackson.jp/products/pintail-sawara-tune',
  'https://jackson.jp/products/pintail-sawara-tune-with-storong-hook',
  'https://jackson.jp/products/pintail-tune-170svg',
  'https://jackson.jp/products/pipi-shad',
  'https://jackson.jp/products/plunge-100g120g150g',
  'https://jackson.jp/products/plunge-55g-70g85g',
  'https://jackson.jp/products/prowler',
  'https://jackson.jp/products/puriebi',
  'https://jackson.jp/products/py-popper',
  'https://jackson.jp/products/py-shad',
  'https://jackson.jp/products/py-shallow-minnow',
  'https://jackson.jp/products/quick-head',
  'https://jackson.jp/products/quick-set',
  'https://jackson.jp/products/quick-shad',
  'https://jackson.jp/products/r-a-pop',
  'https://jackson.jp/products/resist',
  'https://jackson.jp/products/ryusen',
  'https://jackson.jp/products/sakedanshaku',
  'https://jackson.jp/products/sakeshogun',
  'https://jackson.jp/products/shallow-swimmer125',
  'https://jackson.jp/products/standard-head',
  'https://jackson.jp/products/sunadango',
  'https://jackson.jp/products/tachijig',
  'https://jackson.jp/products/teppan-blade-15g-20g-28g',
  'https://jackson.jp/products/teppan-long',
  'https://jackson.jp/products/teppan-strong',
  'https://jackson.jp/products/teppan-vib-3g-5g-7g',
  'https://jackson.jp/products/teppan-vib-9g-14g-20g-26g',
  'https://jackson.jp/products/tobisugi-daniel-14g-20g-30g-40g',
  'https://jackson.jp/products/tobisugi-daniel-14g-20g-30g-40g-with-storong-hook',
  'https://jackson.jp/products/tobisugi-daniel-1g',
  'https://jackson.jp/products/tobisugi-daniel-3g-5g',
  'https://jackson.jp/products/tobisugi-daniel-blade-30g-40g',
  'https://jackson.jp/products/tobisugi-daniel-blade-30g-40g-with-storong-hook',
  'https://jackson.jp/products/tobisugi-daniel-blade-7g-10g',
  'https://jackson.jp/products/trout-tune',
  'https://jackson.jp/products/tube-magic',
  'https://jackson.jp/products/unyounyo',
  'https://jackson.jp/products/zig-zag-magic',
  'https://jackson.jp/products/zurubiki-goby',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function airtableFetch(tableId: string, path: string, options: RequestInit = {}): Promise<any> {
  var url = `${AIRTABLE_API}/${AIRTABLE_BASE_ID}/${tableId}${path}`;
  var res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    var body = await res.text();
    throw new Error(`Airtable API ${res.status}: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`Jackson URL Registration — ${JACKSON_URLS.length} URLs${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // Step 1: Find or create Jackson maker record
  log('Step 1: Finding/creating Jackson maker record...');
  var filter = encodeURIComponent("{Slug}='jackson'");
  var makerData = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, `?filterByFormula=${filter}&fields%5B%5D=Slug`);

  var makerRecordId: string;
  if (makerData.records.length > 0) {
    makerRecordId = makerData.records[0].id;
    log(`  Found existing maker record: ${makerRecordId}`);
  } else {
    if (DRY_RUN) {
      log('  [DRY RUN] Would create Jackson maker record');
      makerRecordId = 'DRY_RUN_MAKER_ID';
    } else {
      var createRes = await airtableFetch(AIRTABLE_MAKER_TABLE_ID, '', {
        method: 'POST',
        body: JSON.stringify({
          records: [{ fields: { 'メーカー名': 'Jackson', 'Slug': 'jackson' } }],
        }),
      });
      makerRecordId = createRes.records[0].id;
      log(`  Created maker record: ${makerRecordId}`);
    }
  }

  // Step 2: Check existing URLs to avoid duplicates
  log('Step 2: Checking existing URLs...');
  var existingUrls = new Set<string>();
  var offset: string | undefined;
  do {
    var qs = 'fields%5B%5D=URL&filterByFormula=' + encodeURIComponent('SEARCH("jackson.jp", {URL})');
    if (offset) qs += '&offset=' + encodeURIComponent(offset);

    var urlData = await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, `?${qs}`);
    for (var rec of urlData.records) {
      if (rec.fields.URL) existingUrls.add(rec.fields.URL);
    }
    offset = urlData.offset;
  } while (offset);
  log(`  Found ${existingUrls.size} existing Jackson URLs`);

  // Step 3: Register new URLs
  var newUrls = JACKSON_URLS.filter(function (u) { return !existingUrls.has(u); });
  log(`Step 3: Registering ${newUrls.length} new URLs (${JACKSON_URLS.length - newUrls.length} already exist)`);

  if (DRY_RUN) {
    log('[DRY RUN] Would register:');
    for (var u of newUrls) {
      log(`  ${u}`);
    }
    log(`[DRY RUN] Total: ${newUrls.length} new URLs`);
    return;
  }

  // Batch create in groups of 10 (Airtable limit)
  var created = 0;
  for (var i = 0; i < newUrls.length; i += 10) {
    var batch = newUrls.slice(i, i + 10);
    var records = batch.map(function (url) {
      // Extract product name from slug for ルアー名
      var slug = url.replace('https://jackson.jp/products/', '');
      var name = slug.replace(/-/g, ' ');
      return {
        fields: {
          'ルアー名': name,
          'URL': url,
          'メーカー': [makerRecordId],
          'ステータス': '未処理',
        },
      };
    });

    await airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, '', {
      method: 'POST',
      body: JSON.stringify({ records: records }),
    });
    created += batch.length;
    log(`  Created ${created}/${newUrls.length} records...`);

    // Rate limit: 5 requests/sec
    if (i + 10 < newUrls.length) {
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
    }
  }

  log(`Done! Created ${created} URL records linked to Jackson maker (${makerRecordId})`);
}

main().catch(function (err) {
  console.error('FATAL:', err);
  process.exit(1);
});
