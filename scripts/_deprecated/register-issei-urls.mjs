#!/usr/bin/env node
// scripts/register-issei-urls.mjs
// One-shot script to register all issei lure product URLs into Airtable.
//
// 1. Fetches WordPress post-type sitemaps for bass (green_cray_fish) and salt (umitaro) products
// 2. Parses <loc> URLs from the XML
// 3. Deduplicates and filters out non-product pages
// 4. Creates an issei maker record in Airtable (if not exists)
// 5. Creates lure URL records in Airtable with status "未処理"
//
// Usage:
//   cd /Users/user/clawd/micro-saas-factory/lure-database
//   set -a && source .env && set +a
//   node scripts/register-issei-urls.mjs [--dry-run]

var DRY_RUN = process.argv.indexOf('--dry-run') !== -1;

var AIRTABLE_PAT = process.env.AIRTABLE_PAT;
var AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
var AIRTABLE_LURE_URL_TABLE_ID = process.env.AIRTABLE_LURE_URL_TABLE_ID;
var AIRTABLE_MAKER_TABLE_ID = process.env.AIRTABLE_MAKER_TABLE_ID;
var AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

var ISSEI_BASE = 'https://issei.tv';

// WordPress post-type sitemaps
var SITEMAP_URLS = [
  ISSEI_BASE + '/wp-sitemap-posts-green_cray_fish-1.xml',  // bass products
  ISSEI_BASE + '/wp-sitemap-posts-umitaro-1.xml',           // salt products
];

// ---------------------------------------------------------------------------
// Exclusion patterns
// ---------------------------------------------------------------------------

// URL path segments that indicate rod, accessory, or other non-lure categories.
// issei uses WordPress custom post types with taxonomy-based category slugs
// embedded in the URL path.
var EXCLUDED_PATH_SEGMENTS = [
  '/rod/',
  '/acc/',
  '/oln/',        // online-shop / other non-lure
  '/r_ame/',      // rod - ame (salt rod subcategory)
  '/r_rock/',
  '/r_tachi/',
  '/r_jigging/',
  '/r_slj/',
  '/r_vcon/',
  '/r_ikame/',
  '/r_shcas/',
  '/r_tairb/',
];

// Category / taxonomy / archive pages that are not individual product pages.
// These typically end with the category slug and have no further path component.
var CATEGORY_PATH_PATTERNS = [
  /^\/green_cray_fish\/?$/,
  /^\/umitaro\/?$/,
  /^\/green_cray_fish\/[a-z_-]+\/?$/,  // e.g. /green_cray_fish/lure/
  /^\/umitaro\/[a-z_-]+\/?$/,          // e.g. /umitaro/rod/
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

var log = function(msg) {
  console.log('[issei-urls] ' + msg);
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
    return fetch(SITEMAP_URLS[i]).then(function(r) {
      if (!r.ok) {
        log('WARNING: Failed to fetch sitemap ' + SITEMAP_URLS[i] + ' (status ' + r.status + ')');
        return fetchOne(i + 1);
      }
      return r.text();
    }).then(function(xml) {
      if (typeof xml !== 'string') return fetchOne(i + 1);
      var locRegex = /<loc>([^<]+)<\/loc>/g;
      var m;
      while ((m = locRegex.exec(xml)) !== null) {
        allUrls.push(m[1]);
      }
      log('Sitemap ' + (i + 1) + '/' + SITEMAP_URLS.length + ' (' + SITEMAP_URLS[i].split('/').pop() + '): total ' + allUrls.length + ' URLs');
      return fetchOne(i + 1);
    });
  };

  return fetchOne(0);
};

// ---------------------------------------------------------------------------
// URL filtering
// ---------------------------------------------------------------------------

var isExcludedUrl = function(url) {
  var path;
  try {
    path = new URL(url).pathname;
  } catch (e) {
    return true; // Malformed URL
  }

  // Remove trailing slash for comparison
  var cleanPath = path.replace(/\/$/, '');

  // Exclude the site root
  if (cleanPath === '' || cleanPath === '/') {
    return true;
  }

  // Exclude URLs containing rod/accessory/oln path segments
  for (var i = 0; i < EXCLUDED_PATH_SEGMENTS.length; i++) {
    if (path.indexOf(EXCLUDED_PATH_SEGMENTS[i]) !== -1) {
      return true;
    }
  }

  // Exclude category index pages (paths with only one or two segments like
  // /green_cray_fish/ or /green_cray_fish/lure/ that are taxonomy listings)
  for (var j = 0; j < CATEGORY_PATH_PATTERNS.length; j++) {
    if (CATEGORY_PATH_PATTERNS[j].test(path)) {
      return true;
    }
  }

  // Exclude non-issei.tv URLs (just in case sitemaps reference external URLs)
  try {
    var host = new URL(url).hostname;
    if (host !== 'issei.tv' && host !== 'www.issei.tv') {
      return true;
    }
  } catch (e) {
    return true;
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
  var filter = encodeURIComponent('SEARCH("issei",LOWER({Slug}))');
  return airtableFetch(AIRTABLE_MAKER_TABLE_ID + '?filterByFormula=' + filter).then(function(data) {
    if (data.records && data.records.length > 0) {
      log('Found existing issei maker record: ' + data.records[0].id);
      return data.records[0].id;
    }

    if (DRY_RUN) {
      log('[DRY-RUN] Would create issei maker record');
      return 'DRY_RUN_MAKER_ID';
    }

    return airtableFetch(AIRTABLE_MAKER_TABLE_ID, {
      method: 'POST',
      body: JSON.stringify({
        records: [{
          fields: {
            '\u30e1\u30fc\u30ab\u30fc\u540d': 'issei',
            'URL': 'https://issei.tv',
            'Slug': 'issei',
          },
        }],
      }),
    }).then(function(created) {
      var makerId = created.records[0].id;
      log('Created issei maker record: ' + makerId);
      return makerId;
    });
  });
};

var getExistingUrls = function() {
  var urls = new Set();

  var fetchPage = function(offset) {
    var params = new URLSearchParams({
      'filterByFormula': 'SEARCH("issei.tv",{URL})',
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
        // Extract a name from the URL slug (last path component)
        var parts = url.replace(/\/$/, '').split('/');
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

  // Step 1: Collect URLs from sitemaps
  log('--- Step 1: Fetching sitemap URLs ---');
  return fetchSitemapUrls().then(function(sitemapUrls) {
    log('Sitemap URLs collected: ' + sitemapUrls.length);
    log('');

    // Step 2: Deduplicate
    log('--- Step 2: Deduplicating ---');
    var urlSet = new Set();

    sitemapUrls.forEach(function(u) {
      urlSet.add(u.replace(/\/$/, ''));
    });

    var allUrls = Array.from(urlSet);
    log('Total unique URLs (before filtering): ' + allUrls.length);

    // Step 3: Filter
    log('--- Step 3: Filtering ---');
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

    // Step 4: Check existing Airtable records
    log('--- Step 4: Checking existing Airtable records ---');
    return getExistingUrls().then(function(existingUrls) {
      log('Existing issei.tv URLs in Airtable: ' + existingUrls.size);

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

      // Step 5: Ensure maker record exists
      log('');
      log('--- Step 5: Creating/finding maker record ---');
      return findOrCreateMaker().then(function(makerId) {
        // Step 6: Create lure URL records
        log('');
        log('--- Step 6: Creating lure URL records ---');
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
