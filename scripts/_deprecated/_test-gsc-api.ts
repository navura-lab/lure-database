import fs from 'fs';

async function main() {
  const creds = JSON.parse(fs.readFileSync('/Users/user/.config/gcloud/application_default_credentials.json', 'utf8'));

  // refresh_token → access_token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tok = await tokenRes.json() as any;
  console.log('access_token obtained:', tok.access_token ? 'YES' : 'NO');
  console.log('scope:', tok.scope);

  if (!tok.access_token) {
    console.error('Token error:', tok);
    return;
  }

  const quotaProject = creds.quota_project_id || 'plucky-mile-486802-j6';
  const authHeaders = {
    'Authorization': `Bearer ${tok.access_token}`,
    'x-goog-user-project': quotaProject,
  };
  console.log('quota_project:', quotaProject);

  // Search Console API: list sites
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: authHeaders,
  });
  const data = await res.json() as any;
  console.log('\n=== Search Console Sites ===');
  if (data.siteEntry) {
    for (const site of data.siteEntry) {
      console.log(`  ${site.siteUrl} (${site.permissionLevel})`);
    }
  } else {
    console.log('No sites found or error:', JSON.stringify(data, null, 2));
  }

  // Search Console API: search analytics for lure-db.com
  const siteUrl = 'https://www.lure-db.com/';
  console.log(`\n=== Search Analytics (${siteUrl}) ===`);
  const analyticsRes = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: '2026-01-01',
        endDate: '2026-03-02',
        dimensions: ['query'],
        rowLimit: 10,
      }),
    }
  );
  const analyticsData = await analyticsRes.json() as any;
  if (analyticsData.rows) {
    console.log(`Top ${analyticsData.rows.length} queries:`);
    for (const row of analyticsData.rows) {
      console.log(`  "${row.keys[0]}" - clicks:${row.clicks} impressions:${row.impressions} ctr:${(row.ctr * 100).toFixed(1)}% pos:${row.position.toFixed(1)}`);
    }
  } else {
    console.log('No search analytics data:', JSON.stringify(analyticsData, null, 2));
  }

  // URL Inspection: check index status of homepage
  console.log('\n=== URL Inspection (homepage) ===');
  const inspectRes = await fetch(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionUrl: 'https://www.lure-db.com/',
        siteUrl: 'https://www.lure-db.com/',
      }),
    }
  );
  const inspectData = await inspectRes.json() as any;
  if (inspectData.inspectionResult) {
    const r = inspectData.inspectionResult;
    console.log('  Index status:', r.indexStatusResult?.verdict);
    console.log('  Coverage state:', r.indexStatusResult?.coverageState);
    console.log('  Robots.txt state:', r.indexStatusResult?.robotsTxtState);
    console.log('  Crawled as:', r.indexStatusResult?.crawledAs);
    console.log('  Last crawl time:', r.indexStatusResult?.lastCrawlTime);
  } else {
    console.log('Inspection result:', JSON.stringify(inspectData, null, 2));
  }

  // Sitemaps
  console.log('\n=== Sitemaps ===');
  const sitemapRes = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    { headers: authHeaders }
  );
  const sitemapData = await sitemapRes.json() as any;
  if (sitemapData.sitemap) {
    for (const sm of sitemapData.sitemap) {
      console.log(`  ${sm.path} - submitted:${sm.lastSubmitted} warnings:${sm.warnings} errors:${sm.errors}`);
    }
  } else {
    console.log('Sitemap data:', JSON.stringify(sitemapData, null, 2));
  }
}

main().catch(console.error);
