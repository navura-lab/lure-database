#!/usr/bin/env node
// scripts/register-gary-yamamoto-urls.mjs
// One-shot script to register all Gary Yamamoto lure product URLs into Airtable.
//
// 1. Fetches all product sitemap XMLs
// 2. Crawls category pages (gary/ and yabai/)
// 3. Filters out non-lure pages (apparel, stickers, hooks, sinkers, category indices)
// 4. Creates a Gary Yamamoto maker record in Airtable (if not exists)
// 5. Creates lure URL records in Airtable with status "未処理"
//
// Usage:
//   cd /Users/user/clawd/micro-saas-factory/lure-database
//   set -a && source .env && set +a
//   node scripts/register-gary-yamamoto-urls.mjs [--dry-run]

var DRY_RUN = process.argv.indexOf('--dry-run') !== -1;

var AIRTABLE_PAT = process.env.AIRTABLE_PAT;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
var AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID;
var AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID;
var AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

var GARY_BASE = 'https://www.gary-yamamoto.com';

// All product sitemap URLs discovered from the sitemap index
var SITEMAP_URLS = [
  GARY_BASE + '/sitemap-pt-products-2022-11.xml',
  GARY_BASE + '/sitemap-pt-products-2021-08.xml',
  GARY_BASE + '/sitemap-pt-products-2021-03.xml',
  GARY_BASE + '/sitemap-pt-products-2020-12.xml',
  GARY_BASE + '/sitemap-pt-products-2020-08.xml',
  GARY_BASE + '/sitemap-pt-products-2020-06.xml',
  GARY_BASE + '/sitemap-pt-products-2020-02.xml',
  GARY_BASE + '/sitemap-pt-products-2020-01.xml',
  GARY_BASE + '/sitemap-pt-products-2019-12.xml',
  GARY_BASE + '/sitemap-pt-products-2019-07.xml',
];

var CATEGORY_PAGES = [
  GARY_BASE + '/products/gary/',
  GARY_BASE + '/products/yabai/',
];

// ---------------------------------------------------------------------------
// Exclusion patterns
// ---------------------------------------------------------------------------

// Category index pages (these list products, not individual product pages)
var CATEGORY_INDEX_SLUGS = [
  '/products/gary',
  '/products/yabai',
  '/products/gary/singletailgrub',
  '/products/gary/doubletailgrub',
  '/products/gary/kuttailworm',
  '/products/gary/yamasenko',
  '/products/gary/swimsenko',
  '/products/gary/curlytail',
  '/products/gary/shrimp',
  '/products/gary/craw',
  '/products/gary/legworm',
  '/products/gary/hearttail',
  '/products/gary/mokory_craw',
  '/products/gary/detrator',
  '/products/gary/dshu',
  '/products/gary/angry',
  '/products/gary/californiaroll',
  '/products/gary/kreature',
  '/products/gary/yamafrog',
  '/products/gary/sanshouo',
  '/products/gary/pintail',
  '/products/gary/dddshad',
  '/products/gary/lizard',
  '/products/gary/flattail',
  '/products/gary/swimbait',
  '/products/gary/grubguard',
  '/products/gary/lightika',
  '/products/gary/hugger',
  '/products/gary/a-ok',
  '/products/gary/yamatanuki',
  '/products/gary/yamamimizu',
  '/products/gary/ecobait',
  '/products/gary/saltwater',
  '/products/gary/spinnerbait',
  '/products/gary/buzz-bait',
  '/products/gary/hook_sinker',
  '/products/gary/apparel',
  '/products/gary/sticker',
  '/products/gary/dvd',
  '/products/yabai/funa-bait',
  '/products/yabai/funa-bud',
  '/products/yabai/chuppa',
  '/products/yabai/pop-slash',
  '/products/yabai/crank-dump',
  '/products/yabai/crank-rodeor',
  '/products/yabai/crank-mdz',
  '/products/yabai/geek-prop',
  '/products/yabai/buzz',
  '/products/yabai/spin',
  '/products/yabai/kappafrog',
  '/products/yabai/tikitiki',
  '/products/yabai/nyantama',
  '/products/yabai/apparely',
  '/products/yabai/yabaisticker',
  '/products/yabai/yabaidvd',
];

// Exact slug matches to exclude (apparel, accessories, hooks, sinkers, stickers, DVD)
var EXCLUDED_EXACT_SLUGS = [
  'meshcap', 'cap2', 'lightningcap', 'flatbillcap', 'flatbillmeshcap', 'sunvisor',
  'tshirt', 'drytshirt', 'longtshirt', 'yamamoto_tshirt', 'hoodjacket',
  'sticker', 'gy-sticker', 'dokuro-sticker', 'dokuro-sticker-mini', 'cutting-sticker', 'ban18-sticker',
  'sugoihook', 'sugoihookonikko', 'specialhook', 'footballjighead',
  'sugoisinker', 'tiki-tiki-sinker', 'nyantamasinker',
  'yabai-meshcap', 'yabaiflatbillmeshcap',
  'yabai-low-cap', 'yabai-sunvisor',
  'yabaiapparel',
  'kawabe01',  // DVD
];

// Keyword substrings in the decoded slug that indicate non-lure items
var EXCLUDED_KEYWORDS = [
  'sticker', 'meshcap', 'tshirt', 'sunvisor', 'cap\uff09', 'low-cap',
  'hoodjacket', 'apparel', '\u30b5\u30f3\u30d0\u30a4\u30b6\u30fc',
  '\u30ad\u30e3\u30c3\u30d7', // "キャップ" = cap in Japanese
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

var log = function(msg) {
  console.log('[gary-yamamoto-urls] ' + msg);
};

var sleep = function(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

// ---------------------------------------------------------------------------
// URL collection
// ---------------------------------------------------------------------------

var fetchSitemapUrls = function() {
  var allUrls = [];
  
  var fetchOne = function(i) {
    if (i >= SITEMAP_URLS.length) {
      return Promise.resolve(allUrls);
    }
    return fetch(SITEMAP_URLS[i]).then(function(r) { return r.text(); }).then(function(xml) {
      var locRegex = /<loc>([^<]+)<\/loc>/g;
      var m;
      while ((m = locRegex.exec(xml)) !== null) {
        allUrls.push(m[1]);
      }
      log('Sitemap ' + (i + 1) + '/' + SITEMAP_URLS.length + ': total ' + allUrls.length + ' URLs');
      return fetchOne(i + 1);
    });
  };
  
  return fetchOne(0);
};

var fetchCategoryUrls = function() {
  var allUrls = [];
  
  var fetchOne = function(i) {
    if (i >= CATEGORY_PAGES.length) {
      return Promise.resolve(allUrls);
    }
    return fetch(CATEGORY_PAGES[i]).then(function(r) { return r.text(); }).then(function(html) {
      var linkRegex = /href="(https:\/\/www\.gary-yamamoto\.com\/products\/[^"]+)"/g;
      var m;
      while ((m = linkRegex.exec(html)) !== null) {
        var url = m[1].replace(/\/$/, '');
        if (allUrls.indexOf(url) === -1) {
          allUrls.push(url);
        }
      }
      log('Category page ' + (i + 1) + '/' + CATEGORY_PAGES.length + ': total ' + allUrls.length + ' URLs');
      return fetchOne(i + 1);
    });
  };
  
  return fetchOne(0);
};

// ---------------------------------------------------------------------------
// URL filtering
// ---------------------------------------------------------------------------

var isExcludedUrl = function(url) {
  // Parse the path from the URL
  var path;
  try {
    path = new URL(url).pathname;
  } catch (e) {
    return true; // Malformed URL
  }
  
  // Remove trailing slash for comparison
  var cleanPath = path.replace(/\/$/, '');
  
  // Check if it's a category index page
  for (var i = 0; i < CATEGORY_INDEX_SLUGS.length; i++) {
    if (cleanPath === CATEGORY_INDEX_SLUGS[i]) {
      return true;
    }
  }
  
  // Must be under /products/ (not just /products itself)
  if (!cleanPath.startsWith('/products/')) {
    return true;
  }
  
  // Extract the slug (last part of the path)
  var parts = cleanPath.split('/');
  var rawSlug = parts[parts.length - 1].toLowerCase();
  var decodedSlug = '';
  try {
    decodedSlug = decodeURIComponent(rawSlug);
  } catch (e) {
    decodedSlug = rawSlug;
  }
  
  // Check excluded exact slugs (match against both raw and decoded)
  for (var j = 0; j < EXCLUDED_EXACT_SLUGS.length; j++) {
    var excludeSlug = EXCLUDED_EXACT_SLUGS[j].toLowerCase();
    if (rawSlug === excludeSlug || decodedSlug === excludeSlug) {
      return true;
    }
    // Also check if the decoded slug starts with the excluded slug
    // (handles cases like "yabai-sunvisor（ヤバイサンバイザー）")
    if (decodedSlug.startsWith(excludeSlug)) {
      return true;
    }
  }
  
  // Check excluded keywords in decoded slug
  for (var k = 0; k < EXCLUDED_KEYWORDS.length; k++) {
    if (decodedSlug.indexOf(EXCLUDED_KEYWORDS[k]) !== -1) {
      return true;
    }
  }
  
  return false;
};

// ---------------------------------------------------------------------------
// Airtable helpers
// ---------------------------------------------------------------------------

var airtableFetch = function(path, options) {
  options = options || {};
  var url = AIRTABLE_API_BASE + '/' + AIRTABLE_BASE_ID + '/' + path;
  var headers = {
    'Authorization': 'Bearer ' + AIRTABLE_PAT,
    'Content-Type': 'application/json',
  };
  if (options.headers) {
    Object.keys(options.headers).forEach(function(k) {
      headers[k] = options.headers[k];
    });
  }
  
  return fetch(url, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body,
  }).then(function(res) {
    if (!res.ok) {
      return res.text().then(function(text) {
        throw new Error('Airtable API error ' + res.status + ': ' + text);
      });
    }
    return res.json();
  });
};

var findOrCreateMaker = function() {
  var filter = encodeURIComponent('SEARCH("gary-yamamoto",LOWER({Slug}))');
  return airtableFetch(AIRTABLE_MAKER_TABLE_ID + '?filterByFormula=' + filter).then(function(data) {
    if (data.records && data.records.length > 0) {
      log('Found existing Gary Yamamoto maker record: ' + data.records[0].id);
      return data.records[0].id;
    }
    
    if (DRY_RUN) {
      log('[DRY-RUN] Would create Gary Yamamoto maker record');
      return 'DRY_RUN_MAKER_ID';
    }
    
    return airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify({
        records: [{
          fields: {
            '\u30e1\u30fc\u30ab\u30fc\u540d': 'Gary Yamamoto Custom Baits',
            'URL': 'https://www.gary-yamamoto.com',
            'Slug': 'gary-yamamoto',
          },
        }],
      }),
    }).then(function(created) {
      var makerId = created.records[0].id;
      log('Created Gary Yamamoto maker record: ' + makerId);
      return makerId;
    });
  });
};

var getExistingUrls = function() {
  var urls = new Set();
  
  var fetchPage = function(offset) {
    var params = new URLSearchParams({
      'filterByFormula': 'SEARCH("gary-yamamoto.com",{URL})',
      'fields[]': 'URL',
      'pageSize': '100',
    });
    if (offset) params.set('offset', offset);
    
    return airtableFetch(AIRTABLE_LURE_URL_TABLE_ID + '?' + params.toString()).then(function(data) {
      (data.records || []).forEach(function(rec) {
        if (rec.fields && rec.fields.URL) urls.add(rec.fields.URL);
      });
      if (data.offset) {
        return fetchPage(data.offset);
      }
      return urls;
    });
  };
  
  return fetchPage(null);
};

var createLureRecords = function(urls, makerId) {
  var totalCreated = 0;
  var totalBatches = Math.ceil(urls.length / 10);
  
  var processBatch = function(i) {
    if (i >= urls.length) {
      return Promise.resolve(totalCreated);
    }
    
    var batch = urls.slice(i, i + 10);
    var batchNum = Math.floor(i / 10) + 1;
    
    var payload = {
      records: batch.map(function(url) {
        // Extract a name from the URL slug
        var parts = url.split('/');
        var slug = parts[parts.length - 1];
        var name = '';
        try {
          name = decodeURIComponent(slug);
        } catch (e) {
          name = slug;
        }
        
        return {
          fields: {
            '\u30eb\u30a2\u30fc\u540d': name,
            'URL': url,
            '\u30e1\u30fc\u30ab\u30fc': [makerId],
            '\u30b9\u30c6\u30fc\u30bf\u30b9': '\u672a\u51e6\u7406',
          },
        };
      }),
    };
    
    if (DRY_RUN) {
      log('[DRY-RUN] Would create ' + batch.length + ' records (batch ' + batchNum + '/' + totalBatches + ')');
      batch.forEach(function(u) { log('  ' + u); });
      totalCreated += batch.length;
      return processBatch(i + 10);
    }
    
    return airtableFetch(AIRTABLE_LURE_URL_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then(function() {
      totalCreated += batch.length;
      log('Created ' + batch.length + ' records (batch ' + batchNum + '/' + totalBatches + ') - total: ' + totalCreated);
      
      // Rate limit: Airtable allows 5 requests/sec, wait 250ms between batches
      if (i + 10 < urls.length) {
        return sleep(250).then(function() { return processBatch(i + 10); });
      }
      return totalCreated;
    });
  };
  
  return processBatch(0);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

var main = function() {
  log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== LIVE MODE ===');
  log('');
  
  var sitemapUrls, categoryUrls;
  
  // Step 1: Collect URLs from sitemaps
  log('--- Step 1: Fetching sitemap URLs ---');
  return fetchSitemapUrls().then(function(urls) {
    sitemapUrls = urls;
    log('Sitemap URLs collected: ' + sitemapUrls.length);
    log('');
    
    // Step 2: Collect URLs from category pages
    log('--- Step 2: Fetching category page URLs ---');
    return fetchCategoryUrls();
  }).then(function(urls) {
    categoryUrls = urls;
    log('Category page URLs collected: ' + categoryUrls.length);
    log('');
    
    // Step 3: Merge and deduplicate
    log('--- Step 3: Merging and deduplicating ---');
    var urlSet = new Set();
    
    sitemapUrls.forEach(function(u) {
      urlSet.add(u.replace(/\/$/, ''));
    });
    categoryUrls.forEach(function(u) {
      urlSet.add(u.replace(/\/$/, ''));
    });
    
    var allUrls = Array.from(urlSet);
    log('Total unique URLs (before filtering): ' + allUrls.length);
    
    // Step 4: Filter
    log('--- Step 4: Filtering ---');
    var filtered = [];
    var excluded = [];
    
    allUrls.forEach(function(url) {
      if (isExcludedUrl(url)) {
        excluded.push(url);
      } else {
        filtered.push(url);
      }
    });
    
    log('Excluded URLs (' + excluded.length + '):');
    excluded.sort().forEach(function(u) { log('  EXCLUDED: ' + u); });
    log('');
    log('Kept URLs (' + filtered.length + '):');
    filtered.sort().forEach(function(u) { log('  KEEP: ' + u); });
    log('');
    
    // Step 5: Check existing Airtable records
    log('--- Step 5: Checking existing Airtable records ---');
    return getExistingUrls().then(function(existingUrls) {
      log('Existing gary-yamamoto URLs in Airtable: ' + existingUrls.size);
      
      var newUrls = filtered.filter(function(u) {
        return !existingUrls.has(u);
      });
      log('New URLs to register: ' + newUrls.length);
      
      if (newUrls.length === 0) {
        log('No new URLs to register. Done.');
        return 0;
      }
      
      // Sort for consistent ordering
      newUrls.sort();
      
      // Step 6: Ensure maker record exists
      log('');
      log('--- Step 6: Creating/finding maker record ---');
      return findOrCreateMaker().then(function(makerId) {
        // Step 7: Create lure URL records
        log('');
        log('--- Step 7: Creating lure URL records ---');
        return createLureRecords(newUrls, makerId);
      });
    });
  }).then(function(count) {
    log('');
    log('=== DONE ===');
    log('Total URLs registered: ' + count);
    return count;
  });
};

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
